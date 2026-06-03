import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const stageRoot = join(repoRoot, "tmp", "desktop-bundle");
const bundleRoot = join(stageRoot, "app-bundle");
const isWindows = process.platform === "win32";
const bundledNodeFileName = isWindows ? "node.exe" : "node";

async function copyPath(from, to, options = {}) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, {
    recursive: true,
    force: true,
    filter: options.filter
  });
}

async function copyIfExists(from, to, options = {}) {
  try {
    await cp(from, to, {
      recursive: true,
      force: true,
      filter: options.filter
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  return true;
}

function runChecked(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function prepareDirectories() {
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });
}

async function prepareAppAssets() {
  await copyPath(join(repoRoot, "apps", "web", "dist"), join(bundleRoot, "apps", "web", "dist"));
  await copyPath(join(repoRoot, "apps", "server", "dist"), join(bundleRoot, "apps", "server", "dist"));
  await copyPath(join(repoRoot, "apps", "server", "package.json"), join(bundleRoot, "apps", "server", "package.json"));
  await copyPath(process.execPath, join(bundleRoot, "runtime", "node", bundledNodeFileName));
}

async function prepareSeedData() {
  const sourceDataRoot = join(repoRoot, "data");
  const seedRoot = join(bundleRoot, "data-seed");
  const seedConfigRoot = join(seedRoot, "config");

  await mkdir(seedConfigRoot, { recursive: true });
  await copyIfExists(join(sourceDataRoot, "imports"), join(seedRoot, "imports"));
  await copyIfExists(join(sourceDataRoot, "tts-voices"), join(seedRoot, "tts-voices"));
  await copyIfExists(
    join(sourceDataRoot, "config", "tts-voices.local.json"),
    join(seedConfigRoot, "tts-voices.local.json")
  );

  try {
    const rawSettings = await readFile(join(sourceDataRoot, "config", "app-settings.local.json"), "utf8");
    const parsedSettings = JSON.parse(rawSettings);

    if (parsedSettings && typeof parsedSettings === "object") {
      delete parsedSettings.openaiApiKey;
      await writeFile(join(seedConfigRoot, "app-settings.local.json"), JSON.stringify(parsedSettings, null, 2), "utf8");
    }
  } catch {
    // Ignore missing or invalid local settings during packaging.
  }
}

async function prepareServerDependencies() {
  const rawServerPackage = await readFile(join(repoRoot, "apps", "server", "package.json"), "utf8");
  const serverPackage = JSON.parse(rawServerPackage);
  const dependencies = { ...(serverPackage.dependencies ?? {}) };
  delete dependencies["@claudio/core"];

  const bundlePackage = {
    name: "claudio-desktop-runtime",
    private: true,
    type: "module",
    dependencies
  };

  await writeFile(join(bundleRoot, "package.json"), JSON.stringify(bundlePackage, null, 2), "utf8");
  if (process.platform === "win32") {
    runChecked("cmd.exe", ["/c", "npm", "install", "--omit=dev", "--ignore-scripts", "--no-package-lock"], bundleRoot);
  } else {
    const npmCli = process.env.npm_execpath?.trim();
    if (!npmCli) {
      throw new Error("npm_execpath is not available. Run desktop:prepare through npm.");
    }

    runChecked(process.execPath, [npmCli, "install", "--omit=dev", "--ignore-scripts", "--no-package-lock"], bundleRoot);
  }

  await copyPath(join(repoRoot, "packages", "core", "dist"), join(bundleRoot, "node_modules", "@claudio", "core", "dist"));
  await copyPath(
    join(repoRoot, "packages", "core", "package.json"),
    join(bundleRoot, "node_modules", "@claudio", "core", "package.json")
  );
}

async function main() {
  console.log("Preparing Claudio desktop bundle...");
  await prepareDirectories();
  await prepareAppAssets();
  await prepareSeedData();
  await prepareServerDependencies();
  console.log(`Desktop bundle ready at ${bundleRoot}`);
}

await main();
