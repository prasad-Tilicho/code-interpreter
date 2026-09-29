/* TESTS: the memory limit (cgroup memory.max) — in a compiled language.
 * EXPECT: dies at ~250 MB, exit 137, oomKilled=true. Same as the Python one.
 * WHY memset: malloc alone only reserves address space. Linux does not charge
 *         you for a page until you touch it, so a bomb that never writes to
 *         its memory is not a bomb. The memset is what makes the kernel
 *         actually hand over the pages.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    const size_t chunk = 50u << 20;   /* 50 MB */
    for (int i = 1;; i++) {
        char *p = malloc(chunk);
        if (!p) { puts("malloc returned NULL"); return 1; }
        memset(p, 1, chunk);          /* touch it, or it costs nothing */
        printf("allocated %d MB\n", i * 50);
        fflush(stdout);
    }
}
