import type { LlmMode, LlmStatusResponse } from "@claudio/core";
import { getEffectiveAppSettings } from "./app-settings.js";

export function getConfiguredLlmMode(): LlmMode {
  return getEffectiveAppSettings().llmMode;
}

export function shouldFallbackToRule(): boolean {
  return getEffectiveAppSettings().llmFallbackToRule;
}

export function getLlmStatus(): LlmStatusResponse {
  const settings = getEffectiveAppSettings();
  const configuredMode = getConfiguredLlmMode();
  const fallbackToRule = shouldFallbackToRule();
  const issues: string[] = [];
  let ready = true;
  let providerLabel = "rule-engine";

  if (configuredMode === "ollama") {
    providerLabel = `ollama:${settings.ollamaModel}`;
    if (!settings.ollamaBaseUrl) {
      issues.push("OLLAMA_BASE_URL is not set. Using default http://127.0.0.1:11434.");
    }
  }

  if (configuredMode === "openai_compatible") {
    providerLabel = settings.openaiModel;
    if (!settings.openaiApiKey) {
      issues.push("OPENAI_API_KEY is missing.");
      ready = false;
    }
    if (!settings.openaiBaseUrl) {
      issues.push("OPENAI_BASE_URL is not set. Using default https://api.deepseek.com.");
    }
  }

  if (!ready && fallbackToRule) {
    return {
      configuredMode,
      activeMode: "rule",
      providerLabel: "rule-engine",
      ready: true,
      fallbackToRule,
      issues
    };
  }

  return {
    configuredMode,
    activeMode: configuredMode,
    providerLabel,
    ready,
    fallbackToRule,
    issues
  };
}
