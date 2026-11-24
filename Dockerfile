# Builder stage: install once, build, then drop dev dependencies in place
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

COPY . .
RUN npm run build \
    && npm prune --omit=dev

# Runner stage: same base image, so no second npm install is needed
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5050
ENV OPTIC_PYTHON=/usr/bin/python3

# Optical reading needs Python + OpenCV. The headless wheel is far smaller
# than Debian's python3-opencv (which drags in Qt/GStreamer).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --break-system-packages --no-cache-dir \
        opencv-python-headless numpy

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/optical_processor.py ./server/optical_processor.py

# Ensure SQLite directory exists even when repository has no db folder
RUN mkdir -p /app/db

EXPOSE 5050

CMD ["npm", "start"]
