import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportedPlaylist } from "@claudio/core";
import { getImportsDirPath } from "../storage-paths.js";

type LibraryIndex = {
  updatedAt: string;
  latestPlaylistId?: string;
  playlists: Array<{
    key: string;
    source: ImportedPlaylist["source"];
    id: string;
    title: string;
    creator: string;
    trackCount: number;
    coverUrl?: string;
    canonicalUrl: string;
    importedAt: string;
  }>;
};

const libraryDir = getImportsDirPath();
const indexPath = join(libraryDir, "library.json");

function getPlaylistKey(playlist: Pick<ImportedPlaylist, "source" | "id">): string {
  return `${playlist.source}-${playlist.id}`;
}

function getPlaylistPath(playlist: Pick<ImportedPlaylist, "source" | "id">): string {
  return join(libraryDir, `${getPlaylistKey(playlist)}.json`);
}

async function ensureLibraryDir() {
  await mkdir(libraryDir, { recursive: true });
}

async function readIndex(): Promise<LibraryIndex> {
  await ensureLibraryDir();

  try {
    const raw = await readFile(indexPath, "utf8");
    return JSON.parse(raw) as LibraryIndex;
  } catch {
    return {
      updatedAt: new Date(0).toISOString(),
      playlists: []
    };
  }
}

async function writeIndex(index: LibraryIndex) {
  await ensureLibraryDir();
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

async function readStoredPlaylist(
  playlist: Pick<ImportedPlaylist, "source" | "id"> | { key: string; source: ImportedPlaylist["source"]; id: string }
): Promise<ImportedPlaylist | null> {
  try {
    const raw = await readFile(getPlaylistPath(playlist), "utf8");
    return JSON.parse(raw) as ImportedPlaylist;
  } catch {
    return null;
  }
}

export async function saveImportedPlaylist(playlist: ImportedPlaylist): Promise<void> {
  await ensureLibraryDir();

  const importedAt = new Date().toISOString();
  await writeFile(getPlaylistPath(playlist), JSON.stringify(playlist, null, 2), "utf8");

  const index = await readIndex();
  const key = getPlaylistKey(playlist);
  const playlists = index.playlists.filter((item) => item.key !== key);
  playlists.unshift({
    key,
    source: playlist.source,
    id: playlist.id,
    title: playlist.title,
    creator: playlist.creator,
    trackCount: playlist.trackCount,
    coverUrl: playlist.coverUrl,
    canonicalUrl: playlist.canonicalUrl,
    importedAt
  });

  await writeIndex({
    updatedAt: importedAt,
    latestPlaylistId: key,
    playlists
  });
}

export async function replaceStoredPlaylist(playlist: ImportedPlaylist): Promise<void> {
  await ensureLibraryDir();

  await writeFile(getPlaylistPath(playlist), JSON.stringify(playlist, null, 2), "utf8");

  const index = await readIndex();
  const key = getPlaylistKey(playlist);
  const playlists = index.playlists.map((entry) => {
    if (entry.key !== key) {
      return entry;
    }

    return {
      ...entry,
      source: playlist.source,
      id: playlist.id,
      title: playlist.title,
      creator: playlist.creator,
      trackCount: playlist.trackCount,
      coverUrl: playlist.coverUrl,
      canonicalUrl: playlist.canonicalUrl
    };
  });

  await writeIndex({
    ...index,
    updatedAt: new Date().toISOString(),
    playlists
  });
}

export async function getStoredPlaylists(): Promise<LibraryIndex> {
  return readIndex();
}

export async function getLatestImportedPlaylist(): Promise<ImportedPlaylist | null> {
  const index = await readIndex();
  const key = index.latestPlaylistId ?? index.playlists[0]?.key;

  if (!key) {
    return null;
  }

  const entry = index.playlists.find((item) => item.key === key);
  if (!entry) {
    return null;
  }

  return readStoredPlaylist(entry);
}

export async function getImportedPlaylistByKey(key: string): Promise<ImportedPlaylist | null> {
  const index = await readIndex();
  const entry = index.playlists.find((item) => item.key === key);

  if (!entry) {
    return null;
  }

  return readStoredPlaylist(entry);
}

export async function getAllImportedPlaylists(): Promise<ImportedPlaylist[]> {
  const index = await readIndex();
  const playlists = await Promise.all(index.playlists.map((entry) => readStoredPlaylist(entry)));
  return playlists.filter((playlist): playlist is ImportedPlaylist => Boolean(playlist));
}
