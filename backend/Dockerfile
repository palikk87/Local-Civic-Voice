# Civic Voice API.
#
# Bun rather than Node: the app is written against Bun's runtime (scripts/start
# execs `bun src/index.ts`) and the lockfile is bun.lock.
#
# ffmpeg is a hard requirement, not an optimisation. src/routes/media.ts shells
# out to ffmpeg/ffprobe for video thumbnails and duration, and degrades SILENTLY
# when they are missing — uploads appear to succeed and simply have no thumbnail.
# A base image without it looks healthy and quietly loses data.
FROM oven/bun:1.3-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Prisma client is generated at build time; the schema is needed for it and for
# `migrate deploy` at boot.
COPY prisma ./prisma
RUN bunx prisma generate

COPY . .

# User uploads. Mount a persistent volume here, or every image and video a user
# has posted disappears on the next deploy while the database rows still point
# at them. See UPLOADS_DIR in src/routes/media.ts.
ENV UPLOADS_DIR=/data/uploads
RUN mkdir -p /data/uploads

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Applies committed migrations, then starts the server. Deliberately NOT
# `prisma db push` — that used to run here and reshaped the database to match
# whichever service booted last, destroying 423 rows of User.banned once.
CMD ["sh", "-c", "bunx prisma migrate deploy && exec bun src/index.ts"]
