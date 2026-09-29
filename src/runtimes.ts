/**
 * The languages the sandbox can run.
 *
 * # The point of this file
 *
 * The sandbox does not know what a language is. It starts a process under a
 * set of kernel limits and reads what that process printed. Whether the process
 * is `python main.py` or `./a.out` is a detail of this table, not of the box.
 *
 * That is worth proving rather than asserting: `attacks/` has the same fork
 * bomb in Python and in C. Both die at the same 32-process cgroup limit, with
 * the same errno. The C one never touches a Python interpreter.
 *
 * # One image per language, not one image with everything
 *
 * The lazy option is a single image with python, gcc, a JDK and node all
 * installed. It would work. It is also worse:
 *
 *   - Every job carries every toolchain. A Python job that needs 120 MB
 *     would ship with a 300 MB JDK it will never execute.
 *   - Attack surface is the union of all of them. A bug in one toolchain is
 *     reachable from a job written in a different language.
 *   - Updating one language rebuilds the image for all of them.
 *
 * So each language gets its own minimal image, and `image` below is part of
 * the runtime definition. Adding a language is a Dockerfile plus one entry
 * here — no existing image is touched.
 *
 * # Compiled languages
 *
 * A compiled language needs two steps, and both must happen inside the box —
 * a compiler is untrusted code too. `gcc` on hostile input can be made to
 * consume enormous memory, so it runs under the same cgroups as the program it
 * produces, and the 10-second timeout covers compile AND run together.
 *
 * The compiler writes its output into /workspace, because the root filesystem
 * is read-only and /workspace is the one place this job may write.
 */

export interface Runtime {
  id: string;
  /** What a human calls it. */
  label: string;
  /** Docker image, built by `pnpm sandbox:build`. */
  image: string;
  /** What the source file is called inside /workspace. */
  filename: string;
  /**
   * Shell command to compile, if the language needs it. Runs before `run`.
   * A non-zero exit here is reported as a COMPILE error, not a crash.
   */
  compile?: string;
  /** Shell command that executes the program. */
  run: string;
  /**
   * Memory ceiling, when the default is not enough. A JVM reserves heap up
   * front and refuses to start in 256 MB; a C binary needs almost nothing.
   * Runtimes have wildly different floors and pretending otherwise just
   * produces confusing OOM kills.
   */
  memoryMb?: number;
  /** Shown in the UI so a user knows what they can import. */
  notes?: string;
  /** A one-liner that proves the runtime works. */
  hello: string;
}

export const RUNTIMES: Runtime[] = [
  {
    id: "python",
    label: "Python 3.12",
    image: "sandbox-python:3.12",
    filename: "main.py",
    run: "python -u /workspace/main.py",
    notes: "pandas and matplotlib installed",
    hello: 'print("hello from python")',
  },
  {
    id: "javascript",
    label: "JavaScript (Node 22)",
    image: "sandbox-node:22",
    filename: "main.js",
    run: "node /workspace/main.js",
    notes: "standard library only, no npm packages",
    hello: 'console.log("hello from node")',
  },
  {
    id: "c",
    label: "C (gcc 14)",
    image: "sandbox-gcc:14",
    filename: "main.c",
    // -static so the binary does not depend on anything at run time, and
    // -O0 so a hostile program cannot make the optimiser run for ever.
    compile: "gcc -O0 -std=c17 -o /workspace/prog /workspace/main.c",
    run: "/workspace/prog",
    hello:
      '#include <stdio.h>\nint main(void) { puts("hello from c"); return 0; }',
  },
  {
    id: "cpp",
    label: "C++ (g++ 14)",
    image: "sandbox-gcc:14",
    filename: "main.cpp",
    compile: "g++ -O0 -std=c++20 -o /workspace/prog /workspace/main.cpp",
    run: "/workspace/prog",
    hello:
      '#include <iostream>\nint main() { std::cout << "hello from c++" << std::endl; }',
  },
  {
    id: "java",
    label: "Java 21",
    image: "sandbox-java:21",
    // The public class must match the file name, so the file is always
    // Main.java and the class is always Main.
    filename: "Main.java",
    compile: "javac -d /workspace /workspace/Main.java",
    // -XX:+UseSerialGC and a small heap: the default GC sizes itself from the
    // machine's memory and starts threads we do not need, which trips the
    // 32-process limit before any user code runs.
    run: "java -XX:+UseSerialGC -Xmx192m -cp /workspace Main",
    memoryMb: 512,
    notes: "class must be named Main",
    hello:
      'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hello from java");\n  }\n}',
  },
  {
    id: "bash",
    label: "Bash",
    image: "sandbox-python:3.12",
    filename: "main.sh",
    run: "sh /workspace/main.sh",
    notes: "runs in the python image; almost no tools are installed",
    hello: 'echo "hello from bash"',
  },
];

export const DEFAULT_RUNTIME = "python";

export function getRuntime(id: string | undefined): Runtime {
  const rt = RUNTIMES.find((r) => r.id === (id ?? DEFAULT_RUNTIME));
  if (!rt) {
    throw new Error(
      `unknown language ${JSON.stringify(id)} — known: ${RUNTIMES.map((r) => r.id).join(", ")}`,
    );
  }
  return rt;
}

/** Exit code the wrapper uses to mean "the compiler rejected this". */
export const COMPILE_FAILED = 101;

/**
 * The single shell command the container runs.
 *
 * For an interpreted language it is just the run command. For a compiled one
 * it is compile-then-run, with the compiler's failure turned into a distinct
 * exit code so the caller can say "that did not compile" instead of showing a
 * confusing crash. Both halves share the container's one timeout.
 */
export function buildCommand(rt: Runtime): string {
  // `exec` matters more than it looks. Without it, `sh -c "python main.py"`
  // leaves the SHELL as process 1 and the interpreter as its child — so the
  // program reports pid 7, the shell eats the signals, and the pids limit is
  // one lower than it says. exec replaces the shell with the program, so the
  // thing being sandboxed really is process 1 and really does receive SIGKILL.
  if (!rt.compile) return `exec ${rt.run}`;
  return `${rt.compile} || exit ${COMPILE_FAILED}\nexec ${rt.run}`;
}
