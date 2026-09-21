# Code Interpreter

**A secure code-execution sandbox for AI agents — built from the operating system up.**

## The problem

AI models can write code but cannot run it. Every serious AI product — ChatGPT's Code
Interpreter, Claude's analysis tool, Cursor, Devin — depends on a service that takes code an
AI just wrote and runs it *safely*. "Safely" is the hard word: the code is untrusted by
definition. It may loop forever, exhaust memory, spawn thousands of processes, read secrets,
or exfiltrate data — by mistake or through prompt injection. Running it without a boundary is
how you lose a server.

This boundary is the most important piece of infrastructure in AI engineering, and almost
every developer treats it as a black box they rent from a vendor.

## What this is

A service that:

1. Accepts code and runs it inside an isolated container with hard limits — no network,
   capped memory and CPU, capped process count, read-only filesystem, a wall-clock timeout,
   non-root.
2. Returns stdout, stderr and the exit code so an agent can read errors and correct itself.
3. Sits behind an agent loop *(Day 3)*: a user asks a data question, the model writes Python,
   the sandbox runs it, the model fixes its own mistakes and answers.
4. Withstands a red-team: six attacks, six containments, each with a one-sentence explanation
   of *which OS mechanism stopped it*.

## Plan

| Day | Deliverable |
|---|---|
| 1 | `POST /run { code }` → container with limits → `{ stdout, stderr, exitCode }`. All six attacks contained. **No AI.** |
| 2 | Inspect the container from inside (`/proc`, `/sys/fs/cgroup`, `ip addr`, `mount`). Write [What a container actually is](#what-a-container-actually-is) in my own words. Add a seccomp profile. |
| 3 | Agent loop: Gemini with a `run_python` tool; CSV question answered end to end, including self-correction. |
| 4 | Minimal web UI, prompt-injection demo, deploy, 5-minute video. |

---

## Day 1 — run it

```bash
pnpm install
pnpm sandbox:build        # builds the python image the jobs run in (~1 min first time)
pnpm dev                  # starts the API on :3000 — refuses to boot if Docker/image missing
```

In a second terminal:

```bash
pnpm attacks              # sends every attacks/*.py to POST /run, prints a table
pnpm test                 # the same guarantees as assertions
```

Expected table with every protection on:

| attack | exit | flags | stopped by |
|---|---|---|---|
| 00_hello | 0 | – | (control — proves the box works) |
| 01_infinite_loop | 137 | TIMEOUT | host timer → SIGKILL |
| 02_memory_bomb | 137 | OOM | memory cgroup → OOM killer |
| 03_fork_bomb | 1 | – | pids cgroup → `fork()` fails |
| 04_network | 1 | – | network namespace → no route |
| 05_read_secrets | 0 | – | mount namespace → host paths don't exist |
| 06_destroy | 0 | – | read-only rootfs + non-root |

### The part that matters: before / after

Run the attacks **with a protection switched off** and watch the attack succeed. Then switch
it back on. Do this once per protection — you will then be able to say, from experience,
"without this flag, this exact thing happens."

```bash
DISABLE=timeout pnpm dev      # 01 now runs forever — Ctrl-C the server, it kills the box
DISABLE=memory pnpm dev       # 02 keeps allocating until Docker's VM runs dry (~2–4 GB)
DISABLE=pids pnpm dev         # 03 — CAREFUL: can freeze Docker Desktop; restart it after
DISABLE=network pnpm dev      # 04 "SENT — the sandbox is broken"
DISABLE=readonly pnpm dev     # 06 deletes /bin/sh inside the box (the box is thrown away anyway)
DISABLE=user pnpm dev         # 00 prints uid 0 — root inside the container
```

`05_read_secrets` has no switch: the mount namespace is what a container *is*. The only way
to "disable" it would be to mount `/` from the host — try adding `"/:/host"` to `Binds` in
`src/sandbox.ts` and run 05 once. Then remove it.

---

## What a container actually is

*(Day 2 — write this yourself, in your own words, after doing the commands below. Do not
paste from a website. This section is the thing being graded.)*

Get inside a running box:

```bash
docker run --rm -it --memory 256m --pids-limit 32 --network none --read-only \
  --tmpfs /tmp --user 1000:1000 sandbox-python:3.12 sh
```

Then look at each mechanism from the inside:

| Look at | Command inside the box | What it shows |
|---|---|---|
| PID namespace | `ps aux` · `echo $$` · `cat /proc/1/cmdline` | you are PID 1; no other processes exist |
| Memory cgroup | `cat /sys/fs/cgroup/memory.max` | `268435456` — the cap, in bytes |
| pids cgroup | `cat /sys/fs/cgroup/pids.max` | `32` |
| CPU cgroup | `cat /sys/fs/cgroup/cpu.max` | `50000 100000` = 0.5 core |
| Network namespace | `cat /proc/net/dev` · `cat /proc/net/route` | only `lo`; no default route |
| Mount namespace | `cat /proc/mounts` · `ls /` | overlay root `ro`, tmpfs on /tmp |
| Not root | `id` · `cat /proc/self/status \| grep Cap` | uid 1000; all capability masks 0 |
| The host is a VM | on the Mac: `docker info \| grep -i kernel` | macOS has no namespaces; Docker Desktop runs a Linux VM |

Questions to be able to answer on camera after this:

- What is a process? What is a PID? Why is the box's PID 1 not the host's PID 1?
- What does exit code 137 mean, and why can't the program prevent it?
- What's the difference between a namespace and a cgroup? (one controls what you *see*, one controls what you *use*)
- Why does the memory bomb die but the infinite loop doesn't — until the timeout?
- What is a system call? Name three the attacks used. What does seccomp do to them?
- Why is a read-only root filesystem not enough on its own? (→ non-root, no-new-privileges, CapDrop)
- Docker is a wrapper around which four kernel features?

---

## What broke that I didn't expect

*(Keep a log. This is the answer to "what did you actually do" — one entry per surprise.)*

- 

---

## Where this goes next

1. Docker containers ← **here**
2. Raw `unshare` / `clone` + cgroups v2, no Docker — remove the wrapper
3. gVisor / Firecracker microVMs — a separate kernel per run, what production sandboxes use
4. Multi-tenant: per-customer quotas, warm pools for sub-100 ms starts
5. Snapshot / restore so a long-running agent can pause and resume

## Layout

```
src/sandbox.ts        ← THE PROJECT: create → limit → run → collect → destroy
src/routes/run.ts     ← POST /run
src/server.ts         ← Fastify, refuses to boot without Docker + image
sandbox-image/        ← python:3.12-slim + pandas + matplotlib, non-root user
attacks/              ← 00 control + six attacks, one kernel mechanism each
scripts/run-attacks.ts← runs them all, prints the table
test/                 ← the same guarantees as assertions
jobs/                 ← one folder per run, mounted as /workspace (gitignored)
```
