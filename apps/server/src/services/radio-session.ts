import type {
  ImportedPlaylist,
  ImportedTrack,
  RadioSessionState,
  RadioShow,
  RadioSyncRequest,
  TrackPlaybackStatus
} from "@claudio/core";
import { getAllImportedPlaylists, getImportedPlaylistByKey, getLatestImportedPlaylist } from "./music/library-store.ts";
import { playbackResolver } from "./playback-resolver.ts";
import { buildFallbackShow, buildShowFromPlaylist } from "./radio-director.ts";
import { getConfiguredTtsProvider } from "./tts/config.ts";

type PlaybackSnapshot = {
  currentTrackIndex: number;
  progressMs: number;
  isPlaying: boolean;
  updatedAt: string;
};

function formatDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDurationLabel(duration: string): number {
  const [minutes, seconds] = duration.split(":").map((part) => Number(part));
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return 0;
  }
  return ((minutes * 60) + seconds) * 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stepIndex(current: number, total: number, direction: 1 | -1) {
  return (current + direction + total) % total;
}

export class RadioSessionService {
  private playlist: ImportedPlaylist | null = null;
  private playlistKey?: string;
  private show: RadioShow = buildFallbackShow();
  private playback: PlaybackSnapshot = {
    currentTrackIndex: 0,
    progressMs: 0,
    isPlaying: false,
    updatedAt: new Date().toISOString()
  };
  private manualSelectionTrackId: string | null = null;
  private initialized = false;

  private touch() {
    this.playback.updatedAt = new Date().toISOString();
  }

  private resetPlayback(isPlaying = false) {
    this.playback = {
      currentTrackIndex: 0,
      progressMs: 0,
      isPlaying,
      updatedAt: new Date().toISOString()
    };
    this.manualSelectionTrackId = null;
  }

  private async ensureInitialized() {
    if (this.initialized) {
      return;
    }

    await this.initializePlayablePlaylist();

    this.initialized = true;
  }

  private async initializePlayablePlaylist() {
    const latest = await getLatestImportedPlaylist();
    const all = await getAllImportedPlaylists();
    const orderedCandidates = latest
      ? [latest, ...all.filter((playlist) => `${playlist.source}-${playlist.id}` !== `${latest.source}-${latest.id}`)]
      : all;

    for (const playlist of orderedCandidates) {
      this.applyPlaylist(playlist);
      const foundPlayable = await this.ensurePlayableTrack(1);
      if (foundPlayable) {
        return;
      }
    }

    if (latest) {
      this.applyPlaylist(latest);
      await this.preparePlaybackWindow(true);
    }
  }

  private applyPlaylist(playlist: ImportedPlaylist) {
    this.playlist = playlist;
    this.playlistKey = `${playlist.source}-${playlist.id}`;
    this.show = buildShowFromPlaylist(playlist);
    this.ensureShowTtsProvider();
    this.resetPlayback(false);
  }

  private getQueueLength() {
    return this.show.queue.length;
  }

  private ensureShowTtsProvider() {
    const provider = getConfiguredTtsProvider();
    if (this.show.ttsProvider !== provider) {
      this.show = {
        ...this.show,
        ttsProvider: provider
      };
    }
  }

  private isHeldManualSelection(trackId?: string | null) {
    return Boolean(trackId && this.manualSelectionTrackId === trackId);
  }

  private buildQueueTrackFromImported(track: ImportedTrack): RadioShow["queue"][number] {
    return {
      id: track.id,
      title: track.title,
      artist: track.artist || this.playlist?.creator || "未知歌手",
      mood: track.album || this.playlist?.title || "手动点播",
      duration: formatDurationLabel(track.durationMs)
    };
  }

  private ensureTrackInQueue(trackId: string) {
    const queueIndex = this.show.queue.findIndex((track) => track.id === trackId);
    if (queueIndex >= 0) {
      return queueIndex;
    }

    if (!this.playlist) {
      return -1;
    }

    const imported = this.playlist.tracks.find((track) => track.id === trackId);
    if (!imported) {
      return -1;
    }

    this.show = {
      ...this.show,
      queue: [
        this.buildQueueTrackFromImported(imported),
        ...this.show.queue.filter((track) => track.id !== trackId)
      ]
    };

    return 0;
  }

  private getImportedTrackByIndex(index: number): ImportedTrack | null {
    if (!this.playlist) {
      return null;
    }

    const track = this.show.queue[index];
    if (!track) {
      return null;
    }

    return this.playlist.tracks.find((item) => item.id === track.id) ?? null;
  }

  private getTrackDurationMs(index: number): number {
    const track = this.show.queue[index];
    if (!track) {
      return 0;
    }

    const imported = this.getImportedTrackByIndex(index);
    return imported?.durationMs ?? parseDurationLabel(track.duration);
  }

  private getPrefetchTracks(): ImportedTrack[] {
    const tracks: ImportedTrack[] = [];
    for (let offset = 0; offset < Math.min(3, this.getQueueLength()); offset += 1) {
      const index = (this.playback.currentTrackIndex + offset) % this.getQueueLength();
      const imported = this.getImportedTrackByIndex(index);
      if (imported) {
        tracks.push(imported);
      }
    }
    return tracks;
  }

