# Claudio AI Radio

Claudio is an AI DJ radio application with:

- playlist-based radio sequencing
- chat-driven station direction
- real editable user corpus
- local memory and preference accumulation
- NetEase / QQ playlist import
- browser and desktop runtime support

## Stack

- `apps/web`: React + Vite + TypeScript
- `apps/server`: Fastify + TypeScript
- `packages/core`: shared types

## Local development

```bash
npm install
npm run dev
```

Optional:

```bash
copy .env.example .env
```

Windows one-click launcher:

```bash
启动Claudio电台.bat
```

## Production web mode

This project now supports a single-service web deployment:

- the Fastify server serves the API
- the Fastify server also serves `apps/web/dist`
- the browser uses same-origin `/api/*` requests in web mode
- editable data is persisted under `CLAUDIO_DATA_DIR`

Build and run:

```bash
npm ci
npm run build
npm run start:prod
```

Render-like local acceptance run:

PowerShell:

```powershell
Copy-Item .env.example .env -Force
npm ci
npm run build
$env:CLAUDIO_APP_SHELL="browser"
$env:PORT="10000"
$env:CLAUDIO_DATA_DIR="$PWD\\tmp\\render-data"
$env:CORS_ORIGIN=""
npm run start:prod
```

Then verify:

- open `http://127.0.0.1:10000/`
- `http://127.0.0.1:10000/health` returns `{"status":"ok","service":"claudio-server"}`
- refresh any SPA route directly, for example `http://127.0.0.1:10000/settings` or another client route, and it should still fall back to `index.html`
- `GET /api/app/settings` should show `appShell: "browser"` and the `dataRoot` you injected
- `GET /api/llm/status` should reflect the production env defaults or your locally saved overrides

Important environment variables:

- `PORT`
- `CLAUDIO_APP_SHELL=browser`
- `CLAUDIO_DATA_DIR=/absolute/path/to/data-dir`
- `LLM_MODE`
- `TTS_PROVIDER`

Optional but commonly needed:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `NETEASE_COOKIE`
- `QQ_COOKIE`

## Render deployment

There is a ready-to-use [render.yaml](C:/Users/20208/Documents/VIBE%20CODING%20IJao22%E7%94%B5%E5%8F%B0/render.yaml) in the repo root.

It deploys:

- one free Node web service

Render build/start:

- build: `npm ci && npm run build`
- start: `npm run start:prod`

Required notes:

- you must deploy from a Git repository
- `OPENAI_API_KEY` must be filled in Render if you want DeepSeek / OpenAI-compatible mode
- `NETEASE_COOKIE` and `QQ_COOKIE` are only needed if you expect server-side playlist import against logged-in provider state
- server-generated TTS audio URLs will automatically use Render's runtime `RENDER_EXTERNAL_URL`; only set `CLAUDIO_PUBLIC_API_BASE` if you need to override that behavior on another platform or behind a custom proxy
- on Render free instances, local files are ephemeral and can be reset on restart or redeploy
- that means platform cookies, imported playlists, corpus edits, memory state, and uploaded voices are not guaranteed to persist online

## Current deployment status

This workspace is now pushed to GitHub and prepared for Render deployment.

Remaining work:

1. create the Render service from the GitHub repository
2. fill cloud secrets: `OPENAI_API_KEY`, and optionally `NETEASE_COOKIE` / `QQ_COOKIE`
3. after first boot, verify `/health`, `/api/app/settings`, `/api/llm/status`, playlist import, and one TTS playback round-trip in the live URL

## Current scope

- glassmorphism radio UI
- station control console
- editable corpus panel
- memory panel
- context window preview
- TTS narration
- playlist browser
- NetEase / QQ playlist import
- real local persistence for imports, settings, corpus, and state

## Main endpoints

- `GET /health`
- `GET /api/show/current`
- `GET /api/radio/session`
- `GET /api/library/playlists`
- `GET /api/plan/today`
- `GET /api/state/summary`
- `GET /api/corpus`
- `POST /api/corpus`
- `GET /api/llm/status`
- `POST /api/chat/converse`

## LLM modes

Default mode is `rule`.

- `LLM_MODE=rule`
- `LLM_MODE=ollama`
- `LLM_MODE=openai_compatible`

If the configured LLM is unavailable, the server falls back to the rule engine by default.

## Tree

```text
apps/
  server/
  web/
packages/
  core/
docs/
  architecture.md
  claudio-architecture.jpg
render.yaml
```
