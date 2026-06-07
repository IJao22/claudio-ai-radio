import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  TtsVoiceLibraryResponse,
  TtsVoiceProfile,
  TtsVoiceSelectRequest,
  TtsVoiceUploadRequest
} from "@claudio/core";
import { getConfigDirPath, getDataRootPath, getRepoRootPath, getTtsVoicesDirPath } from "../storage-paths.ts";

type StoredTtsVoice = {
  id: string;
  label: string;
  fileName: string;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
};

type StoredVoiceLibrary = {
  selectedVoiceId?: string;
  updatedAt?: string;
  voices: StoredTtsVoice[];
};

const repoRoot = getRepoRootPath();
const dataRoot = getDataRootPath();
const configDir = getConfigDirPath();
const voicesDir = getTtsVoicesDirPath();
const libraryPath = join(configDir, "tts-voices.local.json");
const DEFAULT_VOICE_ID = "system-default";
const allowedExtensions = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".webm"]);
const mimeExtensionMap: Record<string, string> = {
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/m4a": ".m4a",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-flac": ".flac",
  "audio/x-m4a": ".m4a",
  "audio/x-wav": ".wav"
};

async function ensureDirectories() {
  await mkdir(configDir, { recursive: true });
  await mkdir(voicesDir, { recursive: true });
}

