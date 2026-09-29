/**
 * THE PROJECT. Everything else is plumbing.
 *
 * run(language, code) starts one throwaway container, runs the code inside it
 * under hard limits, collects what it printed, and destroys the container.
 *
 * Note what is NOT in this file: anything about a language. The box starts a
 * process and fences it in. Whether that process is `python main.py` or
 * `./prog` is a row in src/runtimes.ts. That separation is the point — the
 * same fork bomb in C and in Python dies at the same cgroup.
 *
 * Each limit below maps to ONE kernel mechanism. The DISABLE env var lets you
 * switch them off one at a time so you can watch each attack succeed without
 * its guard — that "before/after" is the whole point of Day 1.
 *
 *   DISABLE=memory,pids,network,readonly,timeout,user pnpm dev
 */
import Docker from "dockerode";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  buildCommand,
  COMPILE_FAILED,
  DEFAULT_RUNTIME,
  getRuntime,
  RUNTIMES,
} from "./runtimes.js";

const JOBS_DIR = path.resolve(process.env.JOBS_DIR ?? "jobs");

export const LIMITS = {
  memoryBytes: 256 * 1024 * 1024, // cgroup memory.max  → OOM killer
  cpus: 0.5, //                      cgroup cpu.max     → throttling, not death
  pids: 32, //                       cgroup pids.max    → fork() fails
  timeoutMs: 10_000, //              host timer         → SIGKILL (exit 137)
  tmpfsBytes: 64 * 1024 * 1024, //   /tmp is RAM, capped
  maxOutputBytes: 64 * 1024, //      backpressure: never buffer unbounded output
} as const;

export type Protection =
  "memory" | "pids" | "network" | "readonly" | "timeout" | "user";

