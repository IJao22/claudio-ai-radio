import Fastify from "fastify";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { Readable } from "node:stream";
import type {
  AppSettingsRequest,
  ChatConversationRequest,
  ChatConversationResponse,
  ChatControlResponse,
  PlatformCredentialsRequest,
  RadioControlRequest,
  RadioPlaylistSelectionRequest,
  RadioTrackSelectionRequest,
  RadioSyncRequest,
  TtsVoiceSelectRequest,
  TtsVoiceUploadRequest
} from "@claudio/core";
import { getAppSettings, saveAppSettings } from "./services/app-settings.js";
import { routeConversation } from "./services/conversation-router.js";
import { buildContextWindow } from "./services/context-assembler.js";
import { getLlmStatus } from "./services/llm-config.js";
import { buildDirectedShowWithLlm, converseWithDj } from "./services/llm.js";
import { MusicImporter } from "./services/music/importer.js";
import { getStoredPlaylists } from "./services/music/library-store.js";
import { getPlatformCredentialsStatus, savePlatformCredentials } from "./services/platform-credentials.js";
import { radioSessionService } from "./services/radio-session.js";
import { getCurrentDaypartPlan } from "./services/scheduler.js";
import { rememberPlayEvent } from "./services/station-state.js";
import { getStationStateSnapshot, getStationStateSummary } from "./services/station-state.js";
import { TtsManager } from "./services/tts/manager.js";
import {
  createTtsAudioReadStream,
  fileExists,
  getTtsAudioContentType,
  resolveTtsAudioFilePath
} from "./services/tts/audio-cache.js";
import {
  deleteTtsVoice,
  getTtsVoiceLibrary,
  selectTtsVoice,
  uploadTtsVoice
} from "./services/tts/voice-library.js";
import { getUserCorpus, saveUserCorpus } from "./services/user-corpus.js";
import { getWeatherSummary } from "./services/weather.js";
import { getRepoRootPath } from "./services/storage-paths.js";

