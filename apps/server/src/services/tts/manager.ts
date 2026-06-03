import type { TtsProviderKey, TtsRequest, TtsResult } from "@claudio/core";
import { EdgeTtsProvider } from "./providers/edge.js";
import { WebSpeechProvider } from "./providers/webspeech.js";
import type { TtsProvider } from "./base.js";
import { getEffectiveAppSettings } from "../app-settings.js";

export class TtsManager {
  private providers: Record<string, TtsProvider>;

  constructor() {
    this.providers = {
      edge: new EdgeTtsProvider(),
      webspeech: new WebSpeechProvider()
    };
  }

  async synthesize(input: TtsRequest, preferred?: TtsProviderKey): Promise<TtsResult> {
    const settings = getEffectiveAppSettings();
    const providerKey = preferred ?? settings.ttsProvider ?? "edge";
    const provider = this.providers[providerKey] ?? this.providers.webspeech;

    try {
      return await provider.synthesize(input);
    } catch (error) {
      if (providerKey === "webspeech" || !settings.ttsFallbackToWebSpeech) {
        throw error;
      }

      return this.providers.webspeech.synthesize(input);
    }
  }
}
