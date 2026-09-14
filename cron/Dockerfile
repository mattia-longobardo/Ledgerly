FROM alpine:3.21

# supercronic publishes no pullable image; the release binary is vendored with a pinned checksum.
ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA256=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
# The schedule is Europe/Rome (spec §10.2); supercronic reads TZ, tzdata provides the zone.
ENV TZ=Europe/Rome
RUN apk add --no-cache curl ca-certificates tzdata \
 && curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod +x /usr/local/bin/supercronic

COPY crontab /etc/crontab
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/supercronic", "-passthrough-logs", "/etc/crontab"]
