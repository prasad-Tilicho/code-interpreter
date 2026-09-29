# C and C++ share one image because they share one toolchain.
#
# debian-slim + build-essential rather than the official `gcc` image: that one
# builds GCC from source and lands at 2 GB, most of which is the compiler's own
# build tree. This is the same compiler, a quarter of the size.
#
# A compiler in the sandbox is the honest cost of compiling untrusted code.
# gcc fed hostile input can be made to consume enormous memory, so it runs
# under the same cgroups as the program it produces.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 1000 --create-home sandbox

WORKDIR /workspace
USER sandbox