async function fileExists(pathValue: string) {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

function sanitizeLabel(input?: string) {
  const normalized = (input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48);

  return normalized || "未命名音色";
}

function resolveStoredVoicePath(relativePath: string) {
  if (relativePath.startsWith("data/") || relativePath.startsWith("data\\")) {
    return join(repoRoot, relativePath);
  }

  return join(dataRoot, relativePath);
}

function inferExtension(fileName: string, mimeType?: string) {
  const byName = extname(fileName).toLowerCase();
  if (allowedExtensions.has(byName)) {
    return byName;
  }

  if (mimeType) {
    const byMime = mimeExtensionMap[mimeType.toLowerCase()];
    if (byMime) {
      return byMime;
    }
  }

  return ".wav";
}

function parseAudioPayload(audioBase64: string) {
  const trimmed = audioBase64.trim();
  const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(trimmed);

  if (match) {
    return {
      mimeType: match[1].trim(),
      base64: match[2].replace(/\s+/g, "")
    };
  }

  return {
    mimeType: undefined,
    base64: trimmed.replace(/\s+/g, "")
  };
}

async function readStoredLibrary(): Promise<StoredVoiceLibrary> {
  await ensureDirectories();

  try {
    const raw = await readFile(libraryPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredVoiceLibrary>;
    return {
      selectedVoiceId: parsed.selectedVoiceId,
      updatedAt: parsed.updatedAt,
      voices: Array.isArray(parsed.voices) ? parsed.voices : []
    };
  } catch {
    return {
      selectedVoiceId: DEFAULT_VOICE_ID,
      voices: []
    };
  }
}

async function writeStoredLibrary(library: StoredVoiceLibrary) {
  await ensureDirectories();
  await writeFile(libraryPath, JSON.stringify(library, null, 2), "utf8");
}

function toProfile(voice: StoredTtsVoice): TtsVoiceProfile {
  return {
    id: voice.id,
    label: voice.label,
    isDefault: false,
    createdAt: voice.createdAt,
    updatedAt: voice.updatedAt
  };
}

async function normalizeLibrary() {
  const stored = await readStoredLibrary();
  const availableVoices: StoredTtsVoice[] = [];
  let changed = false;

  for (const voice of stored.voices) {
    const absolutePath = resolveStoredVoicePath(voice.relativePath);
    if (await fileExists(absolutePath)) {
      availableVoices.push(voice);
      continue;
    }

    changed = true;
  }

  const selectedVoiceId =
    stored.selectedVoiceId === DEFAULT_VOICE_ID ||
    availableVoices.some((voice) => voice.id === stored.selectedVoiceId)
      ? stored.selectedVoiceId ?? DEFAULT_VOICE_ID
      : DEFAULT_VOICE_ID;

  if (selectedVoiceId !== stored.selectedVoiceId) {
    changed = true;
  }

  const normalized: StoredVoiceLibrary = {
    selectedVoiceId,
    updatedAt: stored.updatedAt,
    voices: availableVoices
  };

  if (changed) {
    normalized.updatedAt = new Date().toISOString();
    await writeStoredLibrary(normalized);
  }

  return normalized;
}

function toResponse(library: StoredVoiceLibrary): TtsVoiceLibraryResponse {
  return {
    selectedVoiceId: library.selectedVoiceId ?? DEFAULT_VOICE_ID,
    updatedAt: library.updatedAt,
    voices: [
      {
        id: DEFAULT_VOICE_ID,
        label: "系统默认音色",
        isDefault: true
      },
      ...library.voices.map(toProfile)
    ]
  };
}

export async function getTtsVoiceLibrary(): Promise<TtsVoiceLibraryResponse> {
  const library = await normalizeLibrary();
  return toResponse(library);
}

export async function getSelectedTtsVoicePath(): Promise<string | undefined> {
  const library = await normalizeLibrary();
  const selectedVoiceId = library.selectedVoiceId ?? DEFAULT_VOICE_ID;
  if (selectedVoiceId === DEFAULT_VOICE_ID) {
    return undefined;
  }

  const selectedVoice = library.voices.find((voice) => voice.id === selectedVoiceId);
  if (!selectedVoice) {
    return undefined;
  }

  return resolveStoredVoicePath(selectedVoice.relativePath);
}

export async function uploadTtsVoice(input: TtsVoiceUploadRequest): Promise<TtsVoiceLibraryResponse> {
  if (!input.fileName?.trim() || !input.audioBase64?.trim()) {
    throw new Error("Voice fileName and audioBase64 are required.");
  }

  const parsedAudio = parseAudioPayload(input.audioBase64);
  const buffer = Buffer.from(parsedAudio.base64, "base64");
  if (!buffer.length) {
    throw new Error("Uploaded voice payload is empty.");
  }

  const extension = inferExtension(input.fileName, parsedAudio.mimeType);
  const id = `voice-${randomUUID()}`;
  const fileName = `${id}${extension}`;
  const relativePath = join("tts-voices", fileName);
  const absolutePath = join(dataRoot, relativePath);
  const now = new Date().toISOString();

  await ensureDirectories();
  await writeFile(absolutePath, buffer);

  const library = await normalizeLibrary();
  const nextVoice: StoredTtsVoice = {
    id,
    label: sanitizeLabel(input.name || basename(input.fileName, extname(input.fileName))),
    fileName,
    relativePath,
    createdAt: now,
    updatedAt: now
  };

  const nextLibrary: StoredVoiceLibrary = {
    selectedVoiceId: id,
    updatedAt: now,
    voices: [...library.voices, nextVoice]
  };

  await writeStoredLibrary(nextLibrary);
  return toResponse(nextLibrary);
}

export async function selectTtsVoice(input: TtsVoiceSelectRequest): Promise<TtsVoiceLibraryResponse> {
  const voiceId = input.voiceId?.trim();
  if (!voiceId) {
    throw new Error("voiceId is required.");
  }

  const library = await normalizeLibrary();
  if (voiceId !== DEFAULT_VOICE_ID && !library.voices.some((voice) => voice.id === voiceId)) {
    throw new Error("Selected voice does not exist.");
  }

  const nextLibrary: StoredVoiceLibrary = {
    ...library,
    selectedVoiceId: voiceId,
    updatedAt: new Date().toISOString()
  };

  await writeStoredLibrary(nextLibrary);
  return toResponse(nextLibrary);
}

export async function deleteTtsVoice(voiceId: string): Promise<TtsVoiceLibraryResponse> {
  const normalizedVoiceId = voiceId.trim();
  if (!normalizedVoiceId || normalizedVoiceId === DEFAULT_VOICE_ID) {
    throw new Error("Default voice cannot be deleted.");
  }

  const library = await normalizeLibrary();
  const targetVoice = library.voices.find((voice) => voice.id === normalizedVoiceId);
  if (!targetVoice) {
    throw new Error("Voice does not exist.");
  }

  const absolutePath = resolveStoredVoicePath(targetVoice.relativePath);
  await rm(absolutePath, { force: true });

  const nextVoices = library.voices.filter((voice) => voice.id !== normalizedVoiceId);
  const nextLibrary: StoredVoiceLibrary = {
    voices: nextVoices,
    selectedVoiceId:
      library.selectedVoiceId === normalizedVoiceId ? DEFAULT_VOICE_ID : (library.selectedVoiceId ?? DEFAULT_VOICE_ID),
    updatedAt: new Date().toISOString()
  };

  await writeStoredLibrary(nextLibrary);
  return toResponse(nextLibrary);
}
