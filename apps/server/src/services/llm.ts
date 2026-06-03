import type {
  ChatConversationIntent,
  ChatConversationMessage,
  ChatStationContext,
  ChatStationSnapshot,
  ChatSuggestion,
  ImportedPlaylist,
  RadioShow
} from "@claudio/core";
import { getEffectiveAppSettings } from "./app-settings.js";
import { buildSuggestionSet, inferConversationIntent, routeConversation } from "./conversation-router.js";
import { buildContextWindow } from "./context-assembler.js";
import { getConfiguredLlmMode, shouldFallbackToRule } from "./llm-config.js";
import { buildDirectedShowFromPlaylist } from "./radio-director.js";
import { getStationStateSnapshot, rememberConversationTurn } from "./station-state.js";
import { getUserCorpus } from "./user-corpus.js";
import { getWeatherSummary } from "./weather.js";

type LlmDecision = {
  show: RadioShow;
  mode: "rule" | "llm";
  provider: string;
  warning?: string;
};

type DjConversationDecision = {
  reply: string;
  replyTitle?: string;
  intent: ChatConversationIntent;
  show?: RadioShow;
  mode: "rule" | "llm";
  provider: string;
  warning?: string;
  showUpdated: boolean;
  contextSummary?: string;
  stationSnapshot?: ChatStationSnapshot;
  suggestions: ChatSuggestion[];
};

type LlmPayload = {
  segment: string;
  vibe: string;
  hostLine: string;
  narrationTitle: string;
  narrationText: string;
  queueIds: string[];
};

type DjConversationPayload = LlmPayload & {
  reply: string;
  replyTitle?: string;
  shouldUpdateShow: boolean;
  contextSummary?: string;
};

const MAX_PROMPT_TRACKS = 80;
const WEAK_REPLY_PATTERNS = [/没听懂/u, /不太懂/u, /不太明白/u, /再说具体一点/u, /请再说一遍/u];

function normalizePayload(payload: unknown): LlmPayload {
  const input = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  return {
    segment: typeof input.segment === "string" ? input.segment.trim() : "",
    vibe: typeof input.vibe === "string" ? input.vibe.trim() : "",
    hostLine: typeof input.hostLine === "string" ? input.hostLine.trim() : "",
    narrationTitle: typeof input.narrationTitle === "string" ? input.narrationTitle.trim() : "",
    narrationText: typeof input.narrationText === "string" ? input.narrationText.trim() : "",
    queueIds: Array.isArray(input.queueIds)
      ? input.queueIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  };
}

function normalizeConversationPayload(payload: unknown): DjConversationPayload {
  const input = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const normalized = normalizePayload(input);
  return {
    ...normalized,
    reply: typeof input.reply === "string" ? input.reply.trim() : "",
    replyTitle: typeof input.replyTitle === "string" ? input.replyTitle.trim() : "",
    contextSummary: typeof input.contextSummary === "string" ? input.contextSummary.trim() : "",
    shouldUpdateShow: Boolean(input.shouldUpdateShow)
  };
}

function sampleTracksForPrompt(playlist: ImportedPlaylist) {
  if (playlist.tracks.length <= MAX_PROMPT_TRACKS) {
    return playlist.tracks;
  }

  const sampled: ImportedPlaylist["tracks"] = [];
  const step = (playlist.tracks.length - 1) / (MAX_PROMPT_TRACKS - 1);

  for (let index = 0; index < MAX_PROMPT_TRACKS; index += 1) {
    const track = playlist.tracks[Math.round(index * step)];
    if (!track || sampled.some((item) => item.id === track.id)) {
      continue;
    }
    sampled.push(track);
  }

  return sampled;
}

function formatTrackDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildTrackPrompt(playlist: ImportedPlaylist): string {
  return sampleTracksForPrompt(playlist)
    .map((track) => `${track.id}|${track.title}|${track.artist}|${track.album}|${track.durationMs}`)
    .join("\n");
}

