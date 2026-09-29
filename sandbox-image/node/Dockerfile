# JavaScript. node:slim is already small; nothing else is added, so a job
# cannot import a package that is not in the standard library.
FROM node:22-slim

# Never run untrusted code as root, even inside a container. The node image
# already ships a uid-1000 "node" user, so reuse it rather than making another.
WORKDIR /workspace
USER 1000:1000
