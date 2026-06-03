import type { ImportedPlaylist, RadioShow, Track } from "@claudio/core";
import type { StationPreferences } from "./station-state.js";
import { getCurrentDaypartPlan } from "./scheduler.js";
import { getConfiguredTtsProvider } from "./tts/config.js";

type EnergyMode = "calm" | "balanced" | "intense";
type WeatherTone = "rain" | "sunny" | "cloudy" | "cold" | "hot" | "windy" | "neutral";
type SceneMode = "commute" | "study" | "drive" | "workout" | "travel" | "night" | "neutral";
type LanguageMode = "chinese" | "cantonese" | "english" | "instrumental" | "mixed";
type DaypartMode = "morning" | "work" | "noon" | "afternoon" | "night" | "late-night";
type MoodBias = "focus" | "relaxed" | "emotional" | "uplifting" | "none";

export type ShowBuildOptions = {
  memoryPreferences?: StationPreferences;
};

type RankingProfile = {
  energy: EnergyMode;
  weather: WeatherTone;
  scene: SceneMode;
  language: LanguageMode;
  artistFocus: string[];
  daypart: DaypartMode;
  moodBias: MoodBias;
  favoriteArtists: string[];
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function splitArtists(input: string) {
  return input
    .split(/[,&/、]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function containsChinese(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

function containsLatin(text: string) {
  return /[a-z]/i.test(text);
}

function detectEnergy(message: string): EnergyMode {
  const text = normalize(message);
  if (
    /(安静|冷一点|柔和|深夜|凌晨|睡前|平静|舒缓|ambient|calm|quiet|soft|slow|night|midnight|sleep|chill|rain)/.test(
      text
    )
  ) {
    return "calm";
  }

  if (
    /(提神|高能|炸一点|快一点|运动|跑步|健身|派对|摇滚|电音|workout|run|dance|club|energy|hype|intense|loud|rock)/.test(
      text
    )
  ) {
    return "intense";
  }

  return "balanced";
}

function detectWeatherTone(message: string): WeatherTone {
  const text = normalize(message);
  if (/(下雨|雨天|阵雨|暴雨|雨夜|rain|storm|drizzle|shower)/.test(text)) {
    return "rain";
  }
  if (/(晴天|阳光|太阳|放晴|sun|sunny|clear)/.test(text)) {
    return "sunny";
  }
  if (/(阴天|多云|cloud|overcast)/.test(text)) {
    return "cloudy";
  }
  if (/(冷|降温|冬天|snow|cold|winter)/.test(text)) {
    return "cold";
  }
  if (/(热|炎热|闷热|夏天|heat|hot|summer)/.test(text)) {
    return "hot";
  }
  if (/(风大|起风|海风|wind|breeze)/.test(text)) {
    return "windy";
  }
  return "neutral";
}

function detectScene(message: string): SceneMode {
  const text = normalize(message);
  if (/(通勤|地铁|公交|上班|路上|commute|subway|bus|office)/.test(text)) {
    return "commute";
  }
  if (/(学习|专注|阅读|工作流|办公|study|focus|reading|work session)/.test(text)) {
    return "study";
  }
  if (/(开车|夜路|自驾|兜风|drive|car|road trip)/.test(text)) {
    return "drive";
  }
  if (/(运动|健身|跑步|训练|workout|gym|run|exercise)/.test(text)) {
    return "workout";
  }
  if (/(旅行|出差|候机|火车|trip|travel|flight|hotel|station)/.test(text)) {
    return "travel";
  }
  if (/(夜晚|深夜|凌晨|睡前|散步|night walk|late night|bed|sleep)/.test(text)) {
    return "night";
  }
  return "neutral";
}

function detectSortPreference(message: string): "artist" | "title" | "duration" | "album" | "shuffle" {
  const text = normalize(message);
  if (/(歌手|按歌手|artist|singer)/.test(text)) {
    return "artist";
  }
  if (/(歌名|标题|title|name)/.test(text)) {
    return "title";
  }
  if (/(专辑|album)/.test(text)) {
    return "album";
  }
  if (/(时长|长一点|duration|long)/.test(text)) {
    return "duration";
  }
  return "shuffle";
}

function detectLanguagePreference(message: string): LanguageMode {
  const text = normalize(message);
  if (/(华语|中文|国语|chinese)/.test(text)) {
    return "chinese";
  }
  if (/(粤语|cantonese|cantopop)/.test(text)) {
    return "cantonese";
  }
  if (/(英文|欧美|english)/.test(text)) {
    return "english";
  }
  if (/(纯音乐|器乐|配乐|instrumental|ambient score|ost)/.test(text)) {
    return "instrumental";
  }
  return "mixed";
}

function getKeywordBoost(name: string, keywords: RegExp) {
  return keywords.test(name) ? 4 : 0;
}

function detectArtistFocus(playlist: ImportedPlaylist, message: string) {
  const text = normalize(message);
  const matches = new Set<string>();

  for (const track of playlist.tracks) {
    for (const artist of splitArtists(track.artist)) {
      if (text.includes(normalize(artist))) {
        matches.add(artist);
      }
    }
  }

  return Array.from(matches).slice(0, 3);
}

function resolveSceneFromMemory(preferences?: StationPreferences): SceneMode {
  const scene = preferences?.preferredScenes[0];
  if (!scene) {
    return "neutral";
  }

  if (scene.includes("通勤")) {
    return "commute";
  }
  if (scene.includes("专注") || scene.includes("学习")) {
    return "study";
  }
  if (scene.includes("开车")) {
    return "drive";
  }
  if (scene.includes("运动")) {
    return "workout";
  }
  if (scene.includes("出行") || scene.includes("旅行")) {
    return "travel";
  }
  if (scene.includes("深夜")) {
    return "night";
  }

  return "neutral";
}

function resolveMoodBias(preferences?: StationPreferences): MoodBias {
  const mood = preferences?.preferredMoods[0] ?? "";
  if (mood.includes("专注")) {
    return "focus";
  }
  if (mood.includes("放松")) {
    return "relaxed";
  }
  if (mood.includes("低落")) {
    return "emotional";
  }
  if (mood.includes("兴奋")) {
    return "uplifting";
  }
  return "none";
}

function resolveDaypartMode(): DaypartMode {
  const nowLabel = getCurrentDaypartPlan().nowLabel;
  if (nowLabel === "清晨") {
    return "morning";
  }
  if (nowLabel === "上午") {
    return "work";
  }
  if (nowLabel === "中午") {
    return "noon";
  }
  if (nowLabel === "下午") {
    return "afternoon";
  }
  if (nowLabel === "夜晚") {
    return "night";
  }
  return "late-night";
}

function languageScore(track: ImportedPlaylist["tracks"][number], language: LanguageMode) {
  const combined = `${track.title} ${track.artist}`;

  if (language === "mixed") {
    return 0;
  }
  if (language === "instrumental") {
    return /(instrumental|inst\.?|纯音乐|钢琴|piano|ost|score)/i.test(combined) ? 5 : 0;
  }
  if (language === "english") {
    return containsLatin(combined) && !containsChinese(combined) ? 3 : 0;
  }
  if (language === "chinese") {
    return containsChinese(combined) ? 3 : 0;
  }
  if (language === "cantonese") {
    return /(粤语|cantopop|cantonese)/i.test(combined) ? 5 : 0;
  }

  return 0;
}

function daypartScore(name: string, daypart: DaypartMode) {
  if (daypart === "morning") {
    return getKeywordBoost(name, /(sun|light|day|morning|gold|clear|wake)/);
  }
  if (daypart === "work" || daypart === "afternoon") {
    return getKeywordBoost(name, /(city|drive|motion|run|line|focus|blue)/);
  }
  if (daypart === "noon") {
    return getKeywordBoost(name, /(light|summer|sun|gold|breeze|day)/);
  }
  if (daypart === "night" || daypart === "late-night") {
    return getKeywordBoost(name, /(night|moon|blue|dream|midnight|quiet|city|memory)/);
  }
  return 0;
}

function moodScore(track: ImportedPlaylist["tracks"][number], moodBias: MoodBias) {
  const combined = `${track.title} ${track.album} ${track.artist}`.toLowerCase();
  if (moodBias === "focus") {
    return getKeywordBoost(combined, /(ambient|piano|instrumental|night|blue|slow|dream)/);
  }
  if (moodBias === "relaxed") {
    return getKeywordBoost(combined, /(soft|calm|rain|quiet|moon|sleep|sea|blue)/);
  }
  if (moodBias === "emotional") {
    return getKeywordBoost(combined, /(love|memory|blue|night|heart|moon|dream)/);
  }
  if (moodBias === "uplifting") {
    return getKeywordBoost(combined, /(sun|light|fire|run|gold|dance|party|shine)/);
  }
  return 0;
}

function memoryArtistScore(track: ImportedPlaylist["tracks"][number], favoriteArtists: string[]) {
  if (!favoriteArtists.length) {
    return 0;
  }

  const trackArtists = splitArtists(track.artist).map((artist) => normalize(artist));
  if (favoriteArtists.some((artist) => trackArtists.includes(normalize(artist)))) {
    return 5.5;
  }

  return 0;
}

function scoreTrack(track: ImportedPlaylist["tracks"][number], profile: RankingProfile) {
  const name = `${track.title} ${track.album} ${track.artist}`.toLowerCase();
  const durationMinutes = track.durationMs / 60000;
  let score = Math.min(durationMinutes, 6);

  if (profile.energy === "calm") {
    score += getKeywordBoost(name, /(night|moon|quiet|sleep|rain|dream|slow|blue|memory|midnight|love)/);
    if (durationMinutes > 4.2) {
      score += 1.4;
    }
  }

  if (profile.energy === "intense") {
    score += getKeywordBoost(name, /(dance|fire|run|live|rock|party|speed|rush|wild|energy)/);
    if (durationMinutes < 4.2) {
      score += 1.4;
    }
  }

  if (profile.weather === "rain" || profile.weather === "cold") {
    score += getKeywordBoost(name, /(rain|blue|night|dream|memory|grey|winter|moon)/);
  }

  if (profile.weather === "sunny" || profile.weather === "hot") {
    score += getKeywordBoost(name, /(summer|sun|light|gold|day|beach|heat|shine)/);
  }

  if (profile.weather === "windy") {
    score += getKeywordBoost(name, /(wind|sky|road|free|drive|breeze)/);
  }

  if (profile.scene === "commute" && durationMinutes >= 3 && durationMinutes <= 4.5) {
    score += 1.5;
  }

  if (profile.scene === "study") {
    score += getKeywordBoost(name, /(ambient|sleep|night|blue|dream|slow|piano|instrumental)/);
    if (durationMinutes > 3.5) {
      score += 1;
    }
  }

  if (profile.scene === "drive" || profile.scene === "travel") {
    if (durationMinutes >= 4) {
      score += 1.5;
    }
    score += getKeywordBoost(name, /(road|city|drive|night|sky|trip|run|highway)/);
  }

  if (profile.scene === "workout") {
    if (durationMinutes < 4.2) {
      score += 1.2;
    }
    score += getKeywordBoost(name, /(run|fire|party|live|wild|speed|dance|power)/);
  }

  if (profile.scene === "night") {
    score += getKeywordBoost(name, /(night|moon|blue|dream|midnight|quiet|city)/);
  }

  if (profile.artistFocus.length > 0 && profile.artistFocus.some((artist) => track.artist.includes(artist))) {
    score += 7;
  }

  score += memoryArtistScore(track, profile.favoriteArtists);
  score += moodScore(track, profile.moodBias);
  score += daypartScore(name, profile.daypart);
  score += languageScore(track, profile.language);
  return score;
}

function buildRankingProfile(
  playlist: ImportedPlaylist,
  message: string,
  options?: ShowBuildOptions
): RankingProfile {
  const preferences = options?.memoryPreferences;
  const detectedScene = detectScene(message);
  const scene = detectedScene !== "neutral" ? detectedScene : resolveSceneFromMemory(preferences);
  const favoriteArtists = preferences?.favoriteArtists?.slice(0, 8) ?? [];

  return {
    energy: detectEnergy(message),
    weather: detectWeatherTone(message),
    scene,
    language: detectLanguagePreference(message),
    artistFocus: detectArtistFocus(playlist, message),
    daypart: resolveDaypartMode(),
    moodBias: resolveMoodBias(preferences),
    favoriteArtists
  };
}

function buildTrackQueue(playlist: ImportedPlaylist, message: string, options?: ShowBuildOptions): Track[] {
  const sortPreference = detectSortPreference(message);
  const profile = buildRankingProfile(playlist, message, options);
  const tracks = [...playlist.tracks];

  if (sortPreference === "artist") {
    tracks.sort((a, b) => a.artist.localeCompare(b.artist));
  } else if (sortPreference === "title") {
    tracks.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortPreference === "album") {
    tracks.sort((a, b) => a.album.localeCompare(b.album));
  } else if (sortPreference === "duration") {
    tracks.sort((a, b) => b.durationMs - a.durationMs);
  } else {
    tracks.sort((a, b) => scoreTrack(b, profile) - scoreTrack(a, profile));
  }

  return tracks.slice(0, 8).map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist || playlist.creator,
    mood: track.album || playlist.title,
    duration: formatDuration(track.durationMs)
  }));
}

function buildContextLine(profile: RankingProfile, preferences?: StationPreferences) {
  const parts: string[] = [];

  if (profile.weather !== "neutral") {
    parts.push(
      `天气偏向${
        profile.weather === "rain"
          ? "雨天"
          : profile.weather === "sunny"
            ? "晴朗"
            : profile.weather === "cloudy"
              ? "阴天"
              : profile.weather === "cold"
                ? "偏冷"
                : profile.weather === "hot"
                  ? "炎热"
                  : "有风"
      }`
    );
  }

  if (profile.scene !== "neutral") {
    parts.push(
      `场景偏向${
        profile.scene === "commute"
          ? "通勤"
          : profile.scene === "study"
            ? "专注"
            : profile.scene === "drive"
              ? "开车"
              : profile.scene === "workout"
                ? "运动"
                : profile.scene === "travel"
                  ? "出行"
                  : "深夜"
      }`
    );
  }

  if (profile.energy !== "balanced") {
    parts.push(profile.energy === "calm" ? "能量更收" : "能量更推");
  }

  if (preferences?.favoriteArtists?.length) {
    parts.push(`记忆优先歌手：${preferences.favoriteArtists.slice(0, 2).join(" / ")}`);
  }

  return parts.join("，");
}

function buildVibe(profile: RankingProfile) {
  const parts: string[] = [];
  if (profile.energy === "calm") {
    parts.push("收敛");
  } else if (profile.energy === "intense") {
    parts.push("推进");
  } else {
    parts.push("平衡");
  }

  if (profile.scene === "night" || profile.daypart === "late-night") {
    parts.push("夜色");
  } else if (profile.scene === "study") {
    parts.push("专注");
  } else if (profile.scene === "commute") {
    parts.push("流动");
  } else if (profile.scene === "drive") {
    parts.push("路感");
  } else {
    parts.push("私人歌单");
  }

  if (profile.weather === "rain") {
    parts.push("雨天");
  } else if (profile.weather === "sunny") {
    parts.push("晴朗");
  }

  return parts.join(" / ");
}

function buildSegmentTitle(playlist: ImportedPlaylist, profile: RankingProfile) {
  if (profile.scene === "night" || profile.daypart === "late-night") {
    return `${playlist.title} 深夜版`;
  }
  if (profile.scene === "study") {
    return `${playlist.title} 专注版`;
  }
  if (profile.scene === "commute") {
    return `${playlist.title} 通勤版`;
  }
  if (profile.scene === "drive") {
    return `${playlist.title} 开车版`;
  }
  if (profile.energy === "intense") {
    return `${playlist.title} 升温版`;
  }
  if (profile.energy === "calm") {
    return `${playlist.title} 收敛版`;
  }
  return `${playlist.title} 今日版`;
}

export function buildFallbackShow(): RadioShow {
  return {
    id: "claudio-bootstrap",
    stationName: "Claudio FM",
    segment: "等待歌单接入",
    vibe: "本地电台 / 玻璃质感 / 私人播放",
    hostLine: "当前还是占位节目。导入你的网易云或 QQ 音乐歌单后，Claudio 才能基于真实曲库开始编排。",
    narration: {
      title: "等待开台",
      text: "等歌单接入之后，我会按你的长期偏好、当前情绪和时间段，生成一条可连续播放的电台顺序。"
    },
    queue: [
      { id: "1", title: "Afterglow Drive", artist: "Mira Echo", mood: "dream-pop", duration: "03:42" },
      { id: "2", title: "Soft Receiver", artist: "Polar Youth", mood: "ambient electronica", duration: "04:11" },
      { id: "3", title: "City Under Glass", artist: "North Arcade", mood: "night indie", duration: "03:58" }
    ],
    ttsProvider: getConfiguredTtsProvider()
  };
}

export function buildShowFromPlaylist(playlist: ImportedPlaylist, options?: ShowBuildOptions): RadioShow {
  return {
    id: `${playlist.source}-${playlist.id}`,
    stationName: "Claudio FM",
    segment: `${playlist.title} 首版电台`,
    vibe: "私人歌单 / 玻璃电台 / 夜航感",
    hostLine: `已接入 ${playlist.creator} 的歌单《${playlist.title}》。当前节目会先从 ${playlist.trackCount} 首歌里抽出一条可持续播放的初始顺序。`,
    narration: {
      title: "歌单接入完成",
      text: "现在你可以继续告诉我天气、心情、行程或歌手偏好，我会在这张歌单内部持续重排。"
    },
    queue: buildTrackQueue(playlist, "", options),
    ttsProvider: getConfiguredTtsProvider()
  };
}

export function buildDirectedShowFromPlaylist(
  playlist: ImportedPlaylist,
  message: string,
  options?: ShowBuildOptions
): RadioShow {
  const profile = buildRankingProfile(playlist, message, options);
  const queue = buildTrackQueue(playlist, message, options);
  const topArtists = Array.from(
    new Set(
      queue
        .flatMap((track) => splitArtists(track.artist))
        .map((artist) => artist.trim())
        .filter(Boolean)
    )
  )
    .slice(0, 3)
    .join(" / ");
  const contextLine = buildContextLine(profile, options?.memoryPreferences);

  return {
    id: `${playlist.source}-${playlist.id}-directed`,
    stationName: "Claudio FM",
    segment: buildSegmentTitle(playlist, profile),
    vibe: buildVibe(profile),
    hostLine: `收到你的指令“${message}”。Claudio 正围绕 ${topArtists || playlist.creator} 重新整理《${playlist.title}》的这一刻版本。`,
    narration: {
      title: "电台已重排",
      text: `这一版会更偏向${
        profile.energy === "calm"
          ? "收敛、克制、适合慢慢听"
          : profile.energy === "intense"
            ? "推进、提神、适合往前走"
            : "平衡、自然、贴近你原始歌单的味道"
      }。${contextLine ? `同时会参考${contextLine}。` : ""}`
    },
    queue,
    ttsProvider: getConfiguredTtsProvider()
  };
}
