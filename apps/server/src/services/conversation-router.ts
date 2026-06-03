import type { ChatConversationIntent, ChatStationContext, ChatSuggestion, ImportedPlaylist } from "@claudio/core";

export type RoutedConversation = {
  intent: ChatConversationIntent;
  context: ChatStationContext;
  contextSummary?: string;
};

const tunePatterns =
  /(推荐|重排|重编|重新排|调成|调整|切到|切成|换成|来点|想听|排序|优先|更冷一点|更热一点|更安静|更炸|更适合|switch|change|recommend|reorder)/iu;
const explainPatterns = /(为什么|为何|怎么排|解释一下|讲讲这一版|why|explain)/iu;
const pickPatterns = /(点歌|来一首|播一首|播放|切到这首|pick|play)/iu;
const contextPatterns =
  /(天气|心情|通勤|学习|工作|开车|运动|旅行|深夜|下雨|晴天|阴天|mood|weather|commute|study|work|drive|workout|travel)/iu;

function splitArtists(input: string) {
  return input
    .split(/[,&/、]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function detectMood(message: string) {
  if (/(emo|难过|伤心|低落|down|sad)/i.test(message)) {
    return "低落";
  }
  if (/(开心|兴奋|高兴|上头|happy|excited)/i.test(message)) {
    return "兴奋";
  }
  if (/(松弛|放空|想躺|轻松|relax|loose)/i.test(message)) {
    return "放松";
  }
  if (/(专注|沉浸|focus|study)/i.test(message)) {
    return "专注";
  }
  return undefined;
}

function detectEnergy(message: string): ChatStationContext["energy"] {
  if (/(安静|柔和|慢一点|舒缓|soft|calm|slow|quiet)/i.test(message)) {
    return "calm";
  }
  if (/(炸一点|提神|高能|快一点|冲一把|energy|hype|intense)/i.test(message)) {
    return "intense";
  }
  return "balanced";
}

function detectScene(message: string) {
  if (/(通勤|地铁|公交|上班|commute|subway|bus)/i.test(message)) {
    return "通勤";
  }
  if (/(学习|专注|读书|工作|study|focus|work)/i.test(message)) {
    return "专注";
  }
  if (/(开车|自驾|夜路|drive|car)/i.test(message)) {
    return "开车";
  }
  if (/(运动|健身|跑步|workout|gym|run)/i.test(message)) {
    return "运动";
  }
  if (/(旅行|出差|候机|travel|trip|flight)/i.test(message)) {
    return "出行";
  }
  if (/(深夜|凌晨|睡前|night|midnight|sleep)/i.test(message)) {
    return "深夜";
  }
  return undefined;
}

function detectWeather(message: string, weatherSummary?: string) {
  if (/(下雨|雨天|阵雨|rain|storm)/i.test(message)) {
    return "雨天";
  }
  if (/(晴天|阳光|太阳|sunny|clear)/i.test(message)) {
    return "晴天";
  }
  if (/(阴天|多云|cloud|overcast)/i.test(message)) {
    return "阴天";
  }
  if (/(热|炎热|闷热|hot|heat)/i.test(message)) {
    return "炎热";
  }
  if (/(冷|降温|cold)/i.test(message)) {
    return "偏冷";
  }

  if (weatherSummary?.includes("雨")) {
    return "雨天";
  }
  if (weatherSummary?.includes("晴")) {
    return "晴天";
  }
  if (weatherSummary?.includes("阴") || weatherSummary?.includes("云")) {
    return "阴天";
  }

  return undefined;
}

function detectArtistFocus(playlist: ImportedPlaylist | null, message: string) {
  if (!playlist) {
    return [];
  }

  const lower = message.toLowerCase();
  const matches = new Set<string>();
  for (const track of playlist.tracks) {
    for (const artist of splitArtists(track.artist)) {
      if (lower.includes(artist.toLowerCase())) {
        matches.add(artist);
      }
    }
  }

  return Array.from(matches).slice(0, 3);
}

export function inferConversationIntent(message: string): ChatConversationIntent {
  if (explainPatterns.test(message)) {
    return "explain_mix";
  }
  if (tunePatterns.test(message)) {
    return "tune_station";
  }
  if (pickPatterns.test(message)) {
    return "pick_music";
  }
  if (contextPatterns.test(message)) {
    return "context_update";
  }
  return "chat";
}

export function routeConversation(
  message: string,
  playlist: ImportedPlaylist | null,
  weatherSummary?: string
): RoutedConversation {
  const context: ChatStationContext = {
    energy: detectEnergy(message),
    scene: detectScene(message),
    weather: detectWeather(message, weatherSummary),
    mood: detectMood(message),
    artistFocus: detectArtistFocus(playlist, message)
  };

  const parts: string[] = [];
  if (context.weather) {
    parts.push(`天气：${context.weather}`);
  } else if (weatherSummary) {
    parts.push(`天气参考：${weatherSummary}`);
  }
  if (context.scene) {
    parts.push(`场景：${context.scene}`);
  }
  if (context.mood) {
    parts.push(`心情：${context.mood}`);
  }
  if (context.energy && context.energy !== "balanced") {
    parts.push(`能量：${context.energy === "calm" ? "收敛" : "推进"}`);
  }
  if (context.artistFocus?.length) {
    parts.push(`歌手偏好：${context.artistFocus.join(" / ")}`);
  }

  return {
    intent: inferConversationIntent(message),
    context,
    contextSummary: parts.join(" · ") || undefined
  };
}

export function buildSuggestionSet(
  playlist: ImportedPlaylist | null,
  routed: RoutedConversation,
  showUpdated: boolean
): ChatSuggestion[] {
  if (!playlist) {
    return [
      {
        id: "import-playlist",
        label: "先导入歌单",
        prompt: "等我导入歌单后，再按天气和心情帮我排一版。",
        kind: "chat"
      }
    ];
  }

  const suggestions: ChatSuggestion[] = [
    {
      id: "commute-mix",
      label: "切到通勤版",
      prompt: "切一版更适合通勤路上的顺序。",
      kind: "scene"
    },
    {
      id: "night-mix",
      label: "切到深夜版",
      prompt: "把这一版调成更适合深夜独处的感觉。",
      kind: "mood"
    },
    {
      id: "focus-mix",
      label: "切到专注版",
      prompt: "帮我做一版更适合学习和专注工作的顺序。",
      kind: "scene"
    },
    {
      id: "explain-mix",
      label: "解释这版逻辑",
      prompt: "解释一下你为什么这样排前几首歌。",
      kind: "queue"
    }
  ];

  if (routed.context.weather) {
    suggestions.unshift({
      id: "weather-remix",
      label: "按天气重排",
      prompt: "根据今天天气，帮我重排成更贴合现在状态的一版。",
      kind: "weather"
    });
  }

  const artist = routed.context.artistFocus?.[0];
  if (artist) {
    suggestions.push({
      id: "artist-hold",
      label: `保留 ${artist}`,
      prompt: `继续保留 ${artist} 的优先级，但整体再克制一点。`,
      kind: "artist"
    });
  }

  if (showUpdated) {
    suggestions.push({
      id: "more-calm",
      label: "再收一点",
      prompt: "在刚才这版基础上再收一点，减少太外放的歌。",
      kind: "mood"
    });
  }

  return suggestions.slice(0, 5);
}
