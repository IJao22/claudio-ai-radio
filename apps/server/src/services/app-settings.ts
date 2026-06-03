import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSettingsRequest, AppSettingsResponse, LlmMode } from "@claudio/core";
import { getAppShellMode, getConfigDirPath, getDataRootPath } from "./storage-paths.js";

type StoredAppSettings = {
  llmMode?: LlmMode;
  llmFallbackToRule?: boolean;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ttsProvider?: "edge" | "webspeech";
  ttsFallbackToWebSpeech?: boolean;
  ttsIndexTts2Url?: string;
  defaultWeatherCity?: string;
  autoplayNarrationOnShowUpdate?: boolean;
  updatedAt?: string;
};

type EffectiveAppSettings = {
  llmMode: LlmMode;
  llmFallbackToRule: boolean;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey?: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ttsProvider: "edge" | "webspeech";
  ttsFallbackToWebSpeech: boolean;
  ttsIndexTts2Url: string;
  defaultWeatherCity: string;
  autoplayNarrationOnShowUpdate: boolean;
  updatedAt?: string;
};

const settingsPath = join(getConfigDirPath(), "app-settings.local.json");

function ensureConfigDir() {
  mkdirSync(getConfigDirPath(), { recursive: true });
}

function normalizeLlmMode(value?: string): LlmMode {
  const raw = value?.trim().toLowerCase();
  if (raw === "ollama") {
    return "ollama";
  }

  if (raw === "openai_compatible" || raw === "deepseek") {
    return "openai_compatible";
  }

  return "rule";
}

function normalizeTtsProvider(value?: string): "edge" | "webspeech" {
  const raw = value?.trim().toLowerCase();
  if (raw === "webspeech") {
    return "webspeech";
  }

  return "edge";
}