  private async preparePlaybackWindow(awaitCurrent = false) {
    if (!this.playlist) {
      return;
    }

    const current = this.getImportedTrackByIndex(this.playback.currentTrackIndex);
    if (awaitCurrent && current) {
      await playbackResolver.resolveTrack(this.playlist, current);
    }

    const tracks = this.getPrefetchTracks();
    if (tracks.length > 0) {
      await playbackResolver.prefetchTracks(this.playlist, tracks);
    }
  }

  private async ensurePlayableTrack(direction: 1 | -1 = 1): Promise<boolean> {
    if (!this.playlist || this.getQueueLength() === 0) {
      return false;
    }

    const startIndex = this.playback.currentTrackIndex;
    for (let attempt = 0; attempt < this.getQueueLength(); attempt += 1) {
      const imported = this.getImportedTrackByIndex(this.playback.currentTrackIndex);
      if (imported) {
        const resolved = await playbackResolver.resolveTrack(this.playlist, imported);
        if (resolved.playable) {
          await this.preparePlaybackWindow(false);
          return true;
        }
      }

      if (attempt < this.getQueueLength() - 1) {
        this.playback.currentTrackIndex = stepIndex(
          this.playback.currentTrackIndex,
          this.getQueueLength(),
          direction
        );
        this.playback.progressMs = 0;
      }
    }

    this.playback.currentTrackIndex = startIndex;
    this.playback.progressMs = 0;
    return false;
  }

  private buildCurrentTrack(playbackStatusOverride?: TrackPlaybackStatus): RadioSessionState["currentTrack"] {
    const track = this.show.queue[this.playback.currentTrackIndex] ?? null;
    if (!track) {
      return null;
    }

    const imported = this.getImportedTrackByIndex(this.playback.currentTrackIndex);
    if (!this.playlist || !this.playlistKey || !imported) {
      return {
        ...track,
        playable: false,
        playbackStatus: playbackStatusOverride ?? "failed",
        failureReason: "当前队列曲目没有可用的导入元数据。"
      };
    }

    const playbackView = playbackResolver.getTrackPlaybackView(
      this.playlist,
      imported,
      this.playlistKey,
      this.playback.isPlaying
    );

    return {
      ...track,
      coverUrl: imported.coverUrl,
      ...playbackView,
      playbackStatus: playbackStatusOverride ?? playbackView.playbackStatus
    };
  }

  async setPlaylistByKey(key: string): Promise<RadioSessionState | null> {
    await this.ensureInitialized();
    const playlist = await getImportedPlaylistByKey(key);
    if (!playlist) {
      return null;
    }

    this.applyPlaylist(playlist);
    const foundPlayable = await this.ensurePlayableTrack(1);
    if (!foundPlayable) {
      await this.preparePlaybackWindow(true);
    }
    return this.getState();
  }

  async selectTrack(trackId: string, autoplay = true): Promise<RadioSessionState | null> {
    await this.ensureInitialized();

    if (!this.playlist) {
      return null;
    }

    const nextIndex = this.ensureTrackInQueue(trackId);
    if (nextIndex < 0) {
      return null;
    }

    this.playback.currentTrackIndex = nextIndex;
    this.playback.progressMs = 0;
    this.manualSelectionTrackId = trackId;

    const imported = this.getImportedTrackByIndex(nextIndex);
    if (!imported) {
      this.playback.isPlaying = false;
      this.touch();
      return this.getState();
    }

    const resolved = await playbackResolver.resolveTrack(this.playlist, imported, true);
    this.playback.isPlaying = autoplay && resolved.playable;

    if (resolved.playable) {
      await this.preparePlaybackWindow(false);
    }

    this.touch();
    return this.getState();
  }

  async replaceShow(show: RadioShow): Promise<RadioSessionState> {
    await this.ensureInitialized();
    this.show = show;
    this.ensureShowTtsProvider();
    this.resetPlayback(false);
    const foundPlayable = await this.ensurePlayableTrack(1);
    if (!foundPlayable) {
      await this.preparePlaybackWindow(true);
    }
    return this.getState();
  }

  async getActivePlaylist(): Promise<ImportedPlaylist | null> {
    await this.ensureInitialized();
    return this.playlist;
  }

