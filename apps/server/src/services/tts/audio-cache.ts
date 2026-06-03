import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { getTtsAudioCacheDirPath } from "../storage-paths.js";

const cacheDir = getTtsAudioCacheDirPath();
const cleanupIntervalMs = 6 * 60 * 60 * 1000;
const maxFileAgeMs = 24 * 60 * 60 * 1000;
let lastCleanupAt = 0;

export async function ensureTtsAudioCacheDir() {
  await mkdir(cacheDir, { recursive: true });
}

export function buildTtsCacheKey(parts: Record<string, string | number | undefined>) {
  const normalized = Object.entries(parts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join("\n");

  return createHash("sha1").update(normalized).digest("hex");
}

export function resolveTtsAudioFilePath(fileName: string) {
  return join(cacheDir, fileName);
}

export async function fileExists(pathValue: string) {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

export function createTtsAudioReadStream(pathValue: string) {
  return createReadStream(pathValue);
}

export function getTtsAudioContentType(fileName: string) {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".wav") {
    return "audio/wav";
  }

  if (extension === ".ogg") {
    return "audio/ogg";
  }

  return "audio/mpeg";
}

export async function cleanupStaleTtsAudioCache() {
  const now = Date.now();
  if (now - lastCleanupAt < cleanupIntervalMs) {
    return;
  }

  lastCleanupAt = now;
  await ensureTtsAudioCacheDir();

  const entries = await readdir(cacheDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return;
    }

    const absolutePath = join(cacheDir, entry.name);
    try {
      const details = await stat(absolutePath);
      if (now - details.mtimeMs > maxFileAgeMs) {
        await rm(absolutePath, { force: true });
      }
    } catch {
      // Ignore best-effort cache cleanup errors.
    }
  }));
}
