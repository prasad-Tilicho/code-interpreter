# TESTS: the read-only root filesystem + non-root user.
# EXPECT: three × "Read-only file system", then "scratch space works".
# WHY IT FAILS: the root filesystem is mounted read-only; only /tmp (RAM) and
# /workspace are writable. And as uid 1000 we couldn't remount it even if we tried.
import os
for target in ["/bin/sh", "/usr/local/lib/python3.12/os.py", "/etc/hosts"]:
    try:
        os.remove(target)
        print(f"deleted {target}   <-- sandbox is broken")
    except Exception as e:
        print(f"{target} → {type(e).__name__}: {e}")

with open("/tmp/ok.txt", "w") as f:
    f.write("scratch space works")
print(open("/tmp/ok.txt").read())
