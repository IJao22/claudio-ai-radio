import enhancedApi from "@neteasecloudmusicapienhanced/api";
import type { RequestBaseConfig } from "@neteasecloudmusicapienhanced/api";
import generateEnhancedConfig from "@neteasecloudmusicapienhanced/api/generateConfig.js";
import type {
  ImportedPlaylist,
  ImportedTrack,
  MusicSource,
  TrackPlaybackStatus
} from "@claudio/core";
import { getAllImportedPlaylists } from "./music/library-store.ts";
import { getPlatformCredentials } from "./platform-credentials.ts";

const READY_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const NETEASE_LEVEL = "standard";

const {
  register_anonimous,
  song_url_match,
  song_url_v1
} = enhancedApi as typeof import("@neteasecloudmusicapienhanced/api");

type CachedResolution = {
  playable: boolean;
  status: Exclude<TrackPlaybackStatus, "playing" | "idle" | "resolving">;
  resolvedSource?: MusicSource;
  remoteUrl?: string;
  failureReason?: string;
  expiresAt: number;
};

type PlaybackView = {
  playable: boolean;
  playbackStatus: TrackPlaybackStatus;
  streamUrl?: string;
  resolvedSource?: MusicSource;
  failureReason?: string;
};

type ProxyStreamResult =
  | {
      ok: true;
      response: Response;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
    };

type TrackCandidate = {
  playlist: ImportedPlaylist;
  track: ImportedTrack;
};

type SourceResolution = {
  playable: boolean;
  resolvedSource?: MusicSource;
  remoteUrl?: string;
  failureReason?: string;
  expiresAt: number;
};

type NeteaseSongUrlRow = {
  url?: string;
  proxyUrl?: string;
  expi?: number;
  freeTrialInfo?: unknown;
};

function createFailure(failureReason: string, status: CachedResolution["status"] = "failed"): CachedResolution {
  return {
    playable: false,
    status,
    failureReason,
    expiresAt: Date.now() + FAILURE_TTL_MS
  };
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(.*?\)|（.*?）|\[.*?]|\{.*?}/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function getPrimaryArtist(value: string): string {
  return value
    .split(/,|，|\/|&| feat\. | feat | ft\. | ft /i)[0]
    ?.trim() ?? value.trim();
}

function getTrackKey(source: MusicSource, trackId: string): string {
  return `${source}:${trackId}`;
}

function buildLocalStreamUrl(playlistKey: string, trackId: string): string {
  return `http://localhost:8787/api/audio/stream/${encodeURIComponent(playlistKey)}/${encodeURIComponent(trackId)}`;
}

function pickRemoteUrl(row?: NeteaseSongUrlRow) {
  if (!row) {
    return undefined;
  }

  return row.proxyUrl || row.url;
}

function hasOnlyFreeTrial(row?: NeteaseSongUrlRow) {
  if (!row) {
    return false;
  }

  return !(
    row.freeTrialInfo === undefined ||
    row.freeTrialInfo === null ||
    row.freeTrialInfo === "null"
  );
}

function buildExpiresAt(expi?: number) {
  return Date.now() + ((Number(expi) || READY_TTL_MS / 1000) * 1000);
}

function uniqueDefined<T>(values: Array<T | undefined>) {
  return [...new Set(values.filter((value): value is T => Boolean(value)))];
}

function normalizeCookieHeader(rawCookie: string) {
  const trimmed = rawCookie.trim();
  if (!trimmed) {
    return "";
  }

  if (!/[\r\n]/.test(trimmed) && trimmed.includes("=")) {
    return trimmed;
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tabParts = line.split("\t");
      if (tabParts.length >= 2 && tabParts[0] && !tabParts[0].includes("=")) {
        return `${tabParts[0]}=${tabParts[1]}`;
      }

      const equalsIndex = line.indexOf("=");
      if (equalsIndex > 0) {
        return line.slice(0, line.indexOf("\t") > 0 ? line.indexOf("\t") : undefined);
      }

      return "";
    })
    .filter(Boolean)
    .join("; ");
}

function getCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(/;\s*/)
    .map((item) => item.split("="))
    .find(([name]) => name === key)?.[1];
}

export class PlaybackResolverService {
  private readonly cache = new Map<string, CachedResolution>();
  private readonly inflight = new Map<string, Promise<CachedResolution>>();
  private librarySnapshot: ImportedPlaylist[] | null = null;
  private enhancedReadyPromise: Promise<void> | null = null;
  private anonymousCookiePromise: Promise<string | undefined> | null = null;

  invalidateAllCaches() {
    this.cache.clear();
    this.inflight.clear();
    this.librarySnapshot = null;
  }

  markTrackFailed(source: MusicSource, trackId: string, failureReason: string) {
    this.cache.set(getTrackKey(source, trackId), createFailure(failureReason));
  }

  getTrackPlaybackView(
    playlist: ImportedPlaylist,
    track: ImportedTrack,
    playlistKey: string,
    isPlaying: boolean
  ): PlaybackView {
    const cacheKey = getTrackKey(playlist.source, track.id);
    const cached = this.cache.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      if (cached) {
        this.cache.delete(cacheKey);
      }

      return {
        playable: false,
        playbackStatus: "idle"
      };
    }

    if (!cached.playable || !cached.remoteUrl) {
      return {
        playable: false,
        playbackStatus: cached.status,
        resolvedSource: cached.resolvedSource,
        failureReason: cached.failureReason
      };
    }

