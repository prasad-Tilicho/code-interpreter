# TESTS: the timeout.
# EXPECT: killed at 10 s, exit code 137 (= 128 + 9; signal 9 is SIGKILL).
# WHY IT DIES: a process stuck in a loop can't be *asked* to stop — the kernel
# has to force it. SIGKILL is the one signal a process cannot catch or ignore.
print("looping forever...", flush=True)
while True:
    pass
