# The image every job runs in. Small, no compilers, no shell tools beyond what
# python:slim ships. pandas + matplotlib so the Day-3 agent can analyse a CSV.
FROM python:3.12-slim

RUN pip install --no-cache-dir pandas matplotlib

# Never run untrusted code as root, even inside a container. uid 1000 owns
# nothing on this image; the only writable places will be /workspace and /tmp.
RUN useradd --uid 1000 --create-home sandbox

WORKDIR /workspace
USER sandbox
