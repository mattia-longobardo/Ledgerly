FROM alpine:3.21

# supercronic has no pullable image (ghcr.io/aptible/supercronic returns "denied"),
# so the released binary is vendored here with a pinned checksum instead.
ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA256=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
ARG SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64

RUN apk add --no-cache curl ca-certificates tzdata \
 && curl -fsSLO "${SUPERCRONIC_URL}" \
 && echo "${SUPERCRONIC_SHA256}  supercronic-linux-amd64" | sha256sum -c - \
 && chmod +x supercronic-linux-amd64 \
 && mv supercronic-linux-amd64 /usr/local/bin/supercronic

USER 1000:1000
ENTRYPOINT ["/usr/local/bin/supercronic"]
