export type TtsProviderKey =
  | "edge"
  | "webspeech"
  | "indextts2"
  | "piper"
  | "minimax"
  | "fish";

export type MusicSource = "netease" | "qq";

export type Track = {
  id: string;
  title: string;
  artist: string;
  mood: string;
  duration: string;
};

export type NarrationBlock = {
  title: string;
  text: string;
};

export type RadioShow = {
  id: string;
  stationName: string;
  segment: string;
  vibe: string;
  hostLine: string;
  narration: NarrationBlock;
  queue: Track[];
  ttsProvider: TtsProviderKey;
};

export type TrackPlaybackStatus =
  | "idle"
  | "resolving"
  | "ready"
  | "playing"
  | "failed";

export type RadioSessionTrack = Track & {
  coverUrl?: string;
  playable: boolean;
  playbackStatus: TrackPlaybackStatus;
  streamUrl?: string;
  resolvedSource?: MusicSource;
  failureReason?: string;
};

export type RadioSessionState = {
  show: RadioShow;
  currentTrackIndex: number;
  currentTrack: RadioSessionTrack | null;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  progressPercent: number;
  activePlaylistKey?: string;
  activePlaylistTitle?: string;
  updatedAt: string;
};

export type RadioControlAction = "play" | "pause" | "next" | "previous" | "seek";

export type RadioControlRequest = {
  action: RadioControlAction;
  positionMs?: number;
};

export type RadioPlaylistSelectionRequest = {
  key: string;
};

export type RadioTrackSelectionRequest = {
  trackId: string;
  autoplay?: boolean;
};

export type RadioSyncEvent = "play" | "pause" | "timeupdate" | "ended" | "error";

export type RadioSyncRequest = {
  event: RadioSyncEvent;
  trackId?: string;
  positionMs?: number;
  errorMessage?: string;
};

export type PlatformCredentialsRequest = {
  neteaseCookie?: string;
  qqCookie?: string;
};

export type PlatformCredentialsStatus = {
  neteaseConfigured: boolean;
  qqConfigured: boolean;
  updatedAt?: string;
};

export type LlmMode = "rule" | "ollama" | "openai_compatible";

export type AppShellMode = "browser" | "desktop";

export type AppSettingsRequest = {
  llmMode?: LlmMode;
  llmFallbackToRule?: boolean;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiApiKey?: string;
  clearOpenaiApiKey?: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ttsProvider?: "edge" | "webspeech";
  ttsFallbackToWebSpeech?: boolean;
  ttsIndexTts2Url?: string;
  defaultWeatherCity?: string;
  autoplayNarrationOnShowUpdate?: boolean;
};

export type AppSettingsResponse = {
  llmMode: LlmMode;
  llmFallbackToRule: boolean;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKeyConfigured: boolean;
  openaiApiKeyPreview?: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ttsProvider: "edge" | "webspeech";
  ttsFallbackToWebSpeech: boolean;
  ttsIndexTts2Url: string;
  defaultWeatherCity: string;
  autoplayNarrationOnShowUpdate: boolean;
  dataRoot: string;
  appShell: AppShellMode;
  updatedAt?: string;
};

export type TtsVoiceProfile = {
  id: string;
  label: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type TtsVoiceLibraryResponse = {
  selectedVoiceId: string;
  updatedAt?: string;
  voices: TtsVoiceProfile[];
};

export type TtsVoiceUploadRequest = {
  name?: string;
  fileName: string;
  audioBase64: string;
};

export type TtsVoiceSelectRequest = {
  voiceId: string;
};

export type ChatControlRequest = {
  message: string;
};

export type ChatConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatConversationRequest = {
  message: string;
  history?: ChatConversationMessage[];
};

export type ChatConversationIntent =
  | "chat"
  | "tune_station"
  | "explain_mix"
  | "pick_music"
  | "context_update";

export type ChatSuggestion = {
  id: string;
  label: string;
  prompt: string;
  kind: "weather" | "mood" | "scene" | "artist" | "queue" | "chat";
};

export type ChatStationContext = {
  energy?: "calm" | "balanced" | "intense";
  scene?: string;
  weather?: string;
  mood?: string;
  artistFocus?: string[];
};

export type ChatStationSnapshot = {
  playlistTitle?: string;
  segment: string;
  vibe: string;
  hostLine: string;
  queuePreview: Array<{
    id: string;
    title: string;
    artist: string;
  }>;
  weatherSummary?: string;
  context?: ChatStationContext;
};

export type ChatConversationResponse = {
  reply: string;
  replyTitle?: string;
  intent: ChatConversationIntent;
  mode: "rule" | "llm";
  provider: string;
  warning?: string;
  showUpdated: boolean;
  contextSummary?: string;
  stationSnapshot?: ChatStationSnapshot;
  suggestions: ChatSuggestion[];
};

export type ChatControlResponse = {
  show: RadioShow;
  tts: TtsResult;
  mode: "rule" | "llm";
  provider: string;
  warning?: string;
};

export type LlmStatusResponse = {
  configuredMode: LlmMode;
  activeMode: LlmMode;
  providerLabel: string;
  ready: boolean;
  fallbackToRule: boolean;
  issues: string[];
};

export type TtsRequest = {
  text: string;
  voice?: string;
  emotion?: string;
  speed?: number;
};

export type TtsResult = {
  provider: TtsProviderKey;
  mode: "client" | "server";
  audioUrl?: string;
  previewText: string;
};

export type PlaylistImportInput = {
  source: MusicSource;
  rawUrl: string;
  id: string;
  canonicalUrl: string;
};

export type PlaylistImportSeed = {
  inputs: PlaylistImportInput[];
};

export type ImportedTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl?: string;
  trackId?: string;
  songId?: string;
  songMid?: string;
  albumMid?: string;
};

export type ImportedPlaylist = {
  source: MusicSource;
  id: string;
  title: string;
  creator: string;
  trackCount: number;
  playCount?: number;
  coverUrl?: string;
  canonicalUrl: string;
  tracks: ImportedTrack[];
};
