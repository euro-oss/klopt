# Postgres 17 plus WAL-G, for WAL archiving and encrypted base backups to
# Scaleway Object Storage. Debian, not Alpine: the published WAL-G builds
# are glibc.

FROM postgres:17-bookworm

ARG WALG_VERSION=v3.0.8
ARG WALG_DIST=wal-g-pg-22.04-amd64

# Elastic Metal in nl-ams is x86_64. Aarch64 is not a target for this layout.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/wal-g.tar.gz \
    "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${WALG_DIST}.tar.gz" \
  && tar -xzf /tmp/wal-g.tar.gz -C /usr/local/bin \
  && mv "/usr/local/bin/${WALG_DIST}" /usr/local/bin/wal-g \
  && chmod 0755 /usr/local/bin/wal-g \
  && rm /tmp/wal-g.tar.gz \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && wal-g --version \
  && mkdir -p /backups \
  && chown postgres:postgres /backups \
  && chmod 0700 /backups
