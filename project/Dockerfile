# Dependencies are installed in a builder so the final image never carries a
# package cache: bun hardlinks node_modules out of /root/.bun/install/cache,
# which is 179MB of the shipped image and only 31MB of it unique. `COPY --from`
# dereferences those links, so the cache stays behind in the builder.
FROM oven/bun:1.3.5 AS deps

WORKDIR /app
COPY package.json bun.lock ./
# --production drops typescript and @types (32MB): bun executes .ts directly,
# so nothing in /app needs a compiler at run time.
RUN bun install --frozen-lockfile --production

RUN mkdir -p /opt/pglite \
 && cd /opt/pglite \
 && bun add @electric-sql/pglite @electric-sql/pglite-socket

FROM oven/bun:1.3.5

ARG SWEAT_VERSION=dev

LABEL org.opencontainers.image.source="https://github.com/4ug-aug/sweat-v2" \
      org.opencontainers.image.version="$SWEAT_VERSION"

ENV OPENAI_AGENTS_DISABLE_TRACING=1

WORKDIR /app
RUN apt-get update && apt-get install --yes --no-install-recommends \
    git python3 python3-pip python3-venv python-is-python3 \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/share/doc /usr/share/man /usr/share/info /usr/share/locale

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /opt/pglite /opt/pglite
RUN printf '%s\n' '#!/bin/sh' 'exec bun /opt/pglite/node_modules/@electric-sql/pglite-socket/dist/scripts/server.js "$@"' > /usr/local/bin/pglite-server \
 && chmod +x /usr/local/bin/pglite-server

COPY roles /app/roles
COPY runtime /app/runtime
COPY skills /app/skills

WORKDIR /work
