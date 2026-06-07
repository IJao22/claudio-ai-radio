import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatConversationIntent } from "@claudio/core";
import { getStateDirPath } from "./storage-paths.ts";

type StoredConversationTurn = {
  at: string;
  role: "user" | "assistant";
  content: string;
  intent?: ChatConversationIntent;
};

type StoredPlayEvent = {
  at: string;
  trackId: string;
  title?: string;
  artist?: string;
  source?: string;
  action: "select" | "play" | "next" | "previous";
};

type StationStateRecord = {
  updatedAt: string;
  preferences: {
    favoriteArtists: string[];
    preferredScenes: string[];
    preferredMoods: string[];
  };
  conversation: StoredConversationTurn[];
  plays: StoredPlayEvent[];
};

export type StationPreferences = StationStateRecord["preferences"];

export type StationStateSummary = {
  updatedAt?: string;
  memorySummary: string;
};

export type StationStateSnapshot = {
  updatedAt?: string;
  preferences: StationPreferences;
  recentConversation: StoredConversationTurn[];
  recentPlays: StoredPlayEvent[];
  memorySummary: string;
};

const stateDir = getStateDirPath();
const statePath = join(stateDir, "state.db.json");

async function ensureStateDir() {
  await mkdir(stateDir, { recursive: true });
}

function createDefaultState(): StationStateRecord {
  return {
    updatedAt: new Date(0).toISOString(),
    preferences: {
      favoriteArtists: [],
      preferredScenes: [],
      preferredMoods: []
    },
    conversation: [],
    plays: []
  };
}

async function readState(): Promise<StationStateRecord> {
  await ensureStateDir();
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as StationStateRecord;
  } catch {
    const initial = createDefaultState();
    await writeFile(statePath, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

async function writeState(next: StationStateRecord) {
  await ensureStateDir();
  await writeFile(statePath, JSON.stringify(next, null, 2), "utf8");
}

function uniqPush(target: string[], value?: string) {
  const normalized = value?.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }

  target.unshift(normalized);
  if (target.length > 12) {
    target.length = 12;
  }
}

function splitArtists(input?: string) {
  return (input ?? "")
    .split(/[,&/、]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export async function rememberConversationTurn(input: {
  role: "user" | "assistant";
  content: string;
  intent?: ChatConversationIntent;
  scene?: string;
  mood?: string;
  artistFocus?: string[];
}) {
  const state = await readState();
  state.updatedAt = new Date().toISOString();
  state.conversation.push({
    at: state.updatedAt,
    role: input.role,
    content: input.content,
    intent: input.intent
  });
  state.conversation = state.conversation.slice(-30);

  uniqPush(state.preferences.preferredScenes, input.scene);
  uniqPush(state.preferences.preferredMoods, input.mood);
  for (const artist of input.artistFocus ?? []) {
    uniqPush(state.preferences.favoriteArtists, artist);
  }

  await writeState(state);
}

export async function rememberPlayEvent(input: StoredPlayEvent) {
  const state = await readState();
  state.updatedAt = new Date().toISOString();
  state.plays.push(input);
  state.plays = state.plays.slice(-40);

  for (const artist of splitArtists(input.artist)) {
    uniqPush(state.preferences.favoriteArtists, artist);
  }

  await writeState(state);
}

export async function getStationStateSummary(): Promise<StationStateSummary> {
  const state = await readState();
  const recentConversation = state.conversation
    .slice(-6)
    .map((item) => `${item.role === "assistant" ? "Claudio" : "User"}: ${item.content}`)
    .join(" | ");
  const recentPlays = state.plays
    .slice(-6)
    .map((item) => `${item.action}:${item.title || item.trackId}`)
    .join(" | ");

  const lines = [
    state.preferences.favoriteArtists.length
      ? `favoriteArtists: ${state.preferences.favoriteArtists.join(" / ")}`
      : "",
    state.preferences.preferredScenes.length
      ? `preferredScenes: ${state.preferences.preferredScenes.join(" / ")}`
      : "",
    state.preferences.preferredMoods.length
      ? `preferredMoods: ${state.preferences.preferredMoods.join(" / ")}`
      : "",
    recentConversation ? `recentConversation: ${recentConversation}` : "",
    recentPlays ? `recentPlays: ${recentPlays}` : ""
  ].filter(Boolean);

  return {
    updatedAt: state.updatedAt,
    memorySummary: lines.join("\n") || "No stored memory yet."
  };
}

export async function getStationStateSnapshot(): Promise<StationStateSnapshot> {
  const state = await readState();
  const summary = await getStationStateSummary();

  return {
    updatedAt: state.updatedAt,
    preferences: state.preferences,
    recentConversation: state.conversation.slice(-8).reverse(),
    recentPlays: state.plays.slice(-8).reverse(),
    memorySummary: summary.memorySummary
  };
}
