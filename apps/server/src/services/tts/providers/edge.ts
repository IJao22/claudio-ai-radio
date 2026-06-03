import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TtsRequest, TtsResult } from "@claudio/core";
import type { TtsProvider } from "../base.js";
import {
  buildTtsCacheKey,
  cleanupStaleTtsAudioCache,
  ensureTtsAudioCacheDir,
  fileExists,
  resolveTtsAudioFilePath
} from "../audio-cache.js";
import { getDataRootPath } from "../../storage-paths.js";

const dataRoot = getDataRootPath();
const runtimeRoot = join(dataRoot, "runtime", "edge-tts");
const sitePackagesRoot = join(runtimeRoot, "site-packages");
const installStatePath = join(runtimeRoot, "install-state.json");
const defaultVoice = process.env.CLAUDIO_EDGE_TTS_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";

let installPromise: Promise<void> | null = null;
let pythonPathPromise: Promise<string> | null = null;

type RunCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function getServerBaseUrl() {
  const configured = process.env.CLAUDIO_PUBLIC_API_BASE?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const port = process.env.PORT?.trim() || "8787";
  return `http://127.0.0.1:${port}`;
}

async function runCommand(
  executable: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: {
        ...process.env,
        ...options?.env
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timeoutHandle: NodeJS.Timeout | undefined;

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });

    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });

    if (options?.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        child.kill();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms.`));
      }, options.timeoutMs);
    }
  });
}

async function canRunPython(executable: string) {
  if (!executable) {
    return false;
  }

  try {
    const result = await runCommand(executable, ["--version"], { timeoutMs: 8000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function resolvePythonPath() {
  if (pythonPathPromise) {
    return pythonPathPromise;
  }

  pythonPathPromise = (async () => {
    const candidates = [
      process.env.CLAUDIO_PYTHON_PATH?.trim(),
      join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
      join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python"),
      process.platform === "win32" ? undefined : "python3",
      "python"
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      if (candidate.includes("\\") || candidate.includes("/")) {
        if (!existsSync(candidate)) {
          continue;
        }
      }

      if (await canRunPython(candidate)) {
        return candidate;
      }
    }

    throw new Error("No usable Python runtime was found for edge-tts.");
  })();

  return pythonPathPromise;
}

async function ensurePipAvailable(pythonPath: string) {
  const pipCheck = await runCommand(pythonPath, ["-m", "pip", "--version"], {
    env: {
      PYTHONPATH: sitePackagesRoot
    },
    timeoutMs: 15000
  });

  if (pipCheck.code === 0) {
    return;
  }

  const ensurePip = await runCommand(pythonPath, ["-m", "ensurepip", "--upgrade"], {
    timeoutMs: 60000
  });

  if (ensurePip.code !== 0) {
    throw new Error(`Failed to enable pip for edge-tts: ${ensurePip.stderr || ensurePip.stdout}`);
  }
}

async function canImportEdgeTts(pythonPath: string) {
  const result = await runCommand(
    pythonPath,
    ["-c", "import edge_tts; print(edge_tts.__version__)"],
    {
      env: {
        PYTHONPATH: sitePackagesRoot
      },
      timeoutMs: 15000
    }
  );

  return result.code === 0 ? result.stdout.trim() : "";
}

async function ensureEdgeRuntimeInstalled() {
  if (installPromise) {
    return installPromise;
  }

  installPromise = (async () => {
    const pythonPath = await resolvePythonPath();
    await mkdir(sitePackagesRoot, { recursive: true });

    const installedVersion = await canImportEdgeTts(pythonPath);
    if (installedVersion) {
      await writeFile(
        installStatePath,
        JSON.stringify({ version: installedVersion, updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
      return;
    }

    await ensurePipAvailable(pythonPath);
    const installResult = await runCommand(
      pythonPath,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--upgrade",
        "--target",
        sitePackagesRoot,
        "edge-tts"
      ],
      {
        timeoutMs: 180000
      }
    );

    if (installResult.code !== 0) {
      throw new Error(`edge-tts install failed: ${installResult.stderr || installResult.stdout}`);
    }

    const version = await canImportEdgeTts(pythonPath);
    if (!version) {
      throw new Error("edge-tts installed, but the module could not be imported.");
    }

    await writeFile(
      installStatePath,
      JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
  })().catch((error) => {
    installPromise = null;
    throw error;
  });

  return installPromise;
}

function formatRate(speed?: number) {
  if (!speed || !Number.isFinite(speed) || speed === 1) {
    return "+0%";
  }

  const delta = Math.max(-50, Math.min(100, Math.round((speed - 1) * 100)));
  return `${delta >= 0 ? "+" : ""}${delta}%`;
}

export class EdgeTtsProvider implements TtsProvider {
  key = "edge" as const;

  async synthesize(input: TtsRequest): Promise<TtsResult> {
    const text = input.text?.trim();
    if (!text) {
      return {
        provider: this.key,
        mode: "client",
        previewText: ""
      };
    }

    await ensureEdgeRuntimeInstalled();
    await ensureTtsAudioCacheDir();
    await cleanupStaleTtsAudioCache();

    const voice = defaultVoice;
    const rate = formatRate(input.speed);
    const cacheKey = buildTtsCacheKey({
      provider: this.key,
      text,
      voice,
      rate
    });
    const fileName = `${cacheKey}.mp3`;
    const outputPath = resolveTtsAudioFilePath(fileName);

    if (!(await fileExists(outputPath))) {
      const pythonPath = await resolvePythonPath();
      const result = await runCommand(
        pythonPath,
        [
          "-m",
          "edge_tts",
          "--text",
          text,
          "--voice",
          voice,
          "--rate",
          rate,
          "--write-media",
          outputPath
        ],
        {
          env: {
            PYTHONPATH: sitePackagesRoot
          },
          timeoutMs: 180000
        }
      );

      if (result.code !== 0) {
        throw new Error(`edge-tts synthesis failed: ${result.stderr || result.stdout}`);
      }
    }

    return {
      provider: this.key,
      mode: "server",
      audioUrl: `${getServerBaseUrl()}/api/tts/audio/${encodeURIComponent(fileName)}`,
      previewText: text
    };
  }
}
