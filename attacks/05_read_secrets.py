# TESTS: the mount namespace / volume isolation.
# EXPECT: every host path → FileNotFoundError. /workspace shows only main.py.
# WHY IT FAILS: the process sees a different filesystem tree (the image's).
# The only bridge to the host is the one folder we explicitly mounted.
import os
for path in ["/Users", "/Users/macbook", "/root/.env", "/app/.env", "/host"]:
    try:
        entries = os.listdir(path) if os.path.isdir(path) else open(path).read()[:80]
        print(f"{path} → FOUND: {entries}   <-- sandbox is broken")
    except Exception as e:
        print(f"{path} → {type(e).__name__}")
print("/workspace →", os.listdir("/workspace"))
print("/ →", sorted(os.listdir("/")))
