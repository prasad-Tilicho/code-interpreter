/**
 * Day-1 verification. Needs Docker running and the image built:
 *   pnpm sandbox:build && pnpm test
 */
import { describe, expect, it } from "vitest";
import { runPython } from "../src/sandbox.js";

describe("sandbox", () => {
  it("runs code and returns its output", async () => {
    const r = await runPython('print("hello")');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
  });

  it("separates stderr from stdout and reports the exit code", async () => {
    const r = await runPython('import sys; print("out"); print("err", file=sys.stderr); sys.exit(3)');
    expect(r.exitCode).toBe(3);
    expect(r.stdout.trim()).toBe("out");
    expect(r.stderr.trim()).toBe("err");
  });

  it("kills an infinite loop at the timeout with SIGKILL (137)", async () => {
    const r = await runPython("while True: pass");
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(137);
  }, 20_000);

  it("runs as a non-root user with no network", async () => {
    const r = await runPython(
      'import os, socket\nprint(os.getuid())\ntry:\n    socket.create_connection(("1.1.1.1", 53), timeout=2)\n    print("connected")\nexcept OSError as e:\n    print("blocked")',
    );
    expect(r.stdout.trim().split("\n")).toEqual(["1000", "blocked"]);
  });

  it("caps output instead of buffering it all", async () => {
    const r = await runPython('print("x" * 1000000)');
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(64 * 1024);
  });
});
