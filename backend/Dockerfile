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

# Uploads default to local disk, which on this image means the container's own
# filesystem — fine for a smoke test, wrong for a deployment. Set MEDIA_STORAGE=s3
# and the S3_* variables (see .env.example) so media survives a redeploy and is
# not tied to one host. UPLOADS_DIR only matters if you deliberately keep the
# local driver and mount a persistent volume here.
ENV UPLOADS_DIR=/data/uploads
RUN mkdir -p /data/uploads

# The commit this image was built from, reported by /health.
#
# Any builder can pass --build-arg GIT_SHA=$(git rev-parse HEAD), and that wins
# where it is set. It is NOT how this project's deploys are stamped, though:
# `railway up` uploads a tarball with no git metadata (.git is excluded a few
# lines above, and the CLI is not a git client), so .github/workflows/deploy.yml
# writes the commit into backend/BUILD_COMMIT before uploading and the server
# reads that file. See buildVersion() in src/index.ts.
#
# Left unset by everything, /health says "unknown" — which is better than
# silently claiming to be up to date.
ARG GIT_SHA=unknown
ARG BUILD_TIME=""
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Applies committed migrations, then starts the server. Deliberately NOT
# `prisma db push` — that used to run here and reshaped the database to match
# whichever service booted last, destroying 423 rows of User.banned once.
CMD ["sh", "-c", "bunx prisma migrate deploy && exec bun src/index.ts"]