  async getState(): Promise<RadioSessionState> {
    await this.ensureInitialized();
    this.ensureShowTtsProvider();

    let durationMs = this.getTrackDurationMs(this.playback.currentTrackIndex);
    let progressMs = clamp(this.playback.progressMs, 0, durationMs || 0);
    this.playback.progressMs = progressMs;
    let progressPercent = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;
    let currentTrack = this.buildCurrentTrack();
    const isHeldManualSelection = this.isHeldManualSelection(currentTrack?.id);

    if (currentTrack?.playbackStatus === "idle") {
      await this.preparePlaybackWindow(true);
      currentTrack = this.buildCurrentTrack();
      durationMs = this.getTrackDurationMs(this.playback.currentTrackIndex);
      progressMs = clamp(this.playback.progressMs, 0, durationMs || 0);
      this.playback.progressMs = progressMs;
      progressPercent = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;
    } else if (currentTrack?.playbackStatus === "failed" && !isHeldManualSelection) {
      const foundPlayable = await this.ensurePlayableTrack(1);
      if (foundPlayable) {
        currentTrack = this.buildCurrentTrack();
        durationMs = this.getTrackDurationMs(this.playback.currentTrackIndex);
        progressMs = clamp(this.playback.progressMs, 0, durationMs || 0);
        this.playback.progressMs = progressMs;
        progressPercent = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;
      }
    }

    return {
      show: this.show,
      currentTrackIndex: this.playback.currentTrackIndex,
      currentTrack,
      isPlaying: this.playback.isPlaying,
      progressMs,
      durationMs,
      progressPercent,
      activePlaylistKey: this.playlistKey,
      activePlaylistTitle: this.playlist?.title,
      updatedAt: this.playback.updatedAt
    };
  }

  async control(action: "play" | "pause" | "next" | "previous" | "seek", positionMs?: number): Promise<RadioSessionState> {
    await this.ensureInitialized();
    const currentTrackId = this.show.queue[this.playback.currentTrackIndex]?.id ?? null;

    if (action === "play") {
      if (this.isHeldManualSelection(currentTrackId)) {
        const imported = this.getImportedTrackByIndex(this.playback.currentTrackIndex);
        if (this.playlist && imported) {
          const resolved = await playbackResolver.resolveTrack(this.playlist, imported, true);
          this.playback.isPlaying = resolved.playable;
          if (resolved.playable) {
            await this.preparePlaybackWindow(false);
          }
        } else {
          this.playback.isPlaying = false;
        }
      } else {
        const playable = await this.ensurePlayableTrack(1);
        this.playback.isPlaying = playable;
      }
    } else if (action === "pause") {
      this.playback.isPlaying = false;
    } else if (action === "next" && this.getQueueLength() > 0) {
      this.manualSelectionTrackId = null;
      this.playback.currentTrackIndex = stepIndex(this.playback.currentTrackIndex, this.getQueueLength(), 1);
      this.playback.progressMs = 0;
      const playable = await this.ensurePlayableTrack(1);
      this.playback.isPlaying = this.playback.isPlaying ? playable : false;
    } else if (action === "previous" && this.getQueueLength() > 0) {
      this.manualSelectionTrackId = null;
      this.playback.currentTrackIndex = stepIndex(this.playback.currentTrackIndex, this.getQueueLength(), -1);
      this.playback.progressMs = 0;
      const playable = await this.ensurePlayableTrack(-1);
      this.playback.isPlaying = this.playback.isPlaying ? playable : false;
    } else if (action === "seek") {
      const duration = this.getTrackDurationMs(this.playback.currentTrackIndex);
      this.playback.progressMs = clamp(positionMs ?? 0, 0, duration || 0);
    }

    this.touch();
    return this.getState();
  }

  async sync(payload: RadioSyncRequest): Promise<RadioSessionState> {
    await this.ensureInitialized();

    const current = this.show.queue[this.playback.currentTrackIndex] ?? null;
    if (payload.trackId && current && payload.trackId !== current.id) {
      return this.getState();
    }

    if (payload.positionMs !== undefined) {
      const duration = this.getTrackDurationMs(this.playback.currentTrackIndex);
      this.playback.progressMs = clamp(payload.positionMs, 0, duration || 0);
    }

    if (payload.event === "play") {
      this.playback.isPlaying = true;
    } else if (payload.event === "pause") {
      this.playback.isPlaying = false;
    } else if (payload.event === "ended") {
      this.manualSelectionTrackId = null;
      this.playback.isPlaying = true;
      this.touch();
      return this.control("next");
    } else if (payload.event === "error") {
      const imported = this.getImportedTrackByIndex(this.playback.currentTrackIndex);
      if (this.playlist && imported) {
        playbackResolver.markTrackFailed(
          this.playlist.source,
          imported.id,
          payload.errorMessage ?? "浏览器无法播放这首歌。"
        );
      }

      if (this.isHeldManualSelection(current?.id)) {
        this.playback.isPlaying = false;
      } else if (this.playback.isPlaying) {
        this.touch();
        return this.control("next");
      }
    }

    this.touch();
    return this.getState();
  }

  async openAudioStream(playlistKey: string, trackId: string, rangeHeader?: string) {
    const playlist = await getImportedPlaylistByKey(playlistKey);
    if (!playlist) {
      return {
        ok: false as const,
        statusCode: 404,
        error: "歌单不存在。"
      };
    }

    const track = playlist.tracks.find((item) => item.id === trackId);
    if (!track) {
      return {
        ok: false as const,
        statusCode: 404,
        error: "歌曲不存在。"
      };
    }

    return playbackResolver.createAudioProxyStream(playlist, track, rangeHeader);
  }

  onLibraryChanged() {
    playbackResolver.invalidateAllCaches();
    void this.preparePlaybackWindow();
  }
}

export const radioSessionService = new RadioSessionService();
