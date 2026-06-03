import type { TtsProviderKey, TtsRequest, TtsResult } from "@claudio/core";

export interface TtsProvider {
  key: TtsProviderKey;
  synthesize(input: TtsRequest): Promise<TtsResult>;
}

