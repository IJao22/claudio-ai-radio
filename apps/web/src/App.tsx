import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettingsRequest,
  AppSettingsResponse,
  ChatConversationMessage,
  ChatConversationResponse,
  ChatStationSnapshot,
  ChatSuggestion,
  LlmMode,
  LlmStatusResponse,
  MusicSource,
  PlatformCredentialsStatus,
  RadioControlAction,
  RadioSessionState,
  TrackPlaybackStatus,
  TtsResult
} from "@claudio/core";

type ShowResponse = {
  show: RadioSessionState["show"];
  tts: TtsResult;
};

type StoredPlaylistSummary = {
  key: string;
  source: MusicSource;
  id: string;
  title: string;
  creator: string;
  trackCount: number;
  coverUrl?: string;
  canonicalUrl: string;
  importedAt: string;
};

type LibraryResponse = {
  updatedAt: string;
  latestPlaylistId?: string;
  playlists: StoredPlaylistSummary[];
};

type ActivePlaylistResponse = {
  key: string;
  source: MusicSource;
  id: string;
  title: string;
  creator: string;
  trackCount: number;
  coverUrl?: string;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    coverUrl?: string;
  }>;
};

type DaypartPlan = {
  nowLabel: string;
  recommendation: string;
  schedulerTrace: string;
};

type ContextWindowPreview = {
  systemPrompt: string;
  userCorpus: string;
  environment: string;
  retrievedMemory: string;
  inputAndTools: string;
  executionTrace: string;
};

type StationStateSummary = {
  updatedAt?: string;
  preferences: {
    favoriteArtists: string[];
    preferredScenes: string[];
    preferredMoods: string[];
  };
  recentConversation: Array<{
    at: string;
    role: "user" | "assistant";
    content: string;
    intent?: string;
  }>;
  recentPlays: Array<{
    at: string;
    trackId: string;
    title?: string;
    artist?: string;
    source?: string;
    action: "select" | "play" | "next" | "previous";
  }>;
  memorySummary: string;
};

type ChatUiMessage = ChatConversationMessage & {
  id: string;
  replyTitle?: string;
  mode?: string;
  provider?: string;
  showUpdated?: boolean;
  contextSummary?: string;
  stationSnapshot?: ChatStationSnapshot;
  suggestions?: ChatSuggestion[];
};

type SettingsDraft = {
  llmMode: LlmMode;
  llmFallbackToRule: boolean;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ttsProvider: "edge" | "webspeech";
  ttsFallbackToWebSpeech: boolean;
  ttsIndexTts2Url: string;
  defaultWeatherCity: string;
  autoplayNarrationOnShowUpdate: boolean;
};

type CorpusResponse = {
  tasteMarkdown: string;
  routinesMarkdown: string;
  moodRulesMarkdown: string;
  playlistsDigest: string;
  sourceFiles: Record<"taste" | "routines" | "mood-rules" | "playlists", string>;
};

type WeatherSummaryResponse = {
  city: string;
  locationLabel: string;
  summary: string;
  fetchedAt: string;
  current: {
    temperatureC: number;
    apparentTemperatureC: number;
    windSpeedKmh: number;
    weatherLabel: string;
  };
  today: {
    minC: number | null;
    maxC: number | null;
  };
};

type StationControlDraft = {
  weather: string;
  mood: string;
  scene: string;
  trip: string;
  energy: string;
  artistFocus: string;
};

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.trim() ||
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8787" : "");
const SESSION_POLL_MS = 15000;

const defaultStationControlDraft: StationControlDraft = {
  weather: "",
  mood: "",
  scene: "",
  trip: "",
  energy: "",
  artistFocus: ""
};

const defaultSettingsDraft: SettingsDraft = {
  llmMode: "openai_compatible",
  llmFallbackToRule: true,
  openaiBaseUrl: "https://api.deepseek.com",
  openaiModel: "deepseek-chat",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:7b",
  ttsProvider: "edge",
  ttsFallbackToWebSpeech: true,
  ttsIndexTts2Url: "",
  defaultWeatherCity: "上海",
  autoplayNarrationOnShowUpdate: true
};

const initialChatMessages: ChatUiMessage[] = [
  {
    id: "system-greeting",
    role: "assistant",
    replyTitle: "电台上线",
    content:
      "告诉我今天的天气、心情、行程，或者直接说你想要的听感。我会基于你的歌单重排成一版可播放的 AI 电台。",
    suggestions: [
      {
        id: "weather-remix",
        label: "按今天天气重排",
        prompt: "根据今天的天气，帮我重排一版更贴合现在状态的电台。",
        kind: "weather"
      },
      {
        id: "late-night",
        label: "切到深夜版",
        prompt: "切成更适合深夜独处的版本。",
        kind: "mood"
      },
      {
        id: "focus-mode",
        label: "切到专注版",
        prompt: "帮我做一版适合专注工作和阅读的顺序。",
        kind: "scene"
      }
    ]
  }
];

function makeMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(input?: string) {
  if (!input) {
    return "未记录";
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  return date.toLocaleString();
}

function getPlaybackStatusLabel(status?: TrackPlaybackStatus) {
  switch (status) {
    case "idle":
      return "待解析";
    case "resolving":
      return "解析中";
    case "ready":
      return "可播放";
    case "playing":
      return "播放中";
    case "failed":
      return "不可播放";
    default:
      return "待命";
  }
}

function getSourceLabel(source?: MusicSource) {
  if (source === "netease") {
    return "网易云音乐";
  }
  if (source === "qq") {
    return "QQ 音乐";
  }
  return "未解析";
}

function getSourceBadge(source: MusicSource) {
  return source === "netease" ? "网易云" : "QQ 音乐";
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const rawText = await response.text();

  let payload: unknown;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      if (!response.ok) {
        throw new Error(rawText);
      }
    }
  }

  if (!response.ok) {
    if (payload && typeof payload === "object" && "error" in payload && payload.error) {
      throw new Error(String(payload.error));
    }
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return payload as T;
}

function toSettingsDraft(input: AppSettingsResponse): SettingsDraft {
  return {
    llmMode: input.llmMode,
    llmFallbackToRule: input.llmFallbackToRule,
    openaiBaseUrl: input.openaiBaseUrl,
    openaiModel: input.openaiModel,
    ollamaBaseUrl: input.ollamaBaseUrl,
    ollamaModel: input.ollamaModel,
    ttsProvider: input.ttsProvider,
    ttsFallbackToWebSpeech: input.ttsFallbackToWebSpeech,
    ttsIndexTts2Url: input.ttsIndexTts2Url,
    defaultWeatherCity: input.defaultWeatherCity,
    autoplayNarrationOnShowUpdate: input.autoplayNarrationOnShowUpdate
  };
}

