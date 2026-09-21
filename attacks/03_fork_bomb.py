# TESTS: the process limit (cgroup pids.max).
# EXPECT: a handful of forks succeed, then
#         BlockingIOError: [Errno 11] Resource temporarily unavailable
# WHY IT DIES: fork() is the system call that creates a process. Unlimited, it
# doubles until the machine freezes. With pids.max=32 the 33rd fork() fails.
import os
count = 0
while True:
    pid = os.fork()
    if pid == 0:            # child: stay alive so the count keeps growing
        import time
        time.sleep(60)
    count += 1
    print(f"forked {count}", flush=True)
