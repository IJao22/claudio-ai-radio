import type {
  ChatConversationIntent,
  ChatConversationMessage,
  ChatStationContext,
  ImportedPlaylist,
  RadioShow
} from "@claudio/core";
import type { StationStateSummary } from "./station-state.js";
import type { UserCorpus } from "./user-corpus.js";
import { getCurrentDaypartPlan } from "./scheduler.js";

export type ContextWindowFragments = {
  systemPrompt: string;
  userCorpus: string;
  environment: string;
  retrievedMemory: string;
  inputAndTools: string;
  executionTrace: string;
};

type BuildContextWindowInput = {
  playlist: ImportedPlaylist | null;
  show: RadioShow;
  message: string;
  history: ChatConversationMessage[];
  intent: ChatConversationIntent;
  context: ChatStationContext;
  contextSummary?: string;
  weatherSummary?: string;
  corpus: UserCorpus;
  stationState: StationStateSummary;
};

function buildTrackPrompt(playlist: ImportedPlaylist): string {
  return playlist.tracks
    .slice(0, 80)
    .map((track) => `${track.id}|${track.title}|${track.artist}|${track.album}|${track.durationMs}`)
    .join("\n");
}

function buildConversationHistory(history: ChatConversationMessage[]) {
  return history
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

function buildShowSummary(show: RadioShow) {
  return [
    `segment: ${show.segment}`,
    `vibe: ${show.vibe}`,
    `hostLine: ${show.hostLine}`,
    `narrationTitle: ${show.narration.title}`,
    `narrationText: ${show.narration.text}`,
    "queue:",
    ...show.queue.map((track, index) => `${index + 1}. ${track.id}|${track.title}|${track.artist}|${track.mood}|${track.duration}`)
  ].join("\n");
}

export function buildContextWindow(input: BuildContextWindowInput): ContextWindowFragments {
  const daypart = getCurrentDaypartPlan();

  return {
    systemPrompt: [
      "你是 Claudio，一个本地 AI 电台里的对话 DJ。",
      "你需要同时完成：聊天、编排、串场、点歌建议。",
      "当用户要求改变天气、心情、场景、排序、歌手优先级时，要把电台视为可重排对象。",
      "输出必须是严格 JSON，供本地应用消费。"
    ].join("\n"),
    userCorpus: [
      "## taste.md",
      input.corpus.tasteMarkdown,
      "",
      "## routines.md",
      input.corpus.routinesMarkdown,
      "",
      "## mood-rules.md",
      input.corpus.moodRulesMarkdown,
      "",
      "## playlists.json digest",
      input.corpus.playlistsDigest
    ].join("\n"),
    environment: [
      `daypart: ${daypart.nowLabel}`,
      `schedulerHint: ${daypart.recommendation}`,
      input.weatherSummary ? `weather: ${input.weatherSummary}` : "",
      input.contextSummary ? `context: ${input.contextSummary}` : ""
    ]
      .filter(Boolean)
      .join("\n"),
    retrievedMemory: input.stationState.memorySummary,
    inputAndTools: [
      `intent: ${input.intent}`,
      `userMessage: ${input.message}`,
      input.history.length ? `recentHistory:\n${buildConversationHistory(input.history)}` : "",
      `currentShow:\n${buildShowSummary(input.show)}`,
      input.playlist
        ? `activePlaylist: ${input.playlist.title} / ${input.playlist.creator}\ntracks:\n${buildTrackPrompt(input.playlist)}`
        : "activePlaylist: none"
    ]
      .filter(Boolean)
      .join("\n\n"),
    executionTrace: [
      `scheduler: ${daypart.schedulerTrace}`,
      `toolsUsed: weather=${Boolean(input.weatherSummary)}, corpus=true, memory=true`,
      `sourceFiles: ${Object.values(input.corpus.sourceFiles).join(" | ")}`
    ].join("\n")
  };
}