function parseJsonPayload(raw: string): LlmPayload {
  const trimmed = raw.trim();
  try {
    return normalizePayload(JSON.parse(trimmed));
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return normalizePayload(JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)));
    }
    throw new Error("LLM response did not contain valid JSON.");
  }
}

function parseConversationPayload(raw: string): DjConversationPayload {
  const trimmed = raw.trim();
  try {
    return normalizeConversationPayload(JSON.parse(trimmed));
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return normalizeConversationPayload(JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)));
    }
    throw new Error("LLM conversation response did not contain valid JSON.");
  }
}

function applyLlmPayload(
  playlist: ImportedPlaylist,
  payload: LlmPayload,
  options?: Parameters<typeof buildDirectedShowFromPlaylist>[2]
): RadioShow {
  const ordered = payload.queueIds
    .map((id) => playlist.tracks.find((track) => track.id === id))
    .filter((track): track is ImportedPlaylist["tracks"][number] => Boolean(track))
    .slice(0, 8)
    .map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist || playlist.creator,
      mood: track.album || playlist.title,
      duration: formatTrackDuration(track.durationMs)
    }));

  const fallback = buildDirectedShowFromPlaylist(playlist, payload.hostLine || payload.vibe || playlist.title, options);
  return {
    ...fallback,
    segment: payload.segment || fallback.segment,
    vibe: payload.vibe || fallback.vibe,
    hostLine: payload.hostLine || fallback.hostLine,
    narration: {
      title: payload.narrationTitle || fallback.narration.title,
      text: payload.narrationText || fallback.narration.text
    },
    queue: ordered.length ? ordered : fallback.queue
  };
}

function hasUsefulShowPayload(payload: LlmPayload | DjConversationPayload) {
  return Boolean(
    payload.segment ||
      payload.vibe ||
      payload.hostLine ||
      payload.narrationTitle ||
      payload.narrationText ||
      payload.queueIds.length
  );
}

function isWeakReply(reply: string) {
  const trimmed = reply.trim();
  if (trimmed.length < 6) {
    return true;
  }
  return WEAK_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function buildDirectedPrompt(message: string, extras: string[]) {
  return [message.trim(), ...extras.filter(Boolean)].join(" | ");
}

function buildStationSnapshot(
  playlist: ImportedPlaylist | null,
  show: RadioShow,
  weatherSummary?: string,
  context?: ChatStationContext
): ChatStationSnapshot {
  return {
    playlistTitle: playlist?.title,
    segment: show.segment,
    vibe: show.vibe,
    hostLine: show.hostLine,
    queuePreview: show.queue.slice(0, 4).map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist
    })),
    weatherSummary,
    context
  };
}

function buildRuleReply(
  playlist: ImportedPlaylist | null,
  show: RadioShow,
  intent: ChatConversationIntent,
  showUpdated: boolean
) {
  if (!playlist) {
    return {
      title: "先接入歌单",
      reply: "现在还没有可用歌单。先导入网易云或 QQ 音乐歌单，我才能按天气、心情和行程真正重排这台电台。"
    };
  }

  if (showUpdated) {
    const preview = show.queue.slice(0, 3).map((track) => `${track.title} - ${track.artist}`).join(" / ");
    return {
      title: "已重排电台",
      reply: `我已经按你的要求重排《${playlist.title}》。这一版更偏 ${show.vibe}，前面会先用 ${preview} 开场。`
    };
  }

  if (intent === "explain_mix") {
    const first = show.queue[0];
    const second = show.queue[1];
    return {
      title: "这版的排法",
      reply: first && second
        ? `这一版先用 ${first.title} 定住底色，再让 ${second.title} 接住能量和情绪，所以开场会更连贯。`
        : "这一版优先保证前几首歌的气质连续，不先追求最热门，而是先把氛围铺稳。"
    };
  }

  if (intent === "pick_music") {
    return {
      title: "可以直接点歌",
      reply: "你可以直接点下方歌单里的任意歌曲立刻播放。如果想让我按某个歌手或某种气质优先，我也可以先帮你重排一版。"
    };
  }

  return {
    title: "当前电台状态",
    reply: `现在这台电台围绕《${playlist.title}》在播，当前段落是“${show.segment}”。你可以继续给我天气、心情、行程、歌手偏好，我会继续收紧这版顺序。`
  };
}

