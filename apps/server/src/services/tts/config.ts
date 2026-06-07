import type { TtsProviderKey } from "@claudio/core";
import { getEffectiveAppSettings } from "../app-settings.ts";

const implementedProviders = new Set<TtsProviderKey>([
  "edge",
  "webspeech"
]);

export function getConfiguredTtsProvider(): TtsProviderKey {
  const value = getEffectiveAppSettings().ttsProvider as TtsProviderKey | undefined;
  if (value && implementedProviders.has(value)) {
    return value;
  }

  return "edge";
}
