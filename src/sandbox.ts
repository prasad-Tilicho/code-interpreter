/**
 * THE PROJECT. Everything else is plumbing.
 *
 * runPython(code) starts one throwaway container, runs the code inside it
 * under hard limits, collects what it printed, and destroys the container.
 *
 * Each limit below maps to ONE kernel mechanism. The DISABLE env var lets you
 * switch them off one at a time so you can watch each attack succeed without
 * its guard — that "before/after" is the whole point of Day 1.
 *
 *   DISABLE=memory,pids,network,readonly,timeout,user pnpm dev
 */
import Docker from "dockerode";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

export const IMAGE = process.env.SANDBOX_IMAGE ?? "sandbox-python:3.12";
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
  | "memory"
  | "pids"
  | "network"
  | "readonly"
  | "timeout"
  | "user";

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
}

const docker = new Docker();

/** Fails fast with a readable message if Docker or the image is missing. */
export async function assertSandboxReady(): Promise<void> {
  try {
    await docker.ping();
  } catch {
    throw new Error("Docker is not running. Start Docker Desktop and retry.");
  }
  try {
    await docker.getImage(IMAGE).inspect();
  } catch {
    throw new Error(`Image ${IMAGE} not found. Run: pnpm sandbox:build`);
  }
}

export async function runPython(code: string): Promise<RunResult> {
  const jobId = randomUUID();
  const jobDir = path.join(JOBS_DIR, jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, "main.py"), code, { mode: 0o644 });

  const container = await docker.createContainer({
    Image: IMAGE,
    Cmd: ["python", "-u", "/workspace/main.py"],
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
        ? { Memory: LIMITS.memoryBytes, MemorySwap: LIMITS.memoryBytes }
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
    return {
      jobId,
      stdout: stdout.text(),
      stderr: stderr.text(),
      exitCode: StatusCode,
      durationMs: Date.now() - startedAt,
      timedOut,
      oomKilled: info.State.OOMKilled,
      truncated: stdout.truncated || stderr.truncated,
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