async function maybeGetWeatherSummary(message: string, intent: ChatConversationIntent) {
  if (intent !== "tune_station" && intent !== "context_update") {
    return undefined;
  }

  if (!/(天气|下雨|晴天|阴天|热|冷|today|weather|今天)/i.test(message)) {
    return undefined;
  }

  try {
    return (await getWeatherSummary(getEffectiveAppSettings().defaultWeatherCity)).summary;
  } catch {
    return undefined;
  }
}

function buildShowPrompt(playlist: ImportedPlaylist, message: string, contextSummary?: string, weatherSummary?: string) {
  return buildDirectedPrompt(message, [
    contextSummary ? `上下文：${contextSummary}` : "",
    weatherSummary ? `天气参考：${weatherSummary}` : "",
    `歌单：${playlist.title}`
  ]);
}

async function callOllama(playlist: ImportedPlaylist, message: string): Promise<LlmDecision> {
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const prompt = [
    "You are programming an AI radio show.",
    "Return strict JSON only.",
    "JSON keys: segment, vibe, hostLine, narrationTitle, narrationText, queueIds.",
    "Choose up to 8 track ids from the supplied track list only.",
    "Make the queue coherent with the user's direction about mood, weather, scene, pacing, language, or artist preference.",
    `Playlist title: ${playlist.title}`,
    `Creator: ${playlist.creator}`,
    `User direction: ${message}`,
    `Tracks:\n${buildTrackPrompt(playlist)}`
  ].join("\n\n");

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model, prompt, stream: false, format: "json" })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { response?: string };
  const parsed = parseJsonPayload(payload.response ?? "{}");
  return {
    show: applyLlmPayload(playlist, parsed),
    mode: "llm",
    provider: `ollama:${model}`
  };
}

