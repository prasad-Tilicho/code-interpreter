#!/usr/bin/env sh
# Day 2: start a box with the sandbox's limits and ask the KERNEL what it is
# enforcing. Everything after `sh -c` runs inside the container.
#
#   pnpm inspect
#
# No `ps`, no `ip`, no `mount` binaries exist in python:slim — and none are
# needed. Linux exposes processes, cgroups, network and mounts as plain files
# under /proc and /sys. `ps` is just a program that reads /proc.

docker run --rm \
  --memory 256m --memory-swap 256m \
  --pids-limit 32 \
  --network none \
  --read-only --tmpfs /tmp \
  --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges \
  --cpus 0.5 \
  sandbox-python:3.12 sh -c '
p() { printf "\n\033[1m== %s\033[0m\n" "$1"; }

p "who am I";                 id
p "my PID (PID namespace)";   echo $$
p "every process that exists"; ls /proc | grep -E "^[0-9]+$" | tr "\n" " "; echo
p "memory.max (bytes)";       cat /sys/fs/cgroup/memory.max
p "memory.swap.max";          cat /sys/fs/cgroup/memory.swap.max
p "pids.max";                 cat /sys/fs/cgroup/pids.max
p "cpu.max (quota period)";   cat /sys/fs/cgroup/cpu.max
p "network interfaces";       tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " " | tr "\n" " "; echo
p "routes out";               echo "$(( $(wc -l < /proc/net/route) - 1 ))"
p "root filesystem";          grep " / " /proc/mounts | cut -d" " -f1-4
p "/tmp";                     grep " /tmp " /proc/mounts | cut -d" " -f1-4
p "capabilities (all zero = none)"; grep CapEff /proc/self/status
p "kernel (this is the Linux VM, not macOS)"; uname -r
'
