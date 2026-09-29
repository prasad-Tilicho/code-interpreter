/**
 * Every language runs, and every kernel limit applies to every language.
 *
 * The second half is the point. The sandbox has no idea what a language is —
 * it fences a process. So a fork bomb compiled to a native binary by gcc must
 * hit the same cgroup as the same bomb written in Python, and a JVM (which
 * handles most signals itself) must still die to SIGKILL.
 *
 * Needs Docker and all images: pnpm sandbox:build && pnpm test
 */
import { describe, expect, it } from "vitest";
import { RUNTIMES } from "../src/runtimes.js";
import { run } from "../src/sandbox.js";

describe("every runtime", () => {
  for (const rt of RUNTIMES) {
    it(`${rt.id}: runs hello world`, async () => {
      const r = await run(rt.hello, { language: rt.id });
      expect(r.compileFailed, `stderr: ${r.stderr}`).toBe(false);
      expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout.toLowerCase()).toContain("hello");
      expect(r.language).toBe(rt.id);
    }, 40_000);
  }

  it("rejects an unknown language instead of guessing", async () => {
    await expect(run("print(1)", { language: "brainfuck" })).rejects.toThrow(
      /unknown language/,
    );
  });
});

describe("the limits do not care what language it is", () => {
  // A compiled binary, no interpreter anywhere, still hits the pids cgroup.
  it("c: fork() is refused at the process limit", async () => {
    const r = await run(
      `#include <stdio.h>
#include <sys/types.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
int main(void){
  int made=0;
  for(;;){
    pid_t p=fork();
    if(p==0){ sleep(30); return 0; }
    if(p<0){ printf("refused after %d: %s\\n", made, strerror(errno)); fflush(stdout); return 0; }
    made++;
  }
}`,
      { language: "c" },
    );
    expect(r.stdout).toMatch(/refused after \d+/);
    // 32 processes minus the program itself.
    expect(r.stdout).toMatch(/refused after 31\b/);
    expect(r.stdout).toContain("Resource temporarily unavailable");
  }, 30_000);

  it("c: the memory cgroup kills a native allocation loop", async () => {
    const r = await run(
      `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
  const size_t c = 50u<<20;
  for(int i=1;;i++){
    char *p = malloc(c);
    if(!p) return 1;
    memset(p, 1, c);           /* touch it — untouched pages cost nothing */
    printf("%d MB\\n", i*50); fflush(stdout);
  }
}`,
      { language: "c" },
    );
    expect(r.oomKilled).toBe(true);
    expect(r.exitCode).toBe(137);
  }, 30_000);

  it("c: a raw socket cannot leave the network namespace", async () => {
    const r = await run(
      `#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main(void){
  int s = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in a; memset(&a,0,sizeof a);
  a.sin_family=AF_INET; a.sin_port=htons(53);
  a.sin_addr.s_addr=inet_addr("1.1.1.1");
  if (connect(s,(struct sockaddr*)&a,sizeof a)==0){ puts("CONNECTED"); return 1; }
  perror("connect");
  return 0;
}`,
      { language: "c" },
    );
    // Dials an IP directly, so this never involves DNS — it fails one layer
    // lower than the Python attack, with no route to send a packet.
    expect(r.stdout).not.toContain("CONNECTED");
    expect(r.stderr).toContain("Network is unreachable");
  }, 30_000);

  // A JVM installs handlers for most signals and shuts down gracefully.
  // It cannot handle SIGKILL, because nothing can.
  it("java: SIGKILL beats the JVM's own signal handling", async () => {
    const r = await run(
      "public class Main { public static void main(String[] a) { while (true) {} } }",
      { language: "java" },
    );
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(137);
  }, 30_000);

  it("c: a compile error is reported as a compile error, not a crash", async () => {
    const r = await run("int main(void) { this is not c }", { language: "c" });
    expect(r.compileFailed).toBe(true);
    expect(r.stderr).toContain("error");
    // Nothing ran, so there is no program output to confuse the caller with.
    expect(r.stdout).toBe("");
  }, 30_000);
});
