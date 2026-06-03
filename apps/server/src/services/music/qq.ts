import type { ImportedPlaylist, ImportedTrack, PlaylistImportInput } from "@claudio/core";

type QqShortLinkResolution = {
  id: string;
  canonicalUrl: string;
};

type QqSong = {
  songid?: number;
  id?: number;
  songmid?: string;
  mid?: string;
  songname?: string;
  title?: string;
  singer?: Array<{ name?: string }>;
  albumname?: string;
  album?: {
    name?: string;
  };
  albummid?: string;
  interval?: number;
};

type QqPlaylistEntry = {
  disstid?: string;
  dissname?: string;
  nickname?: string;
  logo?: string;
  visitnum?: number;
  songnum?: number;
  total_song_num?: number;
  songlist?: QqSong[];
};

type QqPlaylistResponse = {
  code?: number;
  cdlist?: QqPlaylistEntry[];
};

function parseRedirectedPlaylistId(location: string): QqShortLinkResolution | null {
  try {
    const url = new URL(location);
    const id = url.searchParams.get("id");
    if (!id) {
      return null;
    }

    return {
      id,
      canonicalUrl: `https://y.qq.com/n/ryqq_v2/playlist/${id}`
    };
  } catch {
    return null;
  }
}

async function resolveQqPlaylistInput(input: PlaylistImportInput): Promise<QqShortLinkResolution> {
  if (/^\d+$/.test(input.id)) {
    return {
      id: input.id,
      canonicalUrl: `https://y.qq.com/n/ryqq_v2/playlist/${input.id}`
    };
  }

  const response = await fetch(input.canonicalUrl, {
    redirect: "manual",
    headers: {
      "user-agent": "Mozilla/5.0 Claudio/0.1"
    }
  });

  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`QQ Music short link did not return a playlist redirect for ${input.id}`);
  }

  const resolved = parseRedirectedPlaylistId(location);
  if (!resolved) {
    throw new Error(`QQ Music redirect did not contain a valid playlist id for ${input.id}`);
  }

  return resolved;
}

function getAlbumCoverUrl(albumMid?: string): string | undefined {
  if (!albumMid) {
    return undefined;
  }

  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
}

function mapTrack(track: QqSong): ImportedTrack {
  const artists = (track.singer ?? [])
    .map((item) => item.name?.trim())
    .filter((name): name is string => Boolean(name));
  const albumName = track.albumname ?? track.album?.name ?? "";
  const songId = String(track.songid ?? track.id ?? "");
  const songMid = track.songmid ?? track.mid ?? "";
  const albumMid = track.albummid;

  return {
    id: songId || songMid,
    title: track.songname ?? track.title ?? "Unknown Track",
    artist: artists.join(", "),
    album: albumName,
    durationMs: (track.interval ?? 0) * 1000,
    coverUrl: getAlbumCoverUrl(albumMid),
    songId: songId || undefined,
    songMid: songMid || undefined,
    albumMid
  };
}

export async function fetchQqPlaylist(input: PlaylistImportInput): Promise<ImportedPlaylist> {
  const resolved = await resolveQqPlaylistInput(input);
  const apiUrl = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${resolved.id}&format=json`;
  const response = await fetch(apiUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 Claudio/0.1",
      referer: "https://y.qq.com/"
    }
  });

  if (!response.ok) {
    throw new Error(`QQ Music request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as QqPlaylistResponse;
  const playlist = payload.cdlist?.[0];

  if (payload.code !== 0 || !playlist) {
    throw new Error(`QQ Music playlist fetch failed for ${resolved.id}`);
  }

  const tracks = (playlist.songlist ?? []).map(mapTrack).filter((track) => track.id);

  return {
    source: "qq",
    id: resolved.id,
    title: playlist.dissname ?? "QQ Playlist",
    creator: playlist.nickname ?? "unknown",
    trackCount: playlist.songnum ?? playlist.total_song_num ?? tracks.length,
    playCount: playlist.visitnum,
    coverUrl: playlist.logo,
    canonicalUrl: resolved.canonicalUrl,
    tracks
  };
}
