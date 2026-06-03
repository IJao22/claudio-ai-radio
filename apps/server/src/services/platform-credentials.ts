import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlatformCredentialsRequest, PlatformCredentialsStatus } from "@claudio/core";
import { getConfigDirPath } from "./storage-paths.js";

type StoredCredentials = {
  neteaseCookie?: string;
  qqCookie?: string;
  updatedAt?: string;
};

export type PlatformCredentials = {
  neteaseCookie?: string;
  qqCookie?: string;
  updatedAt?: string;
};

const configDir = getConfigDirPath();
const credentialsPath = join(configDir, "platform-credentials.local.json");

async function ensureConfigDir() {
  await mkdir(configDir, { recursive: true });
}

async function readCredentials(): Promise<StoredCredentials> {
  await ensureConfigDir();

  try {
    const raw = await readFile(credentialsPath, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return {};
  }
}

export async function getPlatformCredentials(): Promise<PlatformCredentials> {
  const credentials = await readCredentials();
  return {
    neteaseCookie: credentials.neteaseCookie?.trim() || undefined,
    qqCookie: credentials.qqCookie?.trim() || undefined,
    updatedAt: credentials.updatedAt
  };
}

export async function getPlatformCredentialsStatus(): Promise<PlatformCredentialsStatus> {
  const credentials = await getPlatformCredentials();
  return {
    neteaseConfigured: Boolean(credentials.neteaseCookie?.trim()),
    qqConfigured: Boolean(credentials.qqCookie?.trim()),
    updatedAt: credentials.updatedAt
  };
}

export async function savePlatformCredentials(input: PlatformCredentialsRequest): Promise<PlatformCredentialsStatus> {
  const existing = await readCredentials();
  const next: StoredCredentials = {
    ...existing,
    updatedAt: new Date().toISOString()
  };

  if (input.neteaseCookie !== undefined) {
    const value = input.neteaseCookie.trim();
    next.neteaseCookie = value || undefined;
  }

  if (input.qqCookie !== undefined) {
    const value = input.qqCookie.trim();
    next.qqCookie = value || undefined;
  }

  await ensureConfigDir();
  await writeFile(credentialsPath, JSON.stringify(next, null, 2), "utf8");
  return getPlatformCredentialsStatus();
}
