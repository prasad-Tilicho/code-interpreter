/* TESTS: the process limit (cgroup pids.max) — in a compiled language.
 * EXPECT: fork() starts returning -1 once 32 processes exist. The program
 *         does not die; it spins, and the 10 s timeout finishes it (exit 137).
 * WHY IT MATTERS: the sandbox never sees a Python interpreter here. This is a
 *         native binary produced by gcc inside the box, and it hits exactly
 *         the same kernel limit. The fence is around the PROCESS, not the
 *         language.
 * NOTE:   unlike Python, a failed fork() in C is just a -1 return value. The
 *         limit prevented the harm; the timeout did the cleanup. Those are two
 *         different mechanisms doing two different jobs.
 */
#include <stdio.h>
#include <sys/types.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>

int main(void) {
    int made = 0, refused = 0;
    for (;;) {
        pid_t pid = fork();
        if (pid == 0) { sleep(60); return 0; }  /* child: stay alive */
        if (pid < 0) {
            if (refused++ == 0)
                printf("fork refused after %d children: %s\n", made, strerror(errno));
            continue;
        }
        printf("forked %d\n", ++made);
        fflush(stdout);
    }
}
