# WhatsApp bot image. Build from the repository root with docker compose (see docs/DEPLOYMENT.md).

# ---- dependencies (git is needed because Baileys installs libsignal from GitHub) ----
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# Prefer HTTPS for GitHub so no SSH key is needed inside the build.
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && npm ci --omit=dev --no-audit --no-fund

# ---- yt-dlp nightly (official standalone binary, SHA-256 verified) ----
FROM debian:bookworm-slim AS ytdlp
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in arm64) asset=yt-dlp_linux_aarch64 ;; *) asset=yt-dlp_linux ;; esac; \
    base=https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download; \
    curl -fsSLO "$base/$asset"; \
    curl -fsSLO "$base/SHA2-256SUMS"; \
    grep " ${asset}$" SHA2-256SUMS | sha256sum -c -; \
    mv "$asset" yt-dlp; \
    chmod 755 yt-dlp

# ---- runtime ----
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    LOG_FORMAT=json \
    HEALTH_HOST=0.0.0.0 \
    HEALTH_PORT=3000 \
    SESSION_DIR=/app/session \
    DATA_DIR=/app/data \
    TMP_DIR=/app/tmp \
    YTDLP_PATH=/app/bin/yt-dlp

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src
COPY assets ./assets
# yt-dlp lives in a folder owned by the bot user so ".update now" can update it in place.
COPY --from=ytdlp --chown=node:node /dl/yt-dlp /app/bin/yt-dlp

# Run as the unprivileged "node" user (uid 1000). Session and data live in volumes.
RUN mkdir -p /app/session /app/data /app/tmp && chown -R node:node /app/session /app/data /app/tmp /app/bin
USER node

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
