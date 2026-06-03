import type { TtsRequest, TtsResult } from "@claudio/core";
import type { TtsProvider } from "../base.js";

export class WebSpeechProvider implements TtsProvider {
  key = "webspeech" as const;

  async synthesize(input: TtsRequest): Promise<TtsResult> {
    return {
      provider: this.key,
      mode: "client",
      previewText: input.text
    };
  }
}

