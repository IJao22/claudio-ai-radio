import type { ImportedPlaylist, ImportedTrack, PlaylistImportInput } from "@claudio/core";

type NeteaseTrack = {
  id: number;
  name: string;
  ar?: Array<{ name: string }>;
  al?: {
    name?: string;
    picUrl?: string;
  };
  artists?: Array<{ name: string }>;
  album?: {
    name?: string;
    picUrl?: string;
  };
  dt?: number;
  duration?: number;
};

type NeteasePlaylistResponse = {
  code: number;
  playlist?: {
    id: number;
    name: string;
    coverImgUrl?: string;
    trackCount?: number;
    playCount?: number;
    creator?: {
      nickname?: string;
    };
    tracks?: NeteaseTrack[];
    trackIds?: Array<{ id: number }>;
  };
};

type NeteaseSongDetailResponse = {
  code: number;
  songs?: NeteaseTrack[];
};

function mapTrack(track: NeteaseTrack): ImportedTrack {
  const artists = track.ar ?? track.artists ?? [];
  const album = track.al ?? track.album;

  return {
    id: String(track.id),
    title: track.name,
    artist: artists.map((artist) => artist.name).join(", "),
    album: album?.name ?? "",
    durationMs: track.dt ?? track.duration ?? 0,
    coverUrl: album?.picUrl,
    trackId: String(track.id)
  };
}

async function fetchSongDetailBatch(ids: number[]): Promise<NeteaseTrack[]> {
  const query = encodeURIComponent(JSON.stringify(ids.map((id) => ({ id }))));
  const response = await fetch(`https://music.163.com/api/v3/song/detail?c=${query}`, {
    headers: {
      "user-agent": "Mozilla/5.0 Claudio/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`NetEase song detail request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as NeteaseSongDetailResponse;
  if (payload.code !== 200 || !payload.songs) {
    throw new Error("NetEase song detail payload was invalid");
  }

  return payload.songs;
}

async function fetchAllTracks(playlist: NonNullable<NeteasePlaylistResponse["playlist"]>): Promise<NeteaseTrack[]> {
  const initialTracks = playlist.tracks ?? [];
  const trackIds = (playlist.trackIds ?? []).map((item) => item.id);

  if (trackIds.length <= initialTracks.length) {
    return initialTracks;
  }

  const result: NeteaseTrack[] = [];
  const batchSize = 200;

  for (let index = 0; index < trackIds.length; index += batchSize) {
    const batch = trackIds.slice(index, index + batchSize);
    const songs = await fetchSongDetailBatch(batch);
    result.push(...songs);
  }

  return result;
}

export async function fetchNeteasePlaylist(input: PlaylistImportInput): Promise<ImportedPlaylist> {
  const url = `https://music.163.com/api/v6/playlist/detail?id=${input.id}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Claudio/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`NetEase request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as NeteasePlaylistResponse;
  if (payload.code !== 200 || !payload.playlist) {
    throw new Error(`NetEase playlist fetch failed for ${input.id}`);
  }

  const playlist = payload.playlist;
  const tracks = await fetchAllTracks(playlist);

  return {
    source: "netease",
    id: String(playlist.id),
    title: playlist.name,
    creator: playlist.creator?.nickname ?? "unknown",
    trackCount: playlist.trackCount ?? playlist.tracks?.length ?? 0,
    playCount: playlist.playCount,
    coverUrl: playlist.coverImgUrl,
    canonicalUrl: input.canonicalUrl,
    tracks: tracks.map(mapTrack)
  };
}
