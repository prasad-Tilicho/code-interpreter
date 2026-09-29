/* TESTS: the timeout, against a runtime that has its own threads and its own
 *        signal handling.
 * EXPECT: killed at 10 s, exit 137.
 * WHY IT MATTERS: a JVM installs handlers for most signals and can shut down
 *        gracefully. It cannot handle SIGKILL — nothing can. That is why the
 *        timeout uses signal 9 and not something politer.
 */
public class Main {
    public static void main(String[] args) {
        System.out.println("looping forever...");
        System.out.flush();
        while (true) { }
    }
}
