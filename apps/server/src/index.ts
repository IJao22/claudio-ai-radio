import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { ensureDataDirectories } from "./services/storage-paths.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../");

dotenv.config({
  path: resolve(repoRoot, ".env"),
  override: false
});

const port = Number(process.env.PORT ?? 8787);
ensureDataDirectories();

const app = await buildApp();

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`Claudio server listening on http://localhost:${port}`);
});
