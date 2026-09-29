# Java. The alpine JDK is roughly half the size of the debian one, and nothing
# here needs glibc.
#
# A JVM is a heavyweight runtime by the standards of this sandbox: it reserves
# heap up front and starts its own threads. src/runtimes.ts gives this language
# a larger memory ceiling and a single-threaded GC for exactly that reason.
FROM eclipse-temurin:21-jdk-alpine

RUN adduser -D -u 1000 sandbox

WORKDIR /workspace
USER sandbox
