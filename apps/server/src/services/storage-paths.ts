import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShellMode } from "@claudio/core";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../../");
const configuredDataRoot = process.env.CLAUDIO_DATA_DIR?.trim();
const dataRoot = configuredDataRoot ? resolve(configuredDataRoot) : join(repoRoot, "data");
const appShell = (process.env.CLAUDIO_APP_SHELL?.trim().toLowerCase() as AppShellMode | undefined) ?? "browser";

export function getRepoRootPath() {
  return repoRoot;
}

export function getDataRootPath() {
  return dataRoot;
}

export function getConfigDirPath() {
  return join(dataRoot, "config");
}

export function getImportsDirPath() {
  return join(dataRoot, "imports");
}

export function getCorpusDirPath() {
  return join(dataRoot, "corpus");
}

export function getStateDirPath() {
  return join(dataRoot, "state");
}

export function getTtsVoicesDirPath() {
  return join(dataRoot, "tts-voices");
}

export function getTtsAudioCacheDirPath() {
  return join(dataRoot, "audio-cache", "tts");
}

export function getAppShellMode(): AppShellMode {
  return appShell === "desktop" ? "desktop" : "browser";
}

export function ensureDataDirectories() {
  mkdirSync(getConfigDirPath(), { recursive: true });
  mkdirSync(getImportsDirPath(), { recursive: true });
  mkdirSync(getCorpusDirPath(), { recursive: true });
  mkdirSync(getStateDirPath(), { recursive: true });
  mkdirSync(getTtsVoicesDirPath(), { recursive: true });
  mkdirSync(getTtsAudioCacheDirPath(), { recursive: true });
}