async function callOpenAiCompatible(playlist: ImportedPlaylist, message: string): Promise<LlmDecision> {
  const model = process.env.OPENAI_MODEL ?? "deepseek-chat";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      temperature: 0.55,
      response_format: { type: "json_object" },
      stream: false,
      messages: [
        {
          role: "system",
          content: [
            "You program an AI radio show.",
            "Return strict JSON only.",
            "JSON keys: segment, vibe, hostLine, narrationTitle, narrationText, queueIds.",
            "Choose up to 8 track ids from the supplied track list only.",
            "Make the queue coherent with the user's direction about mood, weather, scene, pacing, language, or artist preference."
          ].join(" ")
        },
        {
          role: "user",
          content: `Playlist title: ${playlist.title}\nCreator: ${playlist.creator}\nUser direction: ${message}\nTracks:\n${buildTrackPrompt(playlist)}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "{}";
  return {
    show: applyLlmPayload(playlist, parseJsonPayload(content)),
    mode: "llm",
    provider: model
  };
}

async function callOllamaConversation(prompt: string) {
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model, prompt, stream: false, format: "json" })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { response?: string };
  return {
    payload: parseConversationPayload(payload.response ?? "{}"),
    mode: "llm" as const,
    provider: `ollama:${model}`
  };
}

async function callOpenAiCompatibleConversation(prompt: string) {
  const model = process.env.OPENAI_MODEL ?? "deepseek-chat";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      temperature: 0.45,
      response_format: { type: "json_object" },
      stream: false,
      messages: [
        {
          role: "system",
          content: [
            "你是 Claudio，一个本地 AI 电台里的对话 DJ。",
            "你要同时完成聊天、编排和串场。",
            "如果用户在调整天气、心情、场景、排序、歌手优先级或整体氛围，应把 shouldUpdateShow 设为 true。",
            "replyTitle 用简短中文概括动作。",
            "reply 用自然中文，1 到 3 句话。",
            "输出必须是 JSON 对象，而且只能输出 JSON。",
            "JSON keys: replyTitle, reply, contextSummary, shouldUpdateShow, segment, vibe, hostLine, narrationTitle, narrationText, queueIds。",
            "如果 shouldUpdateShow=false，就把 segment、vibe、hostLine、narrationTitle、narrationText 设为空字符串，queueIds 设为空数组。"
          ].join(" ")
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "{}";
  return {
    payload: parseConversationPayload(content),
    mode: "llm" as const,
    provider: model
  };
}

export async function buildDirectedShowWithLlm(playlist: ImportedPlaylist, message: string): Promise<LlmDecision> {
  const mode = getConfiguredLlmMode();
  const stationSnapshot = await getStationStateSnapshot();
  const options = {
    memoryPreferences: stationSnapshot.preferences
  };

  if (mode === "ollama") {
    try {
      return await callOllama(playlist, message);
    } catch (error) {
      if (!shouldFallbackToRule()) {
        throw error;
      }
      return {
        show: buildDirectedShowFromPlaylist(playlist, message, options),
        mode: "rule",
        provider: "rule-engine",
        warning: error instanceof Error ? `Ollama fallback: ${error.message}` : "Ollama fallback triggered."
      };
    }
  }

  if (mode === "openai_compatible") {
    try {
      return await callOpenAiCompatible(playlist, message);
    } catch (error) {
      if (!shouldFallbackToRule()) {
        throw error;
      }
      return {
        show: buildDirectedShowFromPlaylist(playlist, message, options),
        mode: "rule",
        provider: "rule-engine",
        warning: error instanceof Error ? `LLM fallback: ${error.message}` : "LLM fallback triggered."
      };
    }
  }

  return {
    show: buildDirectedShowFromPlaylist(playlist, message, options),
    mode: "rule",
    provider: "rule-engine"
  };
}

export async function converseWithDj(
  playlist: ImportedPlaylist | null,
  show: RadioShow,
  message: string,
  history: ChatConversationMessage[] = []
): Promise<DjConversationDecision> {
  const intent = inferConversationIntent(message);
  const weatherSummary = await maybeGetWeatherSummary(message, intent);
  const routed = routeConversation(message, playlist, weatherSummary);
  const corpus = await getUserCorpus();
  const stationSnapshot = await getStationStateSnapshot();
  const showBuildOptions = {
    memoryPreferences: stationSnapshot.preferences
  };

  const contextWindow = buildContextWindow({
    playlist,
    show,
    message,
    history,
    intent: routed.intent,
    context: routed.context,
    contextSummary: routed.contextSummary,
    weatherSummary,
    corpus,
    stationState: {
      updatedAt: stationSnapshot.updatedAt,
      memorySummary: stationSnapshot.memorySummary
    }
  });

  const mode = getConfiguredLlmMode();
  const shouldUpdateInRule = Boolean(
    playlist && (routed.intent === "tune_station" || routed.intent === "context_update" || routed.intent === "pick_music")
  );

  const llmPrompt = [
    "## 1. 系统提示词",
    contextWindow.systemPrompt,
    "",
    "## 2. 用户语料",
    contextWindow.userCorpus,
    "",
    "## 3. 环境注入",
    contextWindow.environment,
    "",
    "## 4. 已检索记忆",
    contextWindow.retrievedMemory,
    "",
    "## 5. 用户输入 / 工具结果",
    contextWindow.inputAndTools,
    "",
    "## 6. 执行轨迹",
    contextWindow.executionTrace
  ].join("\n");

  const rememberConversation = async (assistantReply: string) => {
    await rememberConversationTurn({
      role: "user",
      content: message,
      intent: routed.intent,
      scene: routed.context.scene,
      mood: routed.context.mood,
      artistFocus: routed.context.artistFocus
    });
    await rememberConversationTurn({
      role: "assistant",
      content: assistantReply,
      intent: routed.intent,
      scene: routed.context.scene,
      mood: routed.context.mood,
      artistFocus: routed.context.artistFocus
    });
  };

  const buildRuleDecision = async (warning?: string): Promise<DjConversationDecision> => {
    const nextShow =
      shouldUpdateInRule && playlist
        ? buildDirectedShowFromPlaylist(
            playlist,
            buildShowPrompt(playlist, message, routed.contextSummary, weatherSummary),
            showBuildOptions
          )
        : undefined;
    const activeShow = nextShow ?? show;
    const ruleReply = buildRuleReply(playlist, activeShow, routed.intent, Boolean(nextShow));

    await rememberConversation(ruleReply.reply);

    return {
      reply: ruleReply.reply,
      replyTitle: ruleReply.title,
      intent: routed.intent,
      show: nextShow,
      mode: "rule",
      provider: "rule-engine",
      warning,
      showUpdated: Boolean(nextShow),
      contextSummary: routed.contextSummary,
      stationSnapshot: buildStationSnapshot(playlist, activeShow, weatherSummary, routed.context),
      suggestions: buildSuggestionSet(playlist, routed, Boolean(nextShow))
    };
  };

  const finalizeConversation = async (
    payload: DjConversationPayload,
    meta: { mode: "llm"; provider: string; warning?: string }
  ): Promise<DjConversationDecision> => {
    const shouldUpdateShow = Boolean(
      playlist &&
        (payload.shouldUpdateShow ||
          routed.intent === "tune_station" ||
          routed.intent === "context_update" ||
          routed.intent === "pick_music")
    );

    const nextShow =
      shouldUpdateShow && playlist
        ? hasUsefulShowPayload(payload)
          ? applyLlmPayload(playlist, payload, showBuildOptions)
          : buildDirectedShowFromPlaylist(
              playlist,
              buildShowPrompt(playlist, message, routed.contextSummary, weatherSummary),
              showBuildOptions
            )
        : undefined;

    const activeShow = nextShow ?? show;
    const fallbackReply = buildRuleReply(playlist, activeShow, routed.intent, Boolean(nextShow));
    const reply = isWeakReply(payload.reply) ? fallbackReply.reply : payload.reply;

    await rememberConversation(reply);

    return {
      reply,
      replyTitle: payload.replyTitle || fallbackReply.title,
      intent: routed.intent,
      show: nextShow,
      mode: meta.mode,
      provider: meta.provider,
      warning: meta.warning,
      showUpdated: Boolean(nextShow),
      contextSummary: payload.contextSummary || routed.contextSummary,
      stationSnapshot: buildStationSnapshot(playlist, activeShow, weatherSummary, routed.context),
      suggestions: buildSuggestionSet(playlist, routed, Boolean(nextShow))
    };
  };

  if (mode === "ollama") {
    try {
      const result = await callOllamaConversation(llmPrompt);
      return await finalizeConversation(result.payload, result);
    } catch (error) {
      if (!shouldFallbackToRule()) {
        throw error;
      }
      return buildRuleDecision(error instanceof Error ? `Ollama fallback: ${error.message}` : "Ollama fallback triggered.");
    }
  }

  if (mode === "openai_compatible") {
    try {
      const result = await callOpenAiCompatibleConversation(llmPrompt);
      return await finalizeConversation(result.payload, result);
    } catch (error) {
      if (!shouldFallbackToRule()) {
        throw error;
      }
      return buildRuleDecision(error instanceof Error ? `LLM fallback: ${error.message}` : "LLM fallback triggered.");
    }
  }

  return buildRuleDecision();
}
