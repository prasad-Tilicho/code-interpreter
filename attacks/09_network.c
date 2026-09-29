/* TESTS: the network namespace — from a raw socket, not a library.
 * EXPECT: connect() fails with ENETUNREACH, "Network is unreachable".
 * WORTH NOTICING: Python's attack failed at DNS ("name resolution"), because
 *         it asked for a hostname. This one dials an IP address directly and
 *         skips DNS entirely — and still fails, one layer lower, because there
 *         is no route and no interface to send a packet from. Two different
 *         error messages, same missing network namespace.
 */
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

int main(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) { perror("socket"); return 0; }

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons(53);
    addr.sin_addr.s_addr = inet_addr("1.1.1.1");

    if (connect(s, (struct sockaddr *)&addr, sizeof addr) == 0) {
        puts("CONNECTED — the sandbox is broken");
        return 1;
    }
    perror("connect");
    return 0;
}