    return {
      playable: true,
      playbackStatus: isPlaying ? "playing" : "ready",
      streamUrl: buildLocalStreamUrl(playlistKey, track.id),
      resolvedSource: cached.resolvedSource
    };
  }

  async prefetchTracks(playlist: ImportedPlaylist, tracks: ImportedTrack[]) {
    await Promise.allSettled(tracks.map((track) => this.resolveTrack(playlist, track)));
  }

  async resolveTrack(
    playlist: ImportedPlaylist,
    track: ImportedTrack,
    force = false
  ): Promise<CachedResolution> {
    const cacheKey = getTrackKey(playlist.source, track.id);
    if (!force) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached;
      }

      const pending = this.inflight.get(cacheKey);
      if (pending) {
        return pending;
      }
    }

    const task = this.resolveTrackInternal(playlist, track)
      .then((resolved) => {
        this.cache.set(cacheKey, resolved);
        return resolved;
      })
      .finally(() => {
        this.inflight.delete(cacheKey);
      });

    this.inflight.set(cacheKey, task);
    return task;
  }

  async createAudioProxyStream(
    playlist: ImportedPlaylist,
    track: ImportedTrack,
    rangeHeader?: string
  ): Promise<ProxyStreamResult> {
    const resolved = await this.resolveTrack(playlist, track);
    if (!resolved.playable || !resolved.remoteUrl) {
      return {
        ok: false,
        statusCode: 409,
        error: resolved.failureReason ?? "当前歌曲不可播放。"
      };
    }

    const response = await this.fetchRemoteAudio(resolved.remoteUrl, rangeHeader);
    if (response.ok || response.status === 206) {
      return {
        ok: true,
        response
      };
    }

    const retried = await this.resolveTrack(playlist, track, true);
    if (!retried.playable || !retried.remoteUrl) {
      return {
        ok: false,
        statusCode: 409,
        error: retried.failureReason ?? "重新解析播放地址失败。"
      };
    }

    const retryResponse = await this.fetchRemoteAudio(retried.remoteUrl, rangeHeader);
    if (!retryResponse.ok && retryResponse.status !== 206) {
      return {
        ok: false,
        statusCode: retryResponse.status || 502,
        error: "远端音频流获取失败。"
      };
    }

    return {
      ok: true,
      response: retryResponse
    };
  }

  private async ensureEnhancedReady() {
    if (!this.enhancedReadyPromise) {
      this.enhancedReadyPromise = generateEnhancedConfig().catch((error) => {
        this.enhancedReadyPromise = null;
        throw error;
      });
    }

    await this.enhancedReadyPromise;
  }

  private async getAnonymousNeteaseCookie() {
    if (!this.anonymousCookiePromise) {
      this.anonymousCookiePromise = this.fetchAnonymousNeteaseCookie().catch((error) => {
        this.anonymousCookiePromise = null;
        throw error;
      });
    }

    return this.anonymousCookiePromise;
  }

  private async fetchAnonymousNeteaseCookie() {
    await this.ensureEnhancedReady();
    const response = await register_anonimous({});
    const cookie = typeof response.body?.cookie === "string" ? response.body.cookie.trim() : "";
    return cookie || undefined;
  }

  private async resolveTrackInternal(
    playlist: ImportedPlaylist,
    track: ImportedTrack
  ): Promise<CachedResolution> {
    const native = await this.resolveBySource(playlist.source, track);
    if (native.playable && native.remoteUrl) {
      return {
        playable: true,
        status: "ready",
        resolvedSource: native.resolvedSource,
        remoteUrl: native.remoteUrl,
        expiresAt: native.expiresAt
      };
    }

    const fallback = await this.resolveCrossPlatform(playlist, track);
    if (fallback.playable && fallback.remoteUrl) {
      return {
        playable: true,
        status: "ready",
        resolvedSource: fallback.resolvedSource,
        remoteUrl: fallback.remoteUrl,
        expiresAt: fallback.expiresAt
      };
    }

    const reasons = [native.failureReason, fallback.failureReason].filter(Boolean);
    return createFailure(reasons.join("；") || "当前歌曲没有可用的播放地址。");
  }

  private async resolveCrossPlatform(
    playlist: ImportedPlaylist,
    track: ImportedTrack
  ): Promise<SourceResolution> {
    const candidates = await this.findCrossPlatformCandidates(playlist, track);
    if (candidates.length === 0) {
      return {
        playable: false,
        failureReason: "没有找到符合规则的跨平台补链候选曲目。",
        expiresAt: Date.now() + FAILURE_TTL_MS
      };
    }

    let lastFailure = "跨平台补链失败。";
    for (const candidate of candidates) {
      const resolved = await this.resolveBySource(candidate.playlist.source, candidate.track);
      if (resolved.playable && resolved.remoteUrl) {
        return resolved;
      }

      if (resolved.failureReason) {
        lastFailure = `${
          candidate.playlist.source === "netease" ? "网易云" : "QQ 音乐"
        }补链失败：${resolved.failureReason}`;
      }
    }

    return {
      playable: false,
      failureReason: lastFailure,
      expiresAt: Date.now() + FAILURE_TTL_MS
    };
  }

  private async findCrossPlatformCandidates(
    playlist: ImportedPlaylist,
    track: ImportedTrack
  ): Promise<TrackCandidate[]> {
    if (!this.librarySnapshot) {
      this.librarySnapshot = await getAllImportedPlaylists();
    }

    const normalizedTitle = normalizeToken(track.title);
    const normalizedArtist = normalizeToken(getPrimaryArtist(track.artist));

    return this.librarySnapshot
      .filter((candidatePlaylist) => candidatePlaylist.source !== playlist.source)
      .flatMap((candidatePlaylist) =>
        candidatePlaylist.tracks
          .filter((candidateTrack) => {
            const sameTitle = normalizeToken(candidateTrack.title) === normalizedTitle;
            const sameArtist = normalizeToken(getPrimaryArtist(candidateTrack.artist)) === normalizedArtist;
            const durationClose = Math.abs(candidateTrack.durationMs - track.durationMs) <= 5000;
            return sameTitle && sameArtist && durationClose;
          })
          .map((candidateTrack) => ({
            playlist: candidatePlaylist,
            track: candidateTrack
          }))
      )
      .sort(
        (left, right) =>
          Math.abs(left.track.durationMs - track.durationMs) -
          Math.abs(right.track.durationMs - track.durationMs)
      );
  }

  private async resolveBySource(source: MusicSource, track: ImportedTrack): Promise<SourceResolution> {
    if (source === "netease") {
      return this.resolveNeteaseTrack(track);
    }

    return this.resolveQqTrack(track);
  }

  private async callNeteaseSongUrl(
    trackId: string,
    cookie?: string,
    options?: {
      unblock?: boolean;
    }
  ) {
    await this.ensureEnhancedReady();

    const request: RequestBaseConfig & {
      id: string;
      level: typeof NETEASE_LEVEL;
      unblock?: "true";
    } = {
      id: trackId,
      level: NETEASE_LEVEL,
      randomCNIP: true
    };

    if (cookie) {
      request.cookie = cookie;
    }

    if (options?.unblock) {
      request.unblock = "true";
    }

    const response = await song_url_v1(request as never) as {
      body?: {
        data?: NeteaseSongUrlRow[];
      };
    };

    return response.body?.data?.[0];
  }

  private async resolveNeteaseTrack(track: ImportedTrack): Promise<SourceResolution> {
    const credentials = await getPlatformCredentials();
    const configuredCookie = credentials.neteaseCookie?.trim() || undefined;

    let anonymousCookie: string | undefined;
    try {
      anonymousCookie = await this.getAnonymousNeteaseCookie();
    } catch {
      anonymousCookie = undefined;
    }

    const cookieCandidates = uniqueDefined([configuredCookie, anonymousCookie]);
    const trackId = track.trackId ?? track.id;
    const failures: string[] = [];

    for (const cookie of cookieCandidates) {
      const label = cookie === configuredCookie ? "网易云账号态" : "网易云游客态";

      try {
        const row = await this.callNeteaseSongUrl(trackId, cookie);
        const remoteUrl = pickRemoteUrl(row);
        if (remoteUrl && !hasOnlyFreeTrial(row)) {
          return {
            playable: true,
            resolvedSource: "netease",
            remoteUrl,
            expiresAt: buildExpiresAt(row?.expi)
          };
        }

        if (remoteUrl && hasOnlyFreeTrial(row)) {
          failures.push(`${label}只返回试听片段。`);
        } else {
          failures.push(`${label}没有返回可播放地址。`);
        }
      } catch (error) {
        failures.push(`${label}解析失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    }

    try {
      const unblockRow = await this.callNeteaseSongUrl(trackId, configuredCookie ?? anonymousCookie, {
        unblock: true
      });
      const remoteUrl = pickRemoteUrl(unblockRow);
      if (remoteUrl) {
        return {
          playable: true,
          resolvedSource: "netease",
          remoteUrl,
          expiresAt: buildExpiresAt(unblockRow?.expi)
        };
      }

      failures.push("网易云 Enhanced 解灰没有返回可播放地址。");
    } catch (error) {
      failures.push(`网易云 Enhanced 解灰失败：${error instanceof Error ? error.message : "未知错误"}`);
    }

    try {
      await this.ensureEnhancedReady();
      const matchResponse = await song_url_match({
        id: trackId,
        randomCNIP: true
      } as never) as {
        body?: {
          data?: string;
          proxyUrl?: string;
        };
      };
      const remoteUrl =
        typeof matchResponse.body?.proxyUrl === "string" && matchResponse.body.proxyUrl
          ? matchResponse.body.proxyUrl
          : typeof matchResponse.body?.data === "string"
            ? matchResponse.body.data
            : undefined;

      if (remoteUrl) {
        return {
          playable: true,
          resolvedSource: "netease",
          remoteUrl,
          expiresAt: Date.now() + READY_TTL_MS
        };
      }

      failures.push("网易云匹配补链没有返回可播放地址。");
    } catch (error) {
      failures.push(`网易云匹配补链失败：${error instanceof Error ? error.message : "未知错误"}`);
    }

    return {
      playable: false,
      failureReason: failures.join("；") || "网易云当前没有可播放链接。",
      expiresAt: Date.now() + FAILURE_TTL_MS
    };
  }

  private async resolveQqTrack(track: ImportedTrack): Promise<SourceResolution> {
    const credentials = await getPlatformCredentials();
    const cookieHeader = normalizeCookieHeader(credentials.qqCookie ?? "");
    if (!cookieHeader) {
      return {
        playable: false,
        failureReason: "未配置 QQ 音乐本地 Cookie。",
        expiresAt: Date.now() + FAILURE_TTL_MS
      };
    }

    if (!track.songMid) {
      return {
        playable: false,
        failureReason: "QQ 歌曲缺少 songMid，请重新同步歌单。",
        expiresAt: Date.now() + FAILURE_TTL_MS
      };
    }

    try {
      const uin = (getCookieValue(cookieHeader, "uin") || getCookieValue(cookieHeader, "wxuin") || "").replace(/\D/g, "");
      const guid = Math.floor(Math.random() * 10000000).toString();
      const response = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader,
          referer: "https://y.qq.com",
          "user-agent": "Mozilla/5.0 Claudio/0.1"
        },
        body: JSON.stringify({
          comm: {
            cv: 4747474,
            ct: 24,
            format: "json",
            inCharset: "utf-8",
            outCharset: "utf-8",
            notice: 0,
            platform: "yqq.json",
            needNewCode: 1,
            uin
          },
          req_0: {
            module: "vkey.GetVkeyServer",
            method: "CgiGetVkey",
            param: {
              guid,
              songmid: [track.songMid],
              songtype: [0],
              uin,
              loginflag: 1,
              platform: "20"
            }
          }
        })
      });

      if (!response.ok) {
        return {
          playable: false,
          failureReason: `QQ 音乐请求失败：${response.status} ${response.statusText}`,
          expiresAt: Date.now() + FAILURE_TTL_MS
        };
      }

      const payload = await response.json() as {
        req_0?: {
          data?: {
            sip?: string[];
            midurlinfo?: Array<{
              purl?: string;
            }>;
          };
        };
      };

      const requestData = payload.req_0?.data;
      if (!requestData) {
        return {
          playable: false,
          failureReason: "QQ 音乐返回结果缺少 req_0.data，通常表示 Cookie 已失效或权限不足。",
          expiresAt: Date.now() + FAILURE_TTL_MS
        };
      }

      const purl = requestData.midurlinfo?.[0]?.purl;
      const domain = requestData.sip?.find((item) => typeof item === "string" && !item.startsWith("http://ws"))
        ?? requestData.sip?.[0];

      if (!purl || !domain) {
        return {
          playable: false,
          failureReason: "QQ 音乐没有返回可播放地址。",
          expiresAt: Date.now() + FAILURE_TTL_MS
        };
      }

      return {
        playable: true,
        resolvedSource: "qq",
        remoteUrl: new URL(purl, domain).toString(),
        expiresAt: Date.now() + READY_TTL_MS
      };
    } catch (error) {
      return {
        playable: false,
        failureReason: error instanceof Error ? error.message : "QQ 音乐解析失败。",
        expiresAt: Date.now() + FAILURE_TTL_MS
      };
    }
  }

  private fetchRemoteAudio(url: string, rangeHeader?: string) {
    const headers: Record<string, string> = {
      "user-agent": "Mozilla/5.0 Claudio/0.1"
    };

    if (rangeHeader) {
      headers.range = rangeHeader;
    }

    return fetch(url, {
      headers,
      redirect: "follow"
    });
  }
}

export const playbackResolver = new PlaybackResolverService();
