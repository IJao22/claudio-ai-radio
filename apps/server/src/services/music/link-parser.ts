import type { PlaylistImportInput } from "@claudio/core";

function tryParseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function parsePlaylistLink(rawUrl: string): PlaylistImportInput | null {
  const url = tryParseUrl(rawUrl);
  if (!url) {
    return null;
  }

  if (url.hostname.includes("music.163.com")) {
    const id = url.searchParams.get("id");
    if (!id) {
      return null;
    }

    return {
      source: "netease",
      rawUrl,
      id,
      canonicalUrl: `https://music.163.com/playlist?id=${id}`
    };
  }

  if (url.hostname.includes("c6.y.qq.com")) {
    const token = url.searchParams.get("__");
    if (!token) {
      return null;
    }

    return {
      source: "qq",
      rawUrl,
      id: token,
      canonicalUrl: `https://c6.y.qq.com/base/fcgi-bin/u?__=${token}`
    };
  }

  if (url.hostname.includes("y.qq.com")) {
    const playlistMatch = url.pathname.match(/\/playlist\/(\d+)/);
    if (playlistMatch) {
      const id = playlistMatch[1];
      return {
        source: "qq",
        rawUrl,
        id,
        canonicalUrl: `https://y.qq.com/n/ryqq_v2/playlist/${id}`
      };
    }
  }

  if (url.hostname.includes("i.y.qq.com") && url.pathname.includes("/taoge.html")) {
    const id = url.searchParams.get("id");
    if (!id) {
      return null;
    }

    return {
      source: "qq",
      rawUrl,
      id,
      canonicalUrl: `https://y.qq.com/n/ryqq_v2/playlist/${id}`
    };
  }

  return null;
}

export function parsePlaylistLinks(rawUrls: string[]): PlaylistImportInput[] {
  return rawUrls
    .map(parsePlaylistLink)
    .filter((item): item is PlaylistImportInput => item !== null);
}