function buildCredentialSavedMessage(status: PlatformCredentialsStatus | null) {
  if (!status || (!status.neteaseConfigured && !status.qqConfigured)) {
    return null;
  }

  return status.updatedAt
    ? `平台 Cookie 已保存到本机，最后更新于 ${formatDateTime(status.updatedAt)}。`
    : "平台 Cookie 已保存到本机。";
}

function buildDefaultContextMessage() {
  return "基于当前时间、已激活歌单、会话记忆和最近对话，预览 Claudio 这轮会注入给模型的上下文。";
}

export default function App() {
  const [session, setSession] = useState<RadioSessionState | null>(null);
  const [showData, setShowData] = useState<ShowResponse | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<ActivePlaylistResponse | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatusResponse | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettingsResponse | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(defaultSettingsDraft);
  const [daypartPlan, setDaypartPlan] = useState<DaypartPlan | null>(null);
  const [contextPreview, setContextPreview] = useState<ContextWindowPreview | null>(null);
  const [stationState, setStationState] = useState<StationStateSummary | null>(null);
  const [corpus, setCorpus] = useState<CorpusResponse | null>(null);
  const [corpusDraft, setCorpusDraft] = useState<CorpusResponse | null>(null);
  const [weatherSummary, setWeatherSummary] = useState<WeatherSummaryResponse | null>(null);
  const [stationControlDraft, setStationControlDraft] = useState<StationControlDraft>(defaultStationControlDraft);
  const [contextPreviewMessage, setContextPreviewMessage] = useState(buildDefaultContextMessage());
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState("");
  const [clearOpenAiApiKey, setClearOpenAiApiKey] = useState(false);
  const [credentialsStatus, setCredentialsStatus] = useState<PlatformCredentialsStatus | null>(null);
  const [neteaseCookieInput, setNeteaseCookieInput] = useState("");
  const [qqCookieInput, setQqCookieInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatUiMessage[]>(initialChatMessages);
  const [chatInput, setChatInput] = useState("");
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [chatWarning, setChatWarning] = useState<string | null>(null);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [isSavingAppSettings, setIsSavingAppSettings] = useState(false);
  const [isSavingCorpus, setIsSavingCorpus] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isApplyingControl, setIsApplyingControl] = useState(false);
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectingTrackId, setSelectingTrackId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingNarrationAutoplayRef = useRef(false);
  const lastSyncedSecondRef = useRef(-1);
  const suppressPauseSyncRef = useRef(false);

  const currentTrack = session?.currentTrack ?? null;
  const deferredPlaylistSearch = useDeferredValue(playlistSearch);

  const filteredTracks = useMemo(() => {
    const keyword = deferredPlaylistSearch.trim().toLowerCase();
    const tracks = activePlaylist?.tracks ?? [];
    if (!keyword) {
      return tracks;
    }

    return tracks.filter((track) =>
      `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(keyword)
    );
  }, [activePlaylist?.tracks, deferredPlaylistSearch]);

  const latestAssistantMessage = useMemo(() => {
    return [...chatMessages].reverse().find((message) => message.role === "assistant") ?? null;
  }, [chatMessages]);

  const queuePreview = showData?.show.queue ?? [];

  const contextCards = useMemo(
    () =>
      contextPreview
        ? [
            { key: "system", title: "1. 系统提示词", value: contextPreview.systemPrompt },
            { key: "corpus", title: "2. 用户语料", value: contextPreview.userCorpus },
            { key: "env", title: "3. 环境注入", value: contextPreview.environment || "暂无" },
            { key: "memory", title: "4. 已检索记忆", value: contextPreview.retrievedMemory || "暂无" },
            { key: "input", title: "5. 用户输入 / 工具结果", value: contextPreview.inputAndTools },
            { key: "trace", title: "6. 执行轨迹", value: contextPreview.executionTrace }
          ]
        : [],
    [contextPreview]
  );

  function applySession(nextSession: RadioSessionState) {
    setSession(nextSession);
  }

  function applyAppSettings(nextSettings: AppSettingsResponse) {
    setAppSettings(nextSettings);
    setSettingsDraft(toSettingsDraft(nextSettings));
    setOpenaiApiKeyInput("");
    setClearOpenAiApiKey(false);
  }

  async function refreshActivePlaylistOnly() {
    try {
      const nextPlaylist = await fetchJson<ActivePlaylistResponse>("/api/radio/playlist/active");
      setActivePlaylist(nextPlaylist);
    } catch {
      setActivePlaylist(null);
    }
  }

  async function refreshShowOnly() {
    const nextShow = await fetchJson<ShowResponse>("/api/show/current");
    setShowData(nextShow);
  }

  async function refreshSessionOnly() {
    const nextSession = await fetchJson<RadioSessionState>("/api/radio/session");
    applySession(nextSession);
  }

  async function refreshDaypartPlanOnly() {
    const plan = await fetchJson<DaypartPlan>("/api/plan/today");
    setDaypartPlan(plan);
  }

  async function refreshStationStateOnly() {
    const snapshot = await fetchJson<StationStateSummary>("/api/state/summary");
    setStationState(snapshot);
  }

  async function refreshCorpusOnly() {
    const nextCorpus = await fetchJson<CorpusResponse>("/api/corpus");
    setCorpus(nextCorpus);
    setCorpusDraft(nextCorpus);
  }

  async function refreshWeatherSummaryOnly(city?: string) {
    const targetCity = (city ?? appSettings?.defaultWeatherCity ?? settingsDraft.defaultWeatherCity).trim();
    if (!targetCity) {
      setWeatherSummary(null);
      return;
    }

    try {
      const nextWeather = await fetchJson<WeatherSummaryResponse>(
        `/api/context/weather?city=${encodeURIComponent(targetCity)}`
      );
      setWeatherSummary(nextWeather);
    } catch {
      setWeatherSummary(null);
    }
  }

  async function refreshContextPreview(message?: string) {
    const finalMessage = (message ?? contextPreviewMessage).trim();
    if (!finalMessage) {
      return;
    }

    try {
      setIsRefreshingContext(true);
      const history = chatMessages.map(({ role, content }) => ({ role, content }));
      const preview = await fetchJson<ContextWindowPreview>("/api/context/window/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          message: finalMessage,
          history
        })
      });

      setContextPreview(preview);
      setContextPreviewMessage(finalMessage);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "上下文预览刷新失败。");
    } finally {
      setIsRefreshingContext(false);
    }
  }

  async function refreshDashboard() {
    const [
      nextSession,
      nextShow,
      nextLibrary,
      nextLlmStatus,
      nextAppSettings,
      nextCredentialsStatus,
      nextDaypartPlan,
      nextStationState,
      nextCorpus
    ] = await Promise.all([
      fetchJson<RadioSessionState>("/api/radio/session"),
      fetchJson<ShowResponse>("/api/show/current"),
      fetchJson<LibraryResponse>("/api/library/playlists"),
      fetchJson<LlmStatusResponse>("/api/llm/status"),
      fetchJson<AppSettingsResponse>("/api/app/settings"),
      fetchJson<PlatformCredentialsStatus>("/api/integrations/settings"),
      fetchJson<DaypartPlan>("/api/plan/today"),
      fetchJson<StationStateSummary>("/api/state/summary"),
      fetchJson<CorpusResponse>("/api/corpus")
    ]);

    applySession(nextSession);
    setShowData(nextShow);
    setLibrary(nextLibrary);
    setLlmStatus(nextLlmStatus);
    applyAppSettings(nextAppSettings);
    setCredentialsStatus(nextCredentialsStatus);
    setSaveMessage(buildCredentialSavedMessage(nextCredentialsStatus));
    setDaypartPlan(nextDaypartPlan);
    setStationState(nextStationState);
    setCorpus(nextCorpus);
    setCorpusDraft(nextCorpus);
    await refreshActivePlaylistOnly();
    await refreshWeatherSummaryOnly(nextAppSettings.defaultWeatherCity);
  }

  async function syncPlayback(
    event: "play" | "pause" | "timeupdate" | "ended" | "error",
    payload?: {
      positionMs?: number;
      errorMessage?: string;
    }
  ) {
    const trackId = audioRef.current?.dataset.trackId || currentTrack?.id;
    if (!trackId) {
      return;
    }

    const nextSession = await fetchJson<RadioSessionState>("/api/radio/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        event,
        trackId,
        positionMs: payload?.positionMs,
        errorMessage: payload?.errorMessage
      })
    });

    applySession(nextSession);
  }

  async function controlPlayback(action: RadioControlAction, positionMs?: number) {
    const nextSession = await fetchJson<RadioSessionState>("/api/radio/control", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        action,
        positionMs
      })
    });

    applySession(nextSession);
    void refreshStationStateOnly().catch(() => {});
    return nextSession;
  }

  async function selectPlaylist(key: string) {
    setErrorMessage(null);
    const nextSession = await fetchJson<RadioSessionState>("/api/radio/playlist/select", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ key })
    });

    applySession(nextSession);
    await Promise.all([
      refreshActivePlaylistOnly(),
      refreshShowOnly(),
      refreshContextPreview(),
      refreshStationStateOnly()
    ]);
  }

  async function selectTrack(trackId: string) {
    try {
      setSelectingTrackId(trackId);
      setErrorMessage(null);
      const nextSession = await fetchJson<RadioSessionState>("/api/radio/track/select", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          trackId,
          autoplay: true
        })
      });

      applySession(nextSession);
      await Promise.all([refreshShowOnly(), refreshContextPreview(), refreshStationStateOnly()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "切歌失败。");
    } finally {
      setSelectingTrackId(null);
    }
  }

  async function saveCredentials() {
    if (!neteaseCookieInput.trim() && !qqCookieInput.trim()) {
      setSaveMessage("没有新的 Cookie 需要保存。");
      return;
    }

    try {
      setIsSavingCredentials(true);
      setErrorMessage(null);
      const status = await fetchJson<PlatformCredentialsStatus>("/api/integrations/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          neteaseCookie: neteaseCookieInput || undefined,
          qqCookie: qqCookieInput || undefined
        })
      });

      setCredentialsStatus(status);
      setSaveMessage(buildCredentialSavedMessage(status) ?? "平台 Cookie 已保存。");
      setNeteaseCookieInput("");
      setQqCookieInput("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存平台 Cookie 失败。");
    } finally {
      setIsSavingCredentials(false);
    }
  }

  async function saveAppSettingsPanel() {
    try {
      setIsSavingAppSettings(true);
      setSettingsMessage(null);
      setErrorMessage(null);

      const payload: AppSettingsRequest = {
        llmMode: settingsDraft.llmMode,
        llmFallbackToRule: settingsDraft.llmFallbackToRule,
        openaiBaseUrl: settingsDraft.openaiBaseUrl,
        openaiModel: settingsDraft.openaiModel,
        openaiApiKey: openaiApiKeyInput.trim() || undefined,
        clearOpenaiApiKey: clearOpenAiApiKey,
        ollamaBaseUrl: settingsDraft.ollamaBaseUrl,
        ollamaModel: settingsDraft.ollamaModel,
        ttsProvider: settingsDraft.ttsProvider,
        ttsFallbackToWebSpeech: settingsDraft.ttsFallbackToWebSpeech,
        defaultWeatherCity: settingsDraft.defaultWeatherCity,
        autoplayNarrationOnShowUpdate: settingsDraft.autoplayNarrationOnShowUpdate
      };

      const nextSettings = await fetchJson<AppSettingsResponse>("/api/app/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      applyAppSettings(nextSettings);
      setSettingsMessage("应用设置已保存到本机。");
      setLlmStatus(await fetchJson<LlmStatusResponse>("/api/llm/status"));
      await Promise.all([
        refreshShowOnly(),
        refreshDaypartPlanOnly(),
        refreshContextPreview(),
        refreshStationStateOnly(),
        refreshWeatherSummaryOnly(nextSettings.defaultWeatherCity)
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存应用设置失败。");
    } finally {
      setIsSavingAppSettings(false);
    }
  }

  async function saveCorpusPanel() {
    if (!corpusDraft) {
      return;
    }

    try {
      setIsSavingCorpus(true);
      setSettingsMessage(null);
      setErrorMessage(null);
      const nextCorpus = await fetchJson<CorpusResponse>("/api/corpus", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tasteMarkdown: corpusDraft.tasteMarkdown,
          routinesMarkdown: corpusDraft.routinesMarkdown,
          moodRulesMarkdown: corpusDraft.moodRulesMarkdown
        })
      });

      setCorpus(nextCorpus);
      setCorpusDraft(nextCorpus);
      setSettingsMessage("长期语料已保存。");
      await refreshContextPreview();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存长期语料失败。");
    } finally {
      setIsSavingCorpus(false);
    }
  }

  async function applyStructuredControl() {
    const parts = [
      stationControlDraft.weather.trim() ? `天气是${stationControlDraft.weather.trim()}` : "",
      stationControlDraft.mood.trim() ? `我现在的心情是${stationControlDraft.mood.trim()}` : "",
      stationControlDraft.scene.trim() ? `场景是${stationControlDraft.scene.trim()}` : "",
      stationControlDraft.trip.trim() ? `行程安排是${stationControlDraft.trip.trim()}` : "",
      stationControlDraft.energy.trim() ? `我希望整体更${stationControlDraft.energy.trim()}` : "",
      stationControlDraft.artistFocus.trim() ? `优先保留${stationControlDraft.artistFocus.trim()}` : ""
    ].filter(Boolean);

    if (!parts.length) {
      setErrorMessage("请至少填写一个调台条件。");
      return;
    }

    const prompt = `${parts.join("，")}。请基于当前歌单帮我重排一版，并说明这样排的原因。`;

    try {
      setIsApplyingControl(true);
      await sendChatMessage(prompt);
    } finally {
      setIsApplyingControl(false);
    }
  }

  function stopNarrationPlayback() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    narrationAudioRef.current?.pause();
    if (narrationAudioRef.current) {
      narrationAudioRef.current.currentTime = 0;
    }
    speechRef.current = null;
    setIsSpeaking(false);
  }

  function startNarrationPlayback() {
    const tts = showData?.tts;
    const text = tts?.previewText?.trim();
    if (!tts || !text) {
      return;
    }

    stopNarrationPlayback();

    if (tts.mode === "server" && tts.audioUrl) {
      const audio = new Audio(tts.audioUrl);
      narrationAudioRef.current = audio;
      setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      void audio.play().catch(() => {
        setIsSpeaking(false);
      });
      return;
    }

    if (!("speechSynthesis" in window)) {
      setErrorMessage("当前浏览器不支持 Web Speech。");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.98;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    speechRef.current = utterance;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  async function sendChatMessage(preset?: string) {
    const message = (preset ?? chatInput).trim();
    if (!message) {
      return;
    }

    try {
      setIsSendingChat(true);
      setChatWarning(null);
      setErrorMessage(null);
      const history = chatMessages.map(({ role, content }) => ({ role, content }));

      startTransition(() => {
        setChatMessages((previous) => [
          ...previous,
          {
            id: makeMessageId(),
            role: "user",
            content: message
          }
        ]);
      });
      setChatInput("");

      const payload = await fetchJson<ChatConversationResponse>("/api/chat/converse", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          message,
          history
        })
      });

      startTransition(() => {
        setChatMessages((previous) => [
          ...previous,
          {
            id: makeMessageId(),
            role: "assistant",
            content: payload.reply,
            replyTitle: payload.replyTitle,
            mode: payload.mode,
            provider: payload.provider,
            showUpdated: payload.showUpdated,
            contextSummary: payload.contextSummary,
            stationSnapshot: payload.stationSnapshot,
            suggestions: payload.suggestions
          }
        ]);
      });

      if (payload.warning) {
        setChatWarning(payload.warning);
      }

      await Promise.all([refreshContextPreview(message), refreshStationStateOnly()]);

      if (payload.showUpdated) {
        if (appSettings?.autoplayNarrationOnShowUpdate) {
          pendingNarrationAutoplayRef.current = true;
        }
        await Promise.all([refreshSessionOnly(), refreshShowOnly(), refreshDaypartPlanOnly()]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "聊天请求失败。");
    } finally {
      setIsSendingChat(false);
    }
  }

  useEffect(() => {
    let disposed = false;

    refreshDashboard()
      .then(async () => {
        if (!disposed) {
          setErrorMessage(null);
          await refreshContextPreview(buildDefaultContextMessage());
        }
      })
      .catch((error) => {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : "初始化失败。");
        }
      });

    const timer = window.setInterval(() => {
      void refreshSessionOnly().catch(() => {});
    }, SESSION_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      stopNarrationPlayback();
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onPlay = () => {
      void syncPlayback("play", {
        positionMs: Math.floor(audio.currentTime * 1000)
      }).catch(() => {});
    };

    const onPause = () => {
      if (suppressPauseSyncRef.current) {
        suppressPauseSyncRef.current = false;
        return;
      }
      void syncPlayback("pause", {
        positionMs: Math.floor(audio.currentTime * 1000)
      }).catch(() => {});
    };

    const onTimeUpdate = () => {
      const second = Math.floor(audio.currentTime);
      if (second === lastSyncedSecondRef.current) {
        return;
      }
      lastSyncedSecondRef.current = second;
      void syncPlayback("timeupdate", {
        positionMs: Math.floor(audio.currentTime * 1000)
      }).catch(() => {});
    };

    const onEnded = () => {
      void syncPlayback("ended", {
        positionMs: Math.floor(audio.currentTime * 1000)
      }).catch(() => {});
    };

    const onError = () => {
      void syncPlayback("error", {
        positionMs: Math.floor(audio.currentTime * 1000),
        errorMessage: "Audio element playback error."
      }).catch(() => {});
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextTrackId = currentTrack?.id ?? "";
    const nextUrl = currentTrack?.streamUrl?.trim() ?? "";

    if (audio.dataset.trackId !== nextTrackId) {
      suppressPauseSyncRef.current = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.dataset.trackId = nextTrackId;
      lastSyncedSecondRef.current = -1;
    }

    if (!nextTrackId || !nextUrl) {
      return;
    }

    const resolvedSrc = new URL(nextUrl, window.location.href).toString();
    if (audio.src !== resolvedSrc) {
      audio.src = nextUrl;
      audio.load();
    }

    if (session?.isPlaying) {
      void audio.play().catch(() => {});
    } else if (!audio.paused) {
      suppressPauseSyncRef.current = true;
      audio.pause();
    }
  }, [currentTrack?.id, currentTrack?.streamUrl, session?.isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(session?.progressMs)) {
      return;
    }

    const expectedTime = Math.max(0, (session?.progressMs ?? 0) / 1000);
    if (Math.abs(audio.currentTime - expectedTime) > 1.5) {
      audio.currentTime = expectedTime;
    }
  }, [session?.progressMs, currentTrack?.id]);

  useEffect(() => {
    if (!pendingNarrationAutoplayRef.current || !showData?.tts?.previewText?.trim()) {
      return;
    }

    pendingNarrationAutoplayRef.current = false;
    const timer = window.setTimeout(() => {
      startNarrationPlayback();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showData?.tts?.audioUrl, showData?.tts?.mode, showData?.tts?.previewText]);

  return (
    <div className="app-shell">
      <div className="ambient ambient-blue" />
      <div className="ambient ambient-gold" />
      <div className="ambient ambient-indigo" />
      <audio ref={audioRef} preload="none" />

      <header className="masthead glass-card">
        <div className="masthead-copy">
          <span className="eyebrow">Claudio FM</span>
          <h1>{showData?.show.stationName ?? "Claudio AI 电台"}</h1>
          <p>
            {session?.activePlaylistTitle
              ? `当前电台围绕歌单《${session.activePlaylistTitle}》运转。你可以按天气、心情、通勤、工作、深夜独处等条件重排，也可以直接点歌。`
              : "先激活一张已导入歌单。Claudio 会把真实歌曲、聊天上下文和你的长期偏好收敛成一版可持续播放的本地电台。"}
          </p>
        </div>

        <div className="masthead-meta">
          {llmStatus ? <span className="meta-pill">{llmStatus.providerLabel}</span> : null}
          {showData?.tts ? <span className="meta-pill">TTS: {showData.tts.provider}</span> : null}
          {daypartPlan ? <span className="meta-pill">时段: {daypartPlan.nowLabel}</span> : null}
          <button className="ghost-button" onClick={() => setIsSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      {errorMessage ? <div className="error-banner glass-card">{errorMessage}</div> : null}

      <main className="stage-layout">
        <section className="radio-stage glass-card">
          <div className="stage-visual">
            {currentTrack?.coverUrl ? (
              <img src={currentTrack.coverUrl} alt={currentTrack.title} />
            ) : (
              <div className="record-art">
                <div className="record-disc" />
              </div>
            )}
            <div className="visual-glow" />
          </div>

          <div className="stage-copy">
            <div className="stage-copy-top">
              <div>
                <span className="eyebrow">正在播放</span>
                <h2>{currentTrack?.title ?? "还没有可播放歌曲"}</h2>
                <p>{currentTrack?.artist ?? "先在歌单库中选择一张歌单，或者直接从下方点一首歌开始。"} </p>
              </div>
              <div className="status-stack">
                <span className="status-pill">{getPlaybackStatusLabel(currentTrack?.playbackStatus)}</span>
                <span className="status-pill">{getSourceLabel(currentTrack?.resolvedSource)}</span>
              </div>
            </div>

            <div className="show-kicker">
              <strong>{showData?.show.segment ?? "等待编排"}</strong>
              <span>{showData?.show.vibe ?? "尚未生成氛围标签"}</span>
            </div>

            <p className="host-line">{showData?.show.hostLine ?? "激活歌单后，这里会显示当前电台的主持线索与场景说明。"}</p>

            {currentTrack?.failureReason ? <p className="status-note">{currentTrack.failureReason}</p> : null}

            <div className="progress-panel">
              <div className="progress-meta">
                <span>{formatMs(session?.progressMs ?? 0)}</span>
                <span>{formatMs(session?.durationMs ?? 0)}</span>
              </div>
              <input
                className="progress-range"
                type="range"
                min={0}
                max={Math.max(session?.durationMs ?? 0, 1)}
                value={Math.min(session?.progressMs ?? 0, Math.max(session?.durationMs ?? 0, 1))}
                onChange={(event) => {
                  const positionMs = Number(event.target.value);
                  const audio = audioRef.current;
                  if (audio) {
                    audio.currentTime = positionMs / 1000;
                  }
                }}
                onMouseUp={(event) => {
                  void controlPlayback("seek", Number((event.target as HTMLInputElement).value)).catch(() => {});
                }}
                onTouchEnd={(event) => {
                  void controlPlayback("seek", Number((event.target as HTMLInputElement).value)).catch(() => {});
                }}
              />
            </div>

            <div className="player-controls">
              <button className="secondary-control" onClick={() => void controlPlayback("previous").catch(() => {})}>
                上一首
              </button>
              <button
                className="primary-control"
                onClick={() => void controlPlayback(session?.isPlaying ? "pause" : "play").catch(() => {})}
              >
                {session?.isPlaying ? "暂停" : "播放"}
              </button>
              <button className="secondary-control" onClick={() => void controlPlayback("next").catch(() => {})}>
                下一首
              </button>
            </div>

            <div className="queue-strip">
              {queuePreview.map((track) => {
                const isCurrent = track.id === currentTrack?.id;
                const isSelecting = selectingTrackId === track.id;

                return (
                  <button
                    key={track.id}
                    className={`queue-chip ${isCurrent ? "active" : ""}`}
                    onClick={() => void selectTrack(track.id)}
                    disabled={isSelecting}
                  >
                    <strong>{track.title}</strong>
                    <span>{track.artist}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="insight-column">
          <section className="insight-card glass-card">
            <div className="section-head">
              <div>
                <span className="eyebrow">AI 串场</span>
                <h3>{showData?.show.narration.title ?? "等待生成串场"}</h3>
              </div>
              <button
                className="ghost-button"
                onClick={() => {
                  if (isSpeaking) {
                    stopNarrationPlayback();
                  } else {
                    startNarrationPlayback();
                  }
                }}
              >
                {isSpeaking ? "停止播报" : "播放串词"}
              </button>
            </div>

            <p className="narration-copy">
              {showData?.show.narration.text ?? "当你重排电台或切换歌曲后，这里会刷新对应的主持串词。"}
            </p>

            <div className="mini-grid">
              <div className="mini-panel">
                <span className="mini-label">TTS 链路</span>
                <strong>{showData?.tts?.provider ?? "edge"}</strong>
                <small>{showData?.tts?.mode === "server" ? "服务端音频" : "浏览器语音"}</small>
              </div>
              {daypartPlan ? (
                <div className="mini-panel">
                  <span className="mini-label">今日时段</span>
                  <strong>{daypartPlan.nowLabel}</strong>
                  <small>{daypartPlan.schedulerTrace}</small>
                </div>
              ) : null}
            </div>

            {daypartPlan ? <p className="muted-copy">{daypartPlan.recommendation}</p> : null}
          </section>

          <section className="insight-card glass-card">
            <div className="section-head">
              <div>
                <span className="eyebrow">和 Claudio 聊天</span>
                <h3>直接改台、解释、点歌</h3>
              </div>
              {llmStatus ? <span className="meta-pill">{llmStatus.activeMode}</span> : null}
            </div>

            {latestAssistantMessage?.stationSnapshot ? (
              <div className="snapshot-panel">
                <div className="snapshot-headline">
                  <strong>{latestAssistantMessage.replyTitle ?? "当前电台快照"}</strong>
                  {latestAssistantMessage.showUpdated ? <span className="status-pill active">已改台</span> : null}
                </div>
                <p>{latestAssistantMessage.stationSnapshot.segment}</p>
                <small>{latestAssistantMessage.stationSnapshot.vibe}</small>
                {latestAssistantMessage.contextSummary ? (
                  <p className="snapshot-summary">{latestAssistantMessage.contextSummary}</p>
                ) : null}
              </div>
            ) : null}

            <div className="chat-thread">
              {chatMessages.map((message) => (
                <div key={message.id} className={`chat-bubble ${message.role}`}>
                  <div className="chat-bubble-head">
                    <strong>{message.role === "assistant" ? "Claudio" : "你"}</strong>
                    {message.provider ? (
                      <span>
                        {message.provider} / {message.mode}
                      </span>
                    ) : null}
                  </div>
                  {message.replyTitle ? <div className="bubble-title">{message.replyTitle}</div> : null}
                  <p>{message.content}</p>
                  {message.contextSummary ? <small>{message.contextSummary}</small> : null}
                </div>
              ))}
            </div>

            {latestAssistantMessage?.suggestions?.length ? (
              <div className="suggestion-row">
                {latestAssistantMessage.suggestions.map((item) => (
                  <button
                    key={item.id}
                    className="suggestion-pill"
                    onClick={() => void sendChatMessage(item.prompt)}
                    disabled={isSendingChat}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="chat-compose">
              <textarea
                rows={3}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChatMessage();
                  }
                }}
                placeholder="例如：今天下雨，我晚上还要开车回家，帮我排一版更稳更耐听的顺序。"
              />
              <button className="primary-control compact" onClick={() => void sendChatMessage()} disabled={isSendingChat}>
                {isSendingChat ? "思考中..." : "发送"}
              </button>
            </div>

            {chatWarning ? <p className="warning-note">{chatWarning}</p> : null}
            {llmStatus?.issues?.length ? <p className="warning-note">{llmStatus.issues[0]}</p> : null}
          </section>
        </aside>
      </main>

      <section className="library-layout">
        <article className="library-card glass-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">歌单库</span>
              <h3>{library ? `${library.playlists.length} 张已导入歌单` : "加载歌单中"}</h3>
            </div>
            {library?.updatedAt ? <span className="meta-pill">{formatDateTime(library.updatedAt)}</span> : null}
          </div>

          <div className="playlist-stack">
            {(library?.playlists ?? []).map((playlist) => {
              const isActive = playlist.key === session?.activePlaylistKey;
              return (
                <button
                  key={playlist.key}
                  className={`playlist-tile ${isActive ? "active" : ""}`}
                  onClick={() => void selectPlaylist(playlist.key)}
                >
                  <div className="playlist-tile-top">
                    <span>{getSourceBadge(playlist.source)}</span>
                    <span>{playlist.trackCount} 首</span>
                  </div>
                  <strong>{playlist.title}</strong>
                  <small>{playlist.creator}</small>
                </button>
              );
            })}
          </div>
        </article>

        <article className="browser-card glass-card">
          <div className="section-head browser-head">
            <div>
              <span className="eyebrow">整张歌单浏览</span>
              <h3>{activePlaylist?.title ?? "未激活歌单"}</h3>
              <p>
                {activePlaylist
                  ? `${activePlaylist.creator} · 共 ${activePlaylist.trackCount} 首。可以滚动浏览完整歌单并直接点歌。`
                  : "从左侧先选择一张歌单，这里会显示完整曲目列表。"}
              </p>
            </div>
            <input
              className="search-input"
              value={playlistSearch}
              onChange={(event) => setPlaylistSearch(event.target.value)}
              placeholder="搜索歌名 / 歌手 / 专辑"
            />
          </div>

          <div className="track-grid">
            {filteredTracks.map((track, index) => {
              const isCurrent = track.id === currentTrack?.id;
              const isSelecting = selectingTrackId === track.id;
              return (
                <button
                  key={`${track.id}-${index}`}
                  className={`track-tile ${isCurrent ? "current" : ""}`}
                  onClick={() => void selectTrack(track.id)}
                  disabled={isSelecting}
                >
                  <div className="track-cover">
                    {track.coverUrl ? <img src={track.coverUrl} alt={track.title} /> : <div className="track-cover-fallback" />}
                  </div>
                  <div className="track-content">
                    <div className="track-meta-row">
                      <span>#{index + 1}</span>
                      <span>{formatMs(track.durationMs)}</span>
                    </div>
                    <strong>{track.title}</strong>
                    <p>{track.artist}</p>
                    <small>{track.album}</small>
                    <div className="track-tags">
                      {isCurrent ? <span className="status-pill active">当前播放</span> : null}
                      {isSelecting ? <span className="status-pill">切换中</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!filteredTracks.length ? <p className="empty-note">没有匹配到相关歌曲。</p> : null}
        </article>
      </section>

      <section className="brain-layout">
        <article className="brain-card glass-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">调台控制台</span>
              <h3>把天气、心情、行程显式交给 Claudio</h3>
            </div>
            <button className="ghost-button" onClick={() => void refreshWeatherSummaryOnly()}>
              刷新天气
            </button>
          </div>

          {weatherSummary ? (
            <div className="weather-summary-card">
              <strong>{weatherSummary.locationLabel}</strong>
              <p>{weatherSummary.summary}</p>
              <small>{formatDateTime(weatherSummary.fetchedAt)}</small>
            </div>
          ) : (
            <p className="empty-note">还没有读取到天气摘要。</p>
          )}

          <div className="control-grid">
            <label className="field-block">
              <span>天气</span>
              <input
                value={stationControlDraft.weather}
                onChange={(event) =>
                  setStationControlDraft((previous) => ({
                    ...previous,
                    weather: event.target.value
                  }))
                }
                placeholder="例如：下雨、闷热、降温"
              />
            </label>

            <label className="field-block">
              <span>心情</span>
              <input
                value={stationControlDraft.mood}
                onChange={(event) =>
                  setStationControlDraft((previous) => ({
                    ...previous,
                    mood: event.target.value
                  }))
                }
                placeholder="例如：放空、专注、低落、兴奋"
              />
            </label>

            <label className="field-block">
              <span>场景</span>
              <select
                value={stationControlDraft.scene}
                onChange={(event) =>
                  setStationControlDraft((previous) => ({
                    ...previous,
                    scene: event.target.value
                  }))
                }
              >
                <option value="">未指定</option>
                <option value="通勤">通勤</option>
                <option value="专注工作">专注工作</option>
                <option value="开车">开车</option>
                <option value="运动">运动</option>
                <option value="旅行">旅行</option>
                <option value="深夜独处">深夜独处</option>
              </select>
            </label>

            <label className="field-block">
              <span>能量方向</span>
              <select
                value={stationControlDraft.energy}
                onChange={(event) =>
                  setStationControlDraft((previous) => ({
                    ...previous,
                    energy: event.target.value
                  }))
                }
              >
                <option value="">未指定</option>
                <option value="收一点">收一点</option>
                <option value="平衡一点">平衡一点</option>
                <option value="推一点">推一点</option>
              </select>
            </label>
          </div>

          <label className="field-block">
            <span>行程安排</span>
            <textarea
              rows={3}
              value={stationControlDraft.trip}
              onChange={(event) =>
                setStationControlDraft((previous) => ({
                  ...previous,
                  trip: event.target.value
                }))
              }
              placeholder="例如：晚上下班后要开车回家，回去还要继续工作一小时"
            />
          </label>

          <label className="field-block">
            <span>优先歌手 / 风格</span>
            <input
              value={stationControlDraft.artistFocus}
              onChange={(event) =>
                setStationControlDraft((previous) => ({
                  ...previous,
                  artistFocus: event.target.value
                }))
              }
              placeholder="例如：陈奕迅 / 方大同 / 更耐听一点"
            />
          </label>

          <div className="inline-actions">
            <button className="primary-control compact" onClick={() => void applyStructuredControl()} disabled={isApplyingControl}>
              {isApplyingControl ? "调台中..." : "生成这一版"}
            </button>
            <button
              className="ghost-button"
              onClick={() => setStationControlDraft(defaultStationControlDraft)}
              disabled={isApplyingControl}
            >
              清空条件
            </button>
          </div>
        </article>

        <article className="brain-card glass-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">长期语料</span>
              <h3>直接编辑 Taste / Routines / Mood Rules</h3>
            </div>
            <button className="ghost-button" onClick={() => void refreshCorpusOnly()}>
              重新读取
            </button>
          </div>

          {corpusDraft ? (
            <>
              <div className="corpus-grid">
                <label className="field-block">
                  <span>Taste</span>
                  <textarea
                    rows={8}
                    value={corpusDraft.tasteMarkdown}
                    onChange={(event) =>
                      setCorpusDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              tasteMarkdown: event.target.value
                            }
                          : previous
                      )
                    }
                  />
                </label>

                <label className="field-block">
                  <span>Routines</span>
                  <textarea
                    rows={8}
                    value={corpusDraft.routinesMarkdown}
                    onChange={(event) =>
                      setCorpusDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              routinesMarkdown: event.target.value
                            }
                          : previous
                      )
                    }
                  />
                </label>
              </div>

              <label className="field-block">
                <span>Mood Rules</span>
                <textarea
                  rows={7}
                  value={corpusDraft.moodRulesMarkdown}
                  onChange={(event) =>
                    setCorpusDraft((previous) =>
                      previous
                        ? {
                            ...previous,
                            moodRulesMarkdown: event.target.value
                          }
                        : previous
                    )
                  }
                />
              </label>

              <details className="context-card" open={false}>
                <summary>当前自动生成的 playlists digest</summary>
                <pre>{corpus?.playlistsDigest ?? corpusDraft.playlistsDigest}</pre>
              </details>

              <div className="inline-actions">
                <button className="primary-control compact" onClick={() => void saveCorpusPanel()} disabled={isSavingCorpus}>
                  {isSavingCorpus ? "保存中..." : "保存语料"}
                </button>
                {settingsMessage ? <span className="inline-note">{settingsMessage}</span> : null}
              </div>
            </>
          ) : (
            <p className="empty-note">语料尚未加载。</p>
          )}
        </article>

        <article className="brain-card glass-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">记忆面板</span>
              <h3>长期偏好与最近痕迹</h3>
            </div>
            {stationState?.updatedAt ? <span className="meta-pill">{formatDateTime(stationState.updatedAt)}</span> : null}
          </div>

          {stationState ? (
            <>
              <div className="memory-groups">
                <div className="memory-group">
                  <span className="mini-label">偏好歌手</span>
                  <div className="tag-cloud">
                    {stationState.preferences.favoriteArtists.length ? (
                      stationState.preferences.favoriteArtists.slice(0, 10).map((item) => (
                        <span key={`artist-${item}`} className="meta-pill">
                          {item}
                        </span>
                      ))
                    ) : (
                      <small>还没有稳定结论</small>
                    )}
                  </div>
                </div>
                <div className="memory-group">
                  <span className="mini-label">偏好场景</span>
                  <div className="tag-cloud">
                    {stationState.preferences.preferredScenes.length ? (
                      stationState.preferences.preferredScenes.map((item) => (
                        <span key={`scene-${item}`} className="meta-pill">
                          {item}
                        </span>
                      ))
                    ) : (
                      <small>还没有稳定结论</small>
                    )}
                  </div>
                </div>
                <div className="memory-group">
                  <span className="mini-label">偏好情绪</span>
                  <div className="tag-cloud">
                    {stationState.preferences.preferredMoods.length ? (
                      stationState.preferences.preferredMoods.map((item) => (
                        <span key={`mood-${item}`} className="meta-pill">
                          {item}
                        </span>
                      ))
                    ) : (
                      <small>还没有稳定结论</small>
                    )}
                  </div>
                </div>
              </div>

              <div className="trace-grid">
                <div className="trace-card">
                  <span className="mini-label">最近播放</span>
                  <div className="trace-list">
                    {stationState.recentPlays.length ? (
                      stationState.recentPlays.map((item) => (
                        <div key={`${item.at}-${item.trackId}-${item.action}`} className="trace-row">
                          <strong>{item.title ?? item.trackId}</strong>
                          <small>
                            {item.artist ?? item.source ?? "未知来源"} · {item.action}
                          </small>
                        </div>
                      ))
                    ) : (
                      <small>还没有播放痕迹。</small>
                    )}
                  </div>
                </div>

                <div className="trace-card">
                  <span className="mini-label">最近对话</span>
                  <div className="trace-list">
                    {stationState.recentConversation.length ? (
                      stationState.recentConversation.map((item) => (
                        <div key={`${item.at}-${item.role}-${item.content}`} className="trace-row">
                          <strong>{item.role === "assistant" ? "Claudio" : "你"}</strong>
                          <small>{item.content}</small>
                        </div>
                      ))
                    ) : (
                      <small>还没有对话痕迹。</small>
                    )}
                  </div>
                </div>
              </div>

              <pre className="summary-block">{stationState.memorySummary}</pre>
            </>
          ) : (
            <p className="empty-note">记忆面板尚未加载。</p>
          )}
        </article>

        <article className="brain-card glass-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">上下文窗口</span>
              <h3>本轮送入模型的 6 片上下文</h3>
            </div>
            <button className="ghost-button" onClick={() => void refreshContextPreview()} disabled={isRefreshingContext}>
              {isRefreshingContext ? "刷新中..." : "刷新预览"}
            </button>
          </div>

          <p className="muted-copy">{contextPreviewMessage}</p>

          {contextPreview ? (
            <div className="context-grid">
              {contextCards.map((card, index) => (
                <details key={card.key} className="context-card" open={index === 0}>
                  <summary>{card.title}</summary>
                  <pre>{card.value}</pre>
                </details>
              ))}
            </div>
          ) : (
            <p className="empty-note">上下文预览尚未生成。</p>
          )}
        </article>

        <article className="brain-card glass-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">平台凭据</span>
              <h3>本机保存，不暴露给前端</h3>
            </div>
            {credentialsStatus ? (
              <span className="meta-pill">
                网易云 {credentialsStatus.neteaseConfigured ? "已配置" : "未配置"} / QQ{" "}
                {credentialsStatus.qqConfigured ? "已配置" : "未配置"}
              </span>
            ) : null}
          </div>

          <p className="muted-copy">
            Cookie 只会保存在当前电脑的数据目录中。平台未失效时，不需要每次启动都重新填写。
          </p>

          <div className="credentials-grid">
            <label className="field-block">
              <span>网易云 Cookie</span>
              <textarea
                rows={5}
                value={neteaseCookieInput}
                onChange={(event) => setNeteaseCookieInput(event.target.value)}
                placeholder="只在需要更新时粘贴。此前已保存且未失效，可保持为空。"
              />
            </label>

            <label className="field-block">
              <span>QQ 音乐 Cookie</span>
              <textarea
                rows={5}
                value={qqCookieInput}
                onChange={(event) => setQqCookieInput(event.target.value)}
                placeholder="只在需要更新时粘贴。此前已保存且未失效，可保持为空。"
              />
            </label>
          </div>

          <div className="cookie-guides">
            <article className="cookie-guide">
              <strong>网易云 Cookie 获取教程</strong>
              <ol>
                <li>
                  先在当前浏览器登录网易云音乐，然后打开{" "}
                  <a href="https://music.163.com/" target="_blank" rel="noreferrer">
                    music.163.com
                  </a>
                  {" "}任意页面。
                </li>
                <li>按 <code>F12</code> 打开开发者工具。</li>
                <li>进入 <code>Application</code> 面板。</li>
                <li>在左侧找到 <code>Storage -&gt; Cookies -&gt; https://music.163.com</code>。</li>
                <li>把需要的 Cookie 项复制出来，按 <code>name=value; name2=value2</code> 的格式拼成一整行。</li>
                <li>把这一整行粘贴到上面的“网易云 Cookie”输入框，再点击“保存到本机”。</li>
              </ol>
              <div className="cookie-links">
                <a href="https://developer.chrome.com/docs/devtools/application/cookies" target="_blank" rel="noreferrer">
                  Chrome DevTools Cookie 文档
                </a>
                <a href="https://learn.microsoft.com/en-us/microsoft-edge/devtools/storage/cookies" target="_blank" rel="noreferrer">
                  Edge DevTools Cookie 文档
                </a>
              </div>
            </article>

            <article className="cookie-guide">
              <strong>QQ 音乐 Cookie 获取教程</strong>
              <ol>
                <li>
                  先在当前浏览器登录 QQ 音乐，然后打开{" "}
                  <a href="https://y.qq.com/" target="_blank" rel="noreferrer">
                    y.qq.com
                  </a>
                  {" "}任意页面。
                </li>
                <li>按 <code>F12</code> 打开开发者工具。</li>
                <li>进入 <code>Application</code> 面板。</li>
                <li>在左侧找到 <code>Storage -&gt; Cookies -&gt; https://y.qq.com</code>。</li>
                <li>把需要的 Cookie 项复制出来，按 <code>name=value; name2=value2</code> 的格式拼成一整行。</li>
                <li>把这一整行粘贴到上面的“QQ 音乐 Cookie”输入框，再点击“保存到本机”。</li>
              </ol>
              <div className="cookie-links">
                <a href="https://developer.chrome.com/docs/devtools/application/cookies" target="_blank" rel="noreferrer">
                  Chrome DevTools Cookie 文档
                </a>
                <a href="https://learn.microsoft.com/en-us/microsoft-edge/devtools/storage/cookies" target="_blank" rel="noreferrer">
                  Edge DevTools Cookie 文档
                </a>
              </div>
            </article>
          </div>

          <div className="inline-actions">
            <button className="ghost-button" onClick={() => void saveCredentials()} disabled={isSavingCredentials}>
              {isSavingCredentials ? "保存中..." : "保存到本机"}
            </button>
            {saveMessage ? <span className="inline-note">{saveMessage}</span> : null}
          </div>
        </article>
      </section>

      {isSettingsOpen ? (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <section
            className="settings-panel glass-card"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="section-head">
              <div>
                <span className="eyebrow">应用设置</span>
                <h3>本地 AI 电台配置</h3>
              </div>
              <button className="ghost-button" onClick={() => setIsSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <div className="settings-grid">
              <article className="settings-column">
                <div className="settings-block">
                  <span className="mini-label">LLM 模式</span>
                  <select
                    value={settingsDraft.llmMode}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        llmMode: event.target.value as LlmMode
                      }))
                    }
                  >
                    <option value="openai_compatible">OpenAI Compatible / DeepSeek</option>
                    <option value="ollama">Ollama 本地模型</option>
                    <option value="rule">纯规则编排</option>
                  </select>
                </div>

                <div className="settings-block">
                  <span className="mini-label">OpenAI Compatible Base URL</span>
                  <input
                    value={settingsDraft.openaiBaseUrl}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        openaiBaseUrl: event.target.value
                      }))
                    }
                    placeholder="https://api.deepseek.com"
                  />
                </div>

                <div className="settings-block">
                  <span className="mini-label">模型名</span>
                  <input
                    value={settingsDraft.openaiModel}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        openaiModel: event.target.value
                      }))
                    }
                    placeholder="deepseek-chat"
                  />
                </div>

                <div className="settings-block">
                  <span className="mini-label">
                    API Key
                    {appSettings?.openaiApiKeyConfigured ? ` · 已配置 ${appSettings.openaiApiKeyPreview ?? ""}` : ""}
                  </span>
                  <input
                    value={openaiApiKeyInput}
                    onChange={(event) => {
                      setOpenaiApiKeyInput(event.target.value);
                      if (event.target.value.trim()) {
                        setClearOpenAiApiKey(false);
                      }
                    }}
                    placeholder="留空表示不修改"
                  />
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={clearOpenAiApiKey}
                    onChange={(event) => setClearOpenAiApiKey(event.target.checked)}
                  />
                  <span>清空当前 API Key</span>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settingsDraft.llmFallbackToRule}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        llmFallbackToRule: event.target.checked
                      }))
                    }
                  />
                  <span>LLM 不可用时自动回退规则引擎</span>
                </label>
              </article>

              <article className="settings-column">
                <div className="settings-block">
                  <span className="mini-label">TTS Provider</span>
                  <select
                    value={settingsDraft.ttsProvider}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        ttsProvider: event.target.value as "edge" | "webspeech"
                      }))
                    }
                  >
                    <option value="edge">edge</option>
                    <option value="webspeech">webspeech</option>
                  </select>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settingsDraft.ttsFallbackToWebSpeech}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        ttsFallbackToWebSpeech: event.target.checked
                      }))
                    }
                  />
                  <span>Edge TTS 失败时自动回退 Web Speech</span>
                </label>

                <div className="settings-block">
                  <span className="mini-label">默认天气城市</span>
                  <input
                    value={settingsDraft.defaultWeatherCity}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        defaultWeatherCity: event.target.value
                      }))
                    }
                    placeholder="上海"
                  />
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoplayNarrationOnShowUpdate}
                    onChange={(event) =>
                      setSettingsDraft((previous) => ({
                        ...previous,
                        autoplayNarrationOnShowUpdate: event.target.checked
                      }))
                    }
                  />
                  <span>改台后自动播报新的 AI 串场</span>
                </label>

                <div className="settings-summary">
                  <span className="mini-label">运行壳层</span>
                  <code>{appSettings?.appShell ?? "加载中"}</code>
                </div>
                <div className="settings-summary">
                  <span className="mini-label">数据目录</span>
                  <code>{appSettings?.dataRoot ?? "加载中"}</code>
                </div>
              </article>
            </div>

            <div className="inline-actions">
              <button className="primary-control compact" onClick={() => void saveAppSettingsPanel()} disabled={isSavingAppSettings}>
                {isSavingAppSettings ? "保存中..." : "保存设置"}
              </button>
              {settingsMessage ? <span className="inline-note">{settingsMessage}</span> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
