import type { ImportedPlaylist, PlaylistImportInput, PlaylistImportSeed } from "@claudio/core";
import { fetchNeteasePlaylist } from "./netease.js";
import { getImportedPlaylistByKey, getStoredPlaylists, replaceStoredPlaylist, saveImportedPlaylist } from "./library-store.js";
import { fetchQqPlaylist } from "./qq.js";
import { parsePlaylistLinks } from "./link-parser.js";
import { seedLinks } from "./seed-links.js";

export class MusicImporter {
  getSeed(): PlaylistImportSeed {
    return {
      inputs: parsePlaylistLinks(seedLinks)
    };
  }

  preview(rawUrls: string[]): PlaylistImportInput[] {
    return parsePlaylistLinks(rawUrls);
  }

  async reimportLegacyQqPlaylists(): Promise<void> {
    const library = await getStoredPlaylists();
    const qqEntries = library.playlists.filter((playlist) => playlist.source === "qq");

    for (const entry of qqEntries) {
      const stored = await getImportedPlaylistByKey(entry.key);
      if (!stored || stored.tracks.length === 0) {
        continue;
      }

      const needsRefresh = stored.tracks.some((track) => !track.songId || !track.songMid);
      if (!needsRefresh) {
        continue;
      }

      const input = this.preview([entry.canonicalUrl])[0];
      if (!input) {
        continue;
      }

      const refreshed = await fetchQqPlaylist(input);
      await replaceStoredPlaylist(refreshed);
    }
  }

  async importPlaylist(input: PlaylistImportInput): Promise<ImportedPlaylist> {
    let playlist: ImportedPlaylist;

    if (input.source === "netease") {
      playlist = await fetchNeteasePlaylist(input);
    } else if (input.source === "qq") {
      playlist = await fetchQqPlaylist(input);
    } else {
      throw new Error(`Import not implemented yet for source: ${input.source}`);
    }

    await saveImportedPlaylist(playlist);
    return playlist;
  }
}
