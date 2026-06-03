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

Important environment variables:

- `PORT`
- `CLAUDIO_APP_SHELL=browser`
- `CLAUDIO_DATA_DIR=/absolute/path/to/persistent-data`
- `OPENAI_API_KEY`
- `LLM_MODE`
- `TTS_PROVIDER`

## Render deployment

There is a ready-to-use [render.yaml](C:/Users/20208/Documents/VIBE%20CODING%20IJao22%E7%94%B5%E5%8F%B0/render.yaml) in the repo root.

It deploys:

- one Node web service
- one persistent disk mounted at `/opt/render/project/src/render-data`

Render build/start:

- build: `npm ci && npm run build`
- start: `npm run start:prod`

Required notes:

- you must deploy from a Git repository
- `OPENAI_API_KEY` must be filled in Render if you want DeepSeek / OpenAI-compatible mode
- platform cookies, imported playlists, corpus edits, memory state, and uploaded voices will persist in the mounted disk

## Current deployment blockers

This workspace is deployment-ready, but not yet publicly released from this machine because:

- there is no `.git` repository in the workspace root
- there is no Git remote configured
- `render` CLI is not installed here
- `gh` CLI is not installed here

So the code has been prepared for cloud deployment, but the final publish step still requires:

1. initializing or reconnecting Git in this folder
2. pushing to GitHub / GitLab / Bitbucket
3. creating the Render service from that repo

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