function readStoredSettings(): StoredAppSettings {
  ensureConfigDir();

  try {
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as StoredAppSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let settingsCache = readStoredSettings();

function writeStoredSettings(next: StoredAppSettings) {
  ensureConfigDir();
  settingsCache = next;
  writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined) {
    return fallback;
  }

  if (raw === "1" || raw === "true") {
    return true;
  }

  if (raw === "0" || raw === "false") {
    return false;
  }

  return fallback;
}

function readStringSetting(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function getDefaultEffectiveSettings(): EffectiveAppSettings {
  return {
    llmMode: normalizeLlmMode(process.env.LLM_MODE ?? "rule"),
    llmFallbackToRule: readBooleanEnv("LLM_FALLBACK_TO_RULE", true),
    openaiBaseUrl: readStringSetting(process.env.OPENAI_BASE_URL, "https://api.deepseek.com"),
    openaiModel: readStringSetting(process.env.OPENAI_MODEL, "deepseek-chat"),
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    ollamaBaseUrl: readStringSetting(process.env.OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
    ollamaModel: readStringSetting(process.env.OLLAMA_MODEL, "qwen2.5:7b"),
    ttsProvider: normalizeTtsProvider(process.env.TTS_PROVIDER ?? "edge"),
    ttsFallbackToWebSpeech: readBooleanEnv("TTS_FALLBACK_TO_WEB_SPEECH", true),
    ttsIndexTts2Url: "",
    defaultWeatherCity: readStringSetting(process.env.CLAUDIO_DEFAULT_WEATHER_CITY, "上海"),
    autoplayNarrationOnShowUpdate: readBooleanEnv("CLAUDIO_AUTOPLAY_NARRATION_ON_SHOW_UPDATE", false),
    updatedAt: undefined
  };
}

export function getEffectiveAppSettings(): EffectiveAppSettings {
  const defaults = getDefaultEffectiveSettings();

  return {
    llmMode: settingsCache.llmMode ?? defaults.llmMode,
    llmFallbackToRule: settingsCache.llmFallbackToRule ?? defaults.llmFallbackToRule,
    openaiBaseUrl: readStringSetting(settingsCache.openaiBaseUrl, defaults.openaiBaseUrl),
    openaiModel: readStringSetting(settingsCache.openaiModel, defaults.openaiModel),
    openaiApiKey: settingsCache.openaiApiKey?.trim() || defaults.openaiApiKey,
    ollamaBaseUrl: readStringSetting(settingsCache.ollamaBaseUrl, defaults.ollamaBaseUrl),
    ollamaModel: readStringSetting(settingsCache.ollamaModel, defaults.ollamaModel),
    ttsProvider: normalizeTtsProvider(settingsCache.ttsProvider ?? defaults.ttsProvider),
    ttsFallbackToWebSpeech: settingsCache.ttsFallbackToWebSpeech ?? defaults.ttsFallbackToWebSpeech,
    ttsIndexTts2Url: readStringSetting(settingsCache.ttsIndexTts2Url, defaults.ttsIndexTts2Url),
    defaultWeatherCity: readStringSetting(settingsCache.defaultWeatherCity, defaults.defaultWeatherCity),
    autoplayNarrationOnShowUpdate:
      settingsCache.autoplayNarrationOnShowUpdate ?? defaults.autoplayNarrationOnShowUpdate,
    updatedAt: settingsCache.updatedAt
  };
}

function maskApiKey(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= 10) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  }

  return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`;
}

function toResponse(effective: EffectiveAppSettings): AppSettingsResponse {
  return {
    llmMode: effective.llmMode,
    llmFallbackToRule: effective.llmFallbackToRule,
    openaiBaseUrl: effective.openaiBaseUrl,
    openaiModel: effective.openaiModel,
    openaiApiKeyConfigured: Boolean(effective.openaiApiKey?.trim()),
    openaiApiKeyPreview: maskApiKey(effective.openaiApiKey),
    ollamaBaseUrl: effective.ollamaBaseUrl,
    ollamaModel: effective.ollamaModel,
    ttsProvider: effective.ttsProvider,
    ttsFallbackToWebSpeech: effective.ttsFallbackToWebSpeech,
    ttsIndexTts2Url: effective.ttsIndexTts2Url,
    defaultWeatherCity: effective.defaultWeatherCity,
    autoplayNarrationOnShowUpdate: effective.autoplayNarrationOnShowUpdate,
    dataRoot: getDataRootPath(),
    appShell: getAppShellMode(),
    updatedAt: effective.updatedAt
  };
}

export function getAppSettings() {
  return toResponse(getEffectiveAppSettings());
}

export function saveAppSettings(input: AppSettingsRequest) {
  const next: StoredAppSettings = {
    ...settingsCache,
    updatedAt: new Date().toISOString()
  };

  if (input.llmMode !== undefined) {
    next.llmMode = normalizeLlmMode(input.llmMode);
  }

  if (input.llmFallbackToRule !== undefined) {
    next.llmFallbackToRule = Boolean(input.llmFallbackToRule);
  }

  if (input.openaiBaseUrl !== undefined) {
    next.openaiBaseUrl = input.openaiBaseUrl.trim() || undefined;
  }

  if (input.openaiModel !== undefined) {
    next.openaiModel = input.openaiModel.trim() || undefined;
  }

  if (input.clearOpenaiApiKey) {
    next.openaiApiKey = undefined;
  } else if (input.openaiApiKey !== undefined) {
    next.openaiApiKey = input.openaiApiKey.trim() || undefined;
  }

  if (input.ollamaBaseUrl !== undefined) {
    next.ollamaBaseUrl = input.ollamaBaseUrl.trim() || undefined;
  }

  if (input.ollamaModel !== undefined) {
    next.ollamaModel = input.ollamaModel.trim() || undefined;
  }

  if (input.ttsProvider !== undefined) {
    next.ttsProvider = normalizeTtsProvider(input.ttsProvider);
  }

  if (input.ttsFallbackToWebSpeech !== undefined) {
    next.ttsFallbackToWebSpeech = Boolean(input.ttsFallbackToWebSpeech);
  }

  if (input.ttsIndexTts2Url !== undefined) {
    next.ttsIndexTts2Url = input.ttsIndexTts2Url.trim() || undefined;
  }

  if (input.defaultWeatherCity !== undefined) {
    next.defaultWeatherCity = input.defaultWeatherCity.trim() || undefined;
  }

  if (input.autoplayNarrationOnShowUpdate !== undefined) {
    next.autoplayNarrationOnShowUpdate = Boolean(input.autoplayNarrationOnShowUpdate);
  }

  writeStoredSettings(next);
  return getAppSettings();
}
