# TESTS: the memory limit (cgroup memory.max).
# EXPECT: prints a few "allocated N MB" lines, then dies at ~256 MB, exit 137,
#         and the sandbox reports oomKilled=true.
# WHY IT DIES: the kernel's OOM killer terminates the process the moment the
# cgroup crosses its cap. Your Mac never notices.
chunks = []
while True:
    chunks.append(bytearray(50 * 1024 * 1024))   # 50 MB per loop
    print(f"allocated {len(chunks) * 50} MB", flush=True)
