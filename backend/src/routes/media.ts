import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { writeFile, unlink, mkdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const mediaRouter = new Hono<{ Variables: AuthVariables }>();

// Configuration
//
// Where user uploads live on disk. This used to be hardcoded to
// `process.cwd()/uploads`, which is inside the container image on any modern
// host — so every image, video, and audio clip a user had posted vanished on
// the next deploy while the Media rows still referenced them.
//
// UPLOADS_DIR lets the host point this at a persistent volume (the Dockerfile
// sets /data/uploads). The old path stays the default so a local checkout and
// the current deployment behave exactly as before.
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), "uploads");
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

// Ensure uploads directory exists
async function ensureUploadsDir(): Promise<void> {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }
  // Create subdirectories for organization
  const subdirs = ["images", "videos", "audio", "thumbnails"];
  for (const subdir of subdirs) {
    const path = join(UPLOADS_DIR, subdir);
    if (!existsSync(path)) {
      await mkdir(path, { recursive: true });
    }
  }
}

// Generate a unique filename
function generateFilename(originalName: string, extension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const sanitized = originalName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
  return `${timestamp}_${random}_${sanitized}${extension}`;
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
 * POST /api/media/upload
 * Upload a media file
 */
mediaRouter.post("/upload", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    await ensureUploadsDir();

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

    // Generate filename and paths
    const extension = MIME_TO_EXTENSION[file.type] || "";
    const filename = generateFilename(file.name, extension);
    const subdir = mimeConfig.type === "image" ? "images" : mimeConfig.type === "video" ? "videos" : "audio";
    const filePath = join(UPLOADS_DIR, subdir, filename);
    const relativePath = `/${subdir}/${filename}`;

    // Write file to disk
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(arrayBuffer));

    // Initialize metadata
    let thumbnailUrl: string | null = null;
    let durationMs: number | null = null;
    let width: number | null = null;
    let height: number | null = null;

    // Process based on media type
    if (mimeConfig.type === "video") {
      // Generate thumbnail
      const thumbnailFilename = filename.replace(extension, "_thumb.jpg");
      const thumbnailPath = join(UPLOADS_DIR, "thumbnails", thumbnailFilename);
      const thumbnailGenerated = await generateVideoThumbnail(filePath, thumbnailPath);
      if (thumbnailGenerated) {
        thumbnailUrl = `/thumbnails/${thumbnailFilename}`;
      }

      // Get video duration and dimensions
      durationMs = await getMediaDuration(filePath);
      const dimensions = await getImageDimensions(filePath);
      if (dimensions) {
        width = dimensions.width;
        height = dimensions.height;
      }
    } else if (mimeConfig.type === "audio") {
      // Get audio duration
      durationMs = await getMediaDuration(filePath);
    } else if (mimeConfig.type === "image") {
      // Get image dimensions
      const dimensions = await getImageDimensions(filePath);
      if (dimensions) {
        width = dimensions.width;
        height = dimensions.height;
      }
    }

    // Create database record
    const media = await prisma.media.create({
      data: {
        userId: user.id,
        type: mimeConfig.type,
        url: relativePath,
        thumbnailUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        durationMs,
        width,
        height,
      },
    });

    const response: MediaResponse = {
      id: media.id,
      type: media.type,
      url: `/uploads${media.url}`,
      thumbnailUrl: media.thumbnailUrl ? `/uploads${media.thumbnailUrl}` : null,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      durationMs: media.durationMs,
      width: media.width,
      height: media.height,
      createdAt: media.createdAt.toISOString(),
    };

    return c.json({ media: response }, 201);
  } catch (error) {
    console.error("Media upload error:", error);
    return c.json({ error: "Failed to upload media" }, 500);
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

  const response: MediaResponse = {
    id: media.id,
    type: media.type,
    url: `/uploads${media.url}`,
    thumbnailUrl: media.thumbnailUrl ? `/uploads${media.thumbnailUrl}` : null,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    createdAt: media.createdAt.toISOString(),
  };

  return c.json({ media: response });
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

  // Delete files from disk
  try {
    const filePath = join(UPLOADS_DIR, media.url);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }

    if (media.thumbnailUrl) {
      const thumbnailPath = join(UPLOADS_DIR, media.thumbnailUrl);
      if (existsSync(thumbnailPath)) {
        await unlink(thumbnailPath);
      }
    }
  } catch (error) {
    console.error("Failed to delete media files:", error);
    // Continue with database deletion even if file deletion fails
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
      media: results.map((m): MediaResponse => ({
        id: m.id,
        type: m.type,
        url: `/uploads${m.url}`,
        thumbnailUrl: m.thumbnailUrl ? `/uploads${m.thumbnailUrl}` : null,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    });
  }
);

export { mediaRouter };
