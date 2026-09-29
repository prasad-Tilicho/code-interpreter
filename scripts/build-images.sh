#!/usr/bin/env sh
# Build one image per language.
#
# Separate images, not one image with every toolchain: a Python job should not
# ship a JDK it will never run, and a bug in one toolchain should not be
# reachable from a job written in another language.
set -e
for lang in python node gcc java; do
  printf "\n\033[1m== %s\033[0m\n" "$lang"
  case "$lang" in
    python) tag="sandbox-python:3.12" ;;
    node)   tag="sandbox-node:22" ;;
    gcc)    tag="sandbox-gcc:14" ;;
    java)   tag="sandbox-java:21" ;;
  esac
  docker build -q -t "$tag" "sandbox-image/$lang" | sed 's/^/  built /'
done

printf "\n\033[1m== sizes\033[0m\n"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep '^sandbox-' | sort | column -t