const disabled = new Set(
  (process.env.DISABLE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
export const isOn = (p: Protection): boolean => !disabled.has(p);

export interface RunResult {
  jobId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  oomKilled: boolean;
  truncated: boolean;
  /** Files the code left in /workspace that weren't there before (charts, CSVs). */
  producedFiles: string[];
  /** Which runtime ran it. */
  language: string;
  /** True when the compiler rejected the source, so nothing ever ran. */
  compileFailed: boolean;
}

/** A file to place in /workspace before the code runs. */
export interface InputFile {
  name: string;
  content: string | Buffer;
}

export interface RunOptions {
  files?: InputFile[];
  /** A runtime id from src/runtimes.ts. Defaults to python. */
  language?: string;
}

const docker = new Docker();

/**
 * Fails fast if Docker is down, and reports which language images exist.
 *
 * A missing image is not fatal: the server starts with whatever is built and
 * refuses just that language, rather than refusing to boot because you have
 * not pulled a JDK.
 */
export async function assertSandboxReady(): Promise<string[]> {
  try {
    await docker.ping();
  } catch {
    throw new Error("Docker is not running. Start Docker Desktop and retry.");
  }

  const available: string[] = [];
  for (const rt of RUNTIMES) {
    try {
      await docker.getImage(rt.image).inspect();
      available.push(rt.id);
    } catch {
      // not built — reported by the caller, not fatal
    }
  }
  if (available.length === 0) {
    throw new Error("No sandbox images built. Run: pnpm sandbox:build");
  }
  return available;
}

export async function run(
  code: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const rt = getRuntime(opts.language ?? DEFAULT_RUNTIME);

  const jobId = randomUUID();
  const jobDir = path.join(JOBS_DIR, jobId);
  await mkdir(jobDir, { recursive: true, mode: 0o777 });
  await writeFile(path.join(jobDir, rt.filename), code, { mode: 0o644 });
  const inputNames = new Set([rt.filename]);
  for (const f of opts.files ?? []) {
    // A file name is untrusted input too: "../.zshrc" must not escape jobDir.
    const safe = path.basename(f.name);
    await writeFile(path.join(jobDir, safe), f.content, { mode: 0o644 });
    inputNames.add(safe);
  }

  const memoryBytes = (rt.memoryMb ?? 256) * 1024 * 1024;

  const container = await docker.createContainer({
    Image: rt.image,
    // One shell command: compile-then-run for compiled languages, just run for
    // interpreted ones. `sh -c` is the only thing every image here agrees on.
    Cmd: ["sh", "-c", buildCommand(rt)],
    WorkingDir: "/workspace",
    // Not root, even inside the box. Root in a container is root in the
    // kernel's eyes — one escape bug away from root on the host.
    User: isOn("user") ? "1000:1000" : "0:0",
    Env: ["MPLCONFIGDIR=/tmp/mpl", "PYTHONDONTWRITEBYTECODE=1"],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    HostConfig: {
      // The ONE bridge between the host and the box: this job's folder.
      Binds: [`${jobDir}:/workspace`],
      // Network namespace with only loopback → the internet does not exist.
      NetworkMode: isOn("network") ? "none" : "bridge",
      // Memory cgroup. MemorySwap == Memory means "no swap" — otherwise the
      // box quietly gets 2× the limit via swap and the demo looks broken.
      ...(isOn("memory")
        ? { Memory: memoryBytes, MemorySwap: memoryBytes }
        : {}),
      // CPU cgroup: 0.5 core. Throttles — never kills — so an infinite loop
      // still needs the timeout to end it.
      NanoCpus: Math.round(LIMITS.cpus * 1e9),
      // pids cgroup: the 33rd fork() fails with EAGAIN.
      ...(isOn("pids") ? { PidsLimit: LIMITS.pids } : {}),
      // Mount namespace: the image's filesystem, read-only…
      ReadonlyRootfs: isOn("readonly"),
      // …except a small RAM-backed /tmp.
      Tmpfs: { "/tmp": `rw,noexec,nosuid,size=${LIMITS.tmpfsBytes}` },
      // Drop every Linux capability (mount, raw sockets, ptrace, …).
      CapDrop: ["ALL"],
      // setuid binaries cannot re-gain privilege.
      SecurityOpt: ["no-new-privileges"],
    },
  });

  const stdout = collector(LIMITS.maxOutputBytes);
  const stderr = collector(LIMITS.maxOutputBytes);
  // Attach BEFORE start or the first bytes are lost.
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });
  container.modem.demuxStream(stream, stdout.stream, stderr.stream);
  const ended = new Promise<void>((resolve) => stream.on("end", resolve));

  const startedAt = Date.now();
  let timedOut = false;
  const timer = isOn("timeout")
    ? setTimeout(() => {
        timedOut = true;
        // SIGKILL: the one signal a process cannot catch, block, or ignore.
        container.kill({ signal: "SIGKILL" }).catch(() => undefined);
      }, LIMITS.timeoutMs)
    : undefined;

  try {
    await container.start();
    const { StatusCode } = (await container.wait()) as { StatusCode: number };
    // Give the attach stream a moment to flush the last bytes.
    await Promise.race([ended, sleep(500)]);
    const info = await container.inspect();
    const producedFiles = (await readdir(jobDir)).filter(
      (n) => !inputNames.has(n) && !COMPILER_ARTIFACTS.test(n),
    );
    return {
      jobId,
      stdout: stdout.text(),
      stderr: stderr.text(),
      exitCode: StatusCode,
      durationMs: Date.now() - startedAt,
      timedOut,
      oomKilled: info.State.OOMKilled,
      truncated: stdout.truncated || stderr.truncated,
      producedFiles,
      language: rt.id,
      compileFailed: StatusCode === COMPILE_FAILED,
    };
  } finally {
    if (timer) clearTimeout(timer);
    await container.remove({ force: true }).catch(() => undefined);
  }
}

/** Buffers up to `cap` bytes and drops the rest — a program that prints a
 *  million lines must not be able to eat the server's memory. */
function collector(cap: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  const stream = new PassThrough();
  stream.on("data", (chunk: Buffer) => {
    if (size >= cap) {
      truncated = true;
      return;
    }
    const take = chunk.subarray(0, cap - size);
    chunks.push(take);
    size += take.length;
    if (take.length < chunk.length) truncated = true;
  });
  return {
    stream,
    text: () => Buffer.concat(chunks).toString("utf8"),
    get truncated() {
      return truncated;
    },
  };
}

/**
 * Files the toolchain leaves behind, which are not a result the user asked for.
 * Without this, every C run would report a binary called "prog" as an output
 * file, and every Java run a pile of .class files.
 */
const COMPILER_ARTIFACTS = /^(prog|a\.out)$|\.(class|o|obj)$/;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
