/* TESTS: the read-only root filesystem — from C, with no interpreter between
 *        the program and the syscall.
 * EXPECT: EROFS on the image's filesystem, success only in /tmp.
 */
#include <stdio.h>
#include <unistd.h>

int main(void) {
    const char *targets[] = { "/evil", "/bin/sh", "/etc/hosts" };
    for (int i = 0; i < 3; i++) {
        FILE *f = fopen(targets[i], "w");
        if (f) { printf("%s -> WROTE, broken\n", targets[i]); fclose(f); }
        else   { printf("%s -> ", targets[i]); perror(""); }
    }
    FILE *ok = fopen("/tmp/ok.txt", "w");
    puts(ok ? "/tmp is writable (scratch)" : "/tmp refused too");
    if (ok) fclose(ok);
    return 0;
}
