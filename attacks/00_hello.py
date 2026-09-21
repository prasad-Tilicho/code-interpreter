# Not an attack — the control. Proves the box works at all.
import os, sys, platform
print("hello from the box")
print("python", sys.version.split()[0], "on", platform.system(), platform.release())
print("uid", os.getuid(), "pid", os.getpid())
