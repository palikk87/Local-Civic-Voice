import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { writeFile, mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { putObject, publicUrlFor } from "../services/storage";
import { purgeMediaObjects } from "../services/media-objects";

const execAsync = promisify(exec);

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const mediaRouter = new Hono<{ Variables: AuthVariables }>();

// Configuration
//
// Bytes go to services/storage.ts, which is either an S3-compatible bucket or
// local disk depending on MEDIA_STORAGE. This route no longer knows or cares:
// it hands over a key and gets back a URL.
//
// It does still need a real filesystem, but only briefly — ffmpeg and ffprobe
// read files, not streams, so an upload lands in a per-request temp directory
// long enough to be probed and thumbnailed, then is uploaded and deleted. The
// temp directory is scratch space; nothing durable lives there.
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB

// Allowed MIME types
const ALLOWED_MIME_TYPES: Record<string, { type: "image" | "video" | "audio"; maxSize: number }> = {
  // Images
  "image/jpeg": { type: "image", maxSize: MAX_IMAGE_SIZE },
  "image/png": { type: "image", maxSize: MAX_IMAGE_SIZE },
  "image/gif": { type: "image", maxSize: MAX_IMAGE_SIZE },
  "image/webp": { type: "image", maxSize: MAX_IMAGE_SIZE },
  // Videos
  "video/mp4": { type: "video", maxSize: MAX_VIDEO_SIZE },
  "video/quicktime": { type: "video", maxSize: MAX_VIDEO_SIZE },
  "video/webm": { type: "video", maxSize: MAX_VIDEO_SIZE },
  // Audio
  "audio/mpeg": { type: "audio", maxSize: MAX_AUDIO_SIZE },
  "audio/mp4": { type: "audio", maxSize: MAX_AUDIO_SIZE },
  "audio/x-m4a": { type: "audio", maxSize: MAX_AUDIO_SIZE },
  "audio/wav": { type: "audio", maxSize: MAX_AUDIO_SIZE },
  "audio/x-wav": { type: "audio", maxSize: MAX_AUDIO_SIZE },
};

// File extension mapping
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

/**
 * Scratch space for one upload, so ffmpeg/ffprobe have real files to read.
 *
 * The name is random rather than `Date.now()` + `Math.random()`, which is what
 * it used to be. tmpdir() is a shared directory, and a predictable path there
 * is a path another process can create first — as a symlink pointing somewhere
 * it should not be able to write. `mkdir` with `recursive: true` does not fail
 * on an existing directory, so the upload would then be written through it.
 *
 * `mode: 0o700` for the same reason: nothing else needs to read a half-uploaded
 * file, and on a shared host the default would let it.
 */
async function makeScratchDir(): Promise<string> {
  const dir = join(tmpdir(), `ayeandnay-upload-${randomBytes(12).toString("base64url")}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * The random part of a stored object's key.
 *
 * This is NOT a session token and deliberately does not come from
 * src/session-token.ts — that module names what it makes, and a media key is a
 * different kind of thing: it identifies an object, it is meant to appear in
 * every `<img src>` in the app, and it is not a credential anyone presents. The
 * one thing it shares with a session token is where its randomness comes from,
 * and one line of `randomBytes` is not worth coupling two unrelated concepts
 * together to avoid.
 *
 * It has to be unguessable because the bucket answers to whoever knows the key.
 * services/storage.ts issues no signed URLs — `publicUrlFor()` returns a plain
 * unsigned URL, and the bucket has to be publicly readable for that to work
 * (see the module header there and the storage section of DEPLOYMENT.md). So
 * the key IS the access control. Anyone who can guess one can fetch the object,
 * whether or not the post it belongs to was ever published.
 *
 * What it replaces was guessable in three separate ways at once:
 *
 *   `${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${name}`
 *
 *   - Date.now() is public. The API returns createdAt on the post and on the
 *     media row, so the millisecond window is small and known.
 *   - Math.random() is V8's xorshift128+, not a CSPRNG. Its state can be solved
 *     for from a handful of outputs — and the upload endpoint hands the caller
 *     a fresh output every time it is used. Upload a few files of your own,
 *     recover the state, and you can predict the random half of everyone else's
 *     uploads in that process. The API runs as a single pinned instance, so
 *     "that process" is all of them.
 *   - The user's original filename was embedded in the key, sanitised but not
 *     removed, which both narrowed the search and published the filename.
 *
 * 16 bytes from the OS CSPRNG, base64url, is 128 bits in 22 characters. There
 * is no way to amplify a guess here — each attempt is one HTTP request against
 * a bucket — so 128 bits is far past sufficient, and shorter than 32 bytes
 * matters a little when the value is in every image URL the app renders.
 */
function randomObjectStem(): string {
  return randomBytes(16).toString("base64url");
}

// Check if ffmpeg is available
async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version");
    return true;
  } catch {
    return false;
  }
}

// Generate video thumbnail using ffmpeg
async function generateVideoThumbnail(videoPath: string, thumbnailPath: string): Promise<boolean> {
  try {
    const ffmpegAvailable = await isFFmpegAvailable();
    if (!ffmpegAvailable) {
      console.log("FFmpeg not available, skipping thumbnail generation");
      return false;
    }

    // Extract a frame at 1 second (or first frame if video is shorter)
    await execAsync(
      `ffmpeg -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf "scale=320:-1" -y "${thumbnailPath}"`,
      { timeout: 30000 }
    );
    return true;
  } catch (error) {
    console.error("Failed to generate video thumbnail:", error);
    return false;
  }
}

// Get video duration using ffprobe
async function getMediaDuration(filePath: string): Promise<number | null> {
  try {
    const ffmpegAvailable = await isFFmpegAvailable();
    if (!ffmpegAvailable) {
      return null;
    }

    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 10000 }
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? null : Math.round(duration * 1000); // Convert to milliseconds
  } catch {
    return null;
  }
}

// Get image dimensions
async function getImageDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    // Try using ffprobe first
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`,
      { timeout: 10000 }
    );
    const parts = stdout.trim().split("x");
    const width = parts[0] ? Number(parts[0]) : NaN;
    const height = parts[1] ? Number(parts[1]) : NaN;
    if (!isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

// Media response type for type safety
interface MediaResponse {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/**
 * The one place a stored key becomes a URL.
 *
 * `media.url` holds a storage key ("images/abc.jpg"), never a URL, so the same
 * row renders correctly whether the bytes sit in a bucket or on local disk —
 * and keeps rendering if the bucket moves to another provider. Building the URL
 * used to be three hand-written `/uploads${...}` template strings in three
 * handlers, which is exactly the kind of thing that drifts.
 */
function toMediaResponse(media: {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}): MediaResponse {
  return {
    id: media.id,
    type: media.type,
    url: publicUrlFor(media.url),
    thumbnailUrl: media.thumbnailUrl ? publicUrlFor(media.thumbnailUrl) : null,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    createdAt: media.createdAt.toISOString(),
  };
}

/**
 * POST /api/media/upload
 * Upload a media file
 */
mediaRouter.post("/upload", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  let scratchDir: string | null = null;

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate MIME type
    const mimeConfig = ALLOWED_MIME_TYPES[file.type];
    if (!mimeConfig) {
      return c.json(
        {
          error: "Unsupported file type",
          allowed: Object.keys(ALLOWED_MIME_TYPES)
        },
        400
      );
    }

    // Validate file size
    if (file.size > mimeConfig.maxSize) {
      const maxMB = Math.round(mimeConfig.maxSize / (1024 * 1024));
      return c.json(
        {
          error: `File too large. Maximum size for ${mimeConfig.type} is ${maxMB}MB`,
          maxSize: mimeConfig.maxSize,
          actualSize: file.size
        },
        400
      );
    }

    // Storage keys. No leading slash: these are object keys, not URL paths, and
    // publicUrlFor() turns them into whichever URL the configured driver serves.
    //
    // One random stem, both names derived from it. The original filename is
    // deliberately not in here: a key is a public URL, so a user-chosen string
    // in it publishes whatever the file was called on their device. Nothing on
    // either client reads it back out.
    const extension = MIME_TO_EXTENSION[file.type] || "";
    const stem = randomObjectStem();
    const filename = `${stem}${extension}`;
    const subdir = mimeConfig.type === "image" ? "images" : mimeConfig.type === "video" ? "videos" : "audio";
    const key = `${subdir}/${filename}`;

    // Land the bytes in scratch space so ffprobe/ffmpeg can read them.
    scratchDir = await makeScratchDir();
    const scratchPath = join(scratchDir, filename);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(scratchPath, bytes);

    // Initialize metadata
    let thumbnailKey: string | null = null;
    let durationMs: number | null = null;
    let width: number | null = null;
    let height: number | null = null;

    // Process based on media type
    if (mimeConfig.type === "video") {
      // Built from the stem, not by string-replacing the extension off the
      // filename. `"x".replace("", "_thumb.jpg")` PREPENDS, so the old form
      // produced a mangled name for any mime with no extension mapping.
      const thumbnailFilename = `${stem}_thumb.jpg`;
      const thumbnailScratchPath = join(scratchDir, thumbnailFilename);
      const thumbnailGenerated = await generateVideoThumbnail(scratchPath, thumbnailScratchPath);
      if (thumbnailGenerated) {
        // Upload the thumbnail before the record exists. If this throws, the
        // catch below returns 500 and no Media row is written — better than a
        // row promising a thumbnail that was never stored.
        thumbnailKey = `thumbnails/${thumbnailFilename}`;
        await putObject(thumbnailKey, await readFile(thumbnailScratchPath), "image/jpeg");
      }

      durationMs = await getMediaDuration(scratchPath);
      const dimensions = await getImageDimensions(scratchPath);
      if (dimensions) {
        width = dimensions.width;
        height = dimensions.height;
      }
    } else if (mimeConfig.type === "audio") {
      durationMs = await getMediaDuration(scratchPath);
    } else if (mimeConfig.type === "image") {
      const dimensions = await getImageDimensions(scratchPath);
      if (dimensions) {
        width = dimensions.width;
        height = dimensions.height;
      }
    }

    // Store the original only after probing succeeded.
    await putObject(key, bytes, file.type);

    // Create database record
    const media = await prisma.media.create({
      data: {
        userId: user.id,
        type: mimeConfig.type,
        url: key,
        thumbnailUrl: thumbnailKey,
        mimeType: file.type,
        sizeBytes: file.size,
        durationMs,
        width,
        height,
      },
    });

    return c.json({ media: toMediaResponse(media) }, 201);
  } catch (error) {
    console.error("Media upload error:", error);
    return c.json({ error: "Failed to upload media" }, 500);
  } finally {
    // Scratch space is per-request and must go whether we succeeded or not;
    // leaking it fills the container's disk one upload at a time.
    if (scratchDir) {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

/**
 * GET /api/media/:id
 * Get media details
 */
mediaRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const media = await prisma.media.findUnique({
    where: { id },
  });

  if (!media) {
    return c.json({ error: "Media not found" }, 404);
  }

  return c.json({ media: toMediaResponse(media) });
});

/**
 * DELETE /api/media/:id
 * Delete media (owner only)
 */
mediaRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");

  const media = await prisma.media.findUnique({
    where: { id },
  });

  if (!media) {
    return c.json({ error: "Media not found" }, 404);
  }

  if (media.userId !== user.id) {
    return c.json({ error: "Not authorized" }, 403);
  }

  // Bytes before row; see services/media-objects.ts for the policy.
  //
  // This used to swallow the storage error and delete the row anyway, arguing
  // that an orphaned object costs storage while an undeletable item costs
  // trust. For a public unsigned bucket the first half is wrong: it costs
  // privacy, not storage, and the object becomes unfindable as well.
  const purge = await purgeMediaObjects([media], `media ${id}`);
  if (!purge.ok) {
    return c.json({ error: purge.message }, 500);
  }

  // Delete database record
  await prisma.media.delete({ where: { id } });

  return c.json({ success: true });
});

/**
 * GET /api/media/user/:userId
 * Get all media for a user (paginated)
 */
const paginationSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
  type: z.enum(["image", "video", "audio"]).optional(),
});

mediaRouter.get(
  "/user/:userId",
  zValidator("query", paginationSchema),
  async (c) => {
    const userId = c.req.param("userId");
    const { limit, cursor, type } = c.req.valid("query");

    const media = await prisma.media.findMany({
      where: {
        userId,
        ...(type ? { type } : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
    });

    const hasMore = media.length > limit;
    const results = hasMore ? media.slice(0, -1) : media;
    const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

    return c.json({
      media: results.map(toMediaResponse),
      nextCursor,
      hasMore,
    });
  }
);

export { mediaRouter };