function resolveCorsOrigin() {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return true;
  }

  const origins = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (origins.length <= 1) {
    return origins[0] ?? true;
  }

  return origins;
}

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 25 * 1024 * 1024
  });
  const ttsManager = new TtsManager();
  const musicImporter = new MusicImporter();

  void musicImporter.reimportLegacyQqPlaylists().catch((error) => {
    console.warn(
      "Skipping startup QQ playlist reimport because the background refresh failed.",
      error instanceof Error ? error.message : error
    );
  });

  await app.register(cors, {
    origin: resolveCorsOrigin()
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "claudio-server"
  }));

  app.get("/api/show/current", async () => {
    const session = await radioSessionService.getState();
    const show = session.show;
    const tts = await ttsManager.synthesize({
      text: show.narration.text
    }, show.ttsProvider);

    return {
      show,
      tts
    };
  });

  app.get("/api/radio/session", async () => {
    return radioSessionService.getState();
  });

  app.get("/api/plan/today", async () => {
    return getCurrentDaypartPlan();
  });

  app.get("/api/state/summary", async () => {
    return getStationStateSnapshot();
  });

  app.post<{ Body: ChatConversationRequest }>("/api/context/window/preview", async (request, reply) => {
    const message = request.body?.message?.trim();
    if (!message) {
      reply.code(400);
      return {
        error: "Message is required."
      };
    }

    const session = await radioSessionService.getState();
    const activePlaylist = await radioSessionService.getActivePlaylist();
    const routed = routeConversation(message, activePlaylist, undefined);
    const corpus = await getUserCorpus();
    const memory = await getStationStateSummary();

    return buildContextWindow({
      playlist: activePlaylist,
      show: session.show,
      message,
      history: request.body?.history ?? [],
      intent: routed.intent,
      context: routed.context,
      contextSummary: routed.contextSummary,
      corpus,
      stationState: memory
    });
  });

  app.post<{ Body: RadioControlRequest }>("/api/radio/control", async (request, reply) => {
    const action = request.body?.action;
    if (!action) {
      reply.code(400);
      return {
        error: "Action is required."
      };
    }

    const state = await radioSessionService.control(action, request.body?.positionMs);
    if (state.currentTrack) {
      await rememberPlayEvent({
        at: new Date().toISOString(),
        action: action === "next" || action === "previous" ? action : "play",
        trackId: state.currentTrack.id,
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        source: state.currentTrack.resolvedSource
      });
    }

    return state;
  });

  app.post<{ Body: RadioSyncRequest }>("/api/radio/sync", async (request, reply) => {
    const event = request.body?.event;
    if (!event) {
      reply.code(400);
      return {
        error: "Playback event is required."
      };
    }

    return radioSessionService.sync(request.body);
  });

  app.post<{ Body: RadioPlaylistSelectionRequest }>("/api/radio/playlist/select", async (request, reply) => {
    const key = request.body?.key?.trim();
    if (!key) {
      reply.code(400);
      return {
        error: "Playlist key is required."
      };
    }

    const state = await radioSessionService.setPlaylistByKey(key);
    if (!state) {
      reply.code(404);
      return {
        error: "Playlist not found."
      };
    }

    return state;
  });

  app.post<{ Body: RadioTrackSelectionRequest }>("/api/radio/track/select", async (request, reply) => {
    const trackId = request.body?.trackId?.trim();
    if (!trackId) {
      reply.code(400);
      return {
        error: "Track id is required."
      };
    }

    const state = await radioSessionService.selectTrack(trackId, request.body?.autoplay !== false);
    if (!state) {
      reply.code(404);
      return {
        error: "Track not found in the active playlist."
      };
    }

    if (state.currentTrack) {
      await rememberPlayEvent({
        at: new Date().toISOString(),
        action: "select",
        trackId: state.currentTrack.id,
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        source: state.currentTrack.resolvedSource
      });
    }

    return state;
  });

  app.get("/api/import/seed", async () => {
    return musicImporter.getSeed();
  });

  app.post<{ Body: { urls?: string[] } }>("/api/import/preview", async (request) => {
    return {
      inputs: musicImporter.preview(request.body?.urls ?? [])
    };
  });

  app.post("/api/import/seed/sync", async () => {
    const imported = [];
    for (const input of musicImporter.getSeed().inputs) {
      imported.push(await musicImporter.importPlaylist(input));
    }

    radioSessionService.onLibraryChanged();

    return {
      count: imported.length,
      playlists: imported.map((playlist) => ({
        source: playlist.source,
        id: playlist.id,
        title: playlist.title,
        creator: playlist.creator,
        trackCount: playlist.trackCount,
        canonicalUrl: playlist.canonicalUrl
      }))
    };
  });

  app.get("/api/library/playlists", async () => {
    return getStoredPlaylists();
  });

  app.get("/api/radio/playlist/active", async (request, reply) => {
    const playlist = await radioSessionService.getActivePlaylist();
    if (!playlist) {
      reply.code(404);
      return {
        error: "No active playlist."
      };
    }

    return {
      key: `${playlist.source}-${playlist.id}`,
      source: playlist.source,
      id: playlist.id,
      title: playlist.title,
      creator: playlist.creator,
      trackCount: playlist.trackCount,
      coverUrl: playlist.coverUrl,
      tracks: playlist.tracks
    };
  });

  app.get<{ Querystring: { city?: string } }>("/api/context/weather", async (request, reply) => {
    const city = request.query?.city?.trim();
    if (!city) {
      reply.code(400);
      return {
        error: "City is required."
      };
    }

    try {
      return await getWeatherSummary(city);
    } catch (error) {
      reply.code(502);
      return {
        error: error instanceof Error ? error.message : "Weather fetch failed."
      };
    }
  });

  app.get<{ Params: { playlistKey: string; trackId: string } }>(
    "/api/audio/stream/:playlistKey/:trackId",
    async (request, reply) => {
      const result = await radioSessionService.openAudioStream(
        request.params.playlistKey,
        request.params.trackId,
        typeof request.headers.range === "string" ? request.headers.range : undefined
      );

      if (!result.ok) {
        reply.code(result.statusCode);
        return {
          error: result.error
        };
      }

      const passthroughHeaders = [
        "accept-ranges",
        "cache-control",
        "content-length",
        "content-range",
        "content-type",
        "etag",
        "last-modified"
      ];

      for (const headerName of passthroughHeaders) {
        const value = result.response.headers.get(headerName);
        if (value) {
          reply.header(headerName, value);
        }
      }

      reply.code(result.response.status);
      if (!result.response.body) {
        return reply.send("");
      }

      return reply.send(Readable.fromWeb(result.response.body as never));
    }
  );

  app.get("/api/integrations/settings", async () => {
    return getPlatformCredentialsStatus();
  });

  app.get("/api/app/settings", async () => {
    return getAppSettings();
  });

  app.get("/api/corpus", async () => {
    return getUserCorpus();
  });

  app.get<{ Params: { fileName: string } }>("/api/tts/audio/:fileName", async (request, reply) => {
    const fileName = request.params.fileName?.trim();
    if (!fileName || basename(fileName) !== fileName) {
      reply.code(400);
      return {
        error: "Invalid TTS audio file name."
      };
    }

    const absolutePath = resolveTtsAudioFilePath(fileName);
    if (!(await fileExists(absolutePath))) {
      reply.code(404);
      return {
        error: "TTS audio file was not found."
      };
    }

    reply.header("content-type", getTtsAudioContentType(fileName));
    reply.header("cache-control", "private, max-age=86400");
    return reply.send(createTtsAudioReadStream(absolutePath));
  });

  app.post<{ Body: AppSettingsRequest }>("/api/app/settings", async (request) => {
    return saveAppSettings(request.body ?? {});
  });

  app.post<{
    Body: {
      tasteMarkdown?: string;
      routinesMarkdown?: string;
      moodRulesMarkdown?: string;
    };
  }>("/api/corpus", async (request, reply) => {
    const body = request.body ?? {};
    if (
      body.tasteMarkdown === undefined &&
      body.routinesMarkdown === undefined &&
      body.moodRulesMarkdown === undefined
    ) {
      reply.code(400);
      return {
        error: "At least one corpus field is required."
      };
    }

    return saveUserCorpus(body);
  });

  app.post<{ Body: PlatformCredentialsRequest }>("/api/integrations/settings", async (request, reply) => {
    const body = request.body ?? {};
    if (body.neteaseCookie === undefined && body.qqCookie === undefined) {
      reply.code(400);
      return {
        error: "At least one credential field is required."
      };
    }

    return savePlatformCredentials(body);
  });

  app.get("/api/tts/voices", async () => {
    return getTtsVoiceLibrary();
  });

  app.post<{ Body: TtsVoiceUploadRequest }>("/api/tts/voices", async (request, reply) => {
    const body = request.body ?? ({} as TtsVoiceUploadRequest);
    if (!body.fileName?.trim() || !body.audioBase64?.trim()) {
      reply.code(400);
      return {
        error: "fileName and audioBase64 are required."
      };
    }

    try {
      return await uploadTtsVoice(body);
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : "Voice upload failed."
      };
    }
  });

  app.post<{ Body: TtsVoiceSelectRequest }>("/api/tts/voices/select", async (request, reply) => {
    const body = request.body ?? ({} as TtsVoiceSelectRequest);
    if (!body.voiceId?.trim()) {
      reply.code(400);
      return {
        error: "voiceId is required."
      };
    }

    try {
      return await selectTtsVoice(body);
    } catch (error) {
      reply.code(404);
      return {
        error: error instanceof Error ? error.message : "Voice selection failed."
      };
    }
  });

  app.delete<{ Params: { voiceId: string } }>("/api/tts/voices/:voiceId", async (request, reply) => {
    const voiceId = request.params.voiceId?.trim();
    if (!voiceId) {
      reply.code(400);
      return {
        error: "voiceId is required."
      };
    }

    try {
      return await deleteTtsVoice(voiceId);
    } catch (error) {
      reply.code(404);
      return {
        error: error instanceof Error ? error.message : "Voice deletion failed."
      };
    }
  });

  app.get("/api/llm/status", async () => {
    return getLlmStatus();
  });

  app.post<{ Body: ChatConversationRequest }>("/api/chat/converse", async (request, reply) => {
    const message = request.body?.message?.trim();
    if (!message) {
      reply.code(400);
      return {
        error: "Message is required."
      };
    }

    try {
      const session = await radioSessionService.getState();
      const activePlaylist = await radioSessionService.getActivePlaylist();
      const history = request.body?.history ?? [];
      const decision = await converseWithDj(activePlaylist, session.show, message, history);

      if (decision.show) {
        await radioSessionService.replaceShow(decision.show);
      }

      const response: ChatConversationResponse = {
        reply: decision.reply,
        replyTitle: decision.replyTitle,
        intent: decision.intent,
        mode: decision.mode,
        provider: decision.provider,
        warning: decision.warning,
        showUpdated: decision.showUpdated,
        contextSummary: decision.contextSummary,
        stationSnapshot: decision.stationSnapshot,
        suggestions: decision.suggestions
      };

      return response;
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : "Conversation failed."
      };
    }
  });

  app.post<{ Body: { message?: string } }>("/api/chat/control", async (request, reply) => {
    const message = request.body?.message?.trim();
    if (!message) {
      reply.code(400);
      return {
        error: "Message is required."
      };
    }

    const session = await radioSessionService.getState();
    const activePlaylistKey = session.activePlaylistKey;
    if (!activePlaylistKey) {
      reply.code(409);
      return {
        error: "No imported playlist is available yet."
      };
    }

    try {
      const playlist = await radioSessionService.getActivePlaylist();
      if (!playlist || `${playlist.source}-${playlist.id}` !== activePlaylistKey) {
        const restored = await radioSessionService.setPlaylistByKey(activePlaylistKey);
        if (!restored?.activePlaylistKey) {
          reply.code(409);
          return {
            error: "Active playlist could not be loaded."
          };
        }
      }

      const activePlaylist = await radioSessionService.getActivePlaylist();
      if (!activePlaylist) {
        reply.code(409);
        return {
          error: "Active playlist content is unavailable."
        };
      }

      const directed = await buildDirectedShowWithLlm(activePlaylist, message);
      await radioSessionService.replaceShow(directed.show);
      const tts = await ttsManager.synthesize({
        text: directed.show.narration.text
      }, directed.show.ttsProvider);

      const response: ChatControlResponse = {
        show: directed.show,
        tts,
        mode: directed.mode,
        provider: directed.provider,
        warning: directed.warning
      };

      return response;
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : "Chat control failed."
      };
    }
  });

  app.get<{ Params: { source: string; id: string } }>("/api/import/:source/:id", async (request, reply) => {
    const source = request.params.source;
    const id = request.params.id;

    const preview = musicImporter.preview([
      source === "netease"
        ? `https://music.163.com/playlist?id=${id}`
        : `https://c6.y.qq.com/base/fcgi-bin/u?__=${id}`
    ])[0];

    if (!preview) {
      reply.code(400);
      return {
        error: "Invalid import source or id."
      };
    }

    try {
      const imported = await musicImporter.importPlaylist(preview);
      radioSessionService.onLibraryChanged();
      return imported;
    } catch (error) {
      reply.code(501);
      return {
        error: error instanceof Error ? error.message : "Import failed."
      };
    }
  });

  const staticRoot = process.env.CLAUDIO_WEB_DIST_DIR?.trim() || join(getRepoRootPath(), "apps", "web", "dist");
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/"
    });

    app.setNotFoundHandler(async (request, reply) => {
      const requestedPath = request.url.replace(/^\//, "");

      if (requestedPath.startsWith("api/")) {
        reply.code(404);
        return {
          error: "Not found."
        };
      }

      if (requestedPath.includes(".")) {
        reply.code(404);
        return {
          error: "Static asset was not found."
        };
      }

      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    });
  }

  return app;
}
