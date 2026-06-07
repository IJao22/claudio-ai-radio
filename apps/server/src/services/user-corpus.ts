import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportedPlaylist } from "@claudio/core";
import { getAllImportedPlaylists } from "./music/library-store.ts";
import { getCorpusDirPath } from "./storage-paths.ts";

type CorpusFileKey = "taste" | "routines" | "mood-rules";

export type UserCorpus = {
  tasteMarkdown: string;
  routinesMarkdown: string;
  moodRulesMarkdown: string;
  playlistsDigest: string;
  sourceFiles: Record<CorpusFileKey | "playlists", string>;
};

export type UserCorpusUpdateInput = {
  tasteMarkdown?: string;
  routinesMarkdown?: string;
  moodRulesMarkdown?: string;
};

const corpusDir = getCorpusDirPath();
const corpusFiles: Record<CorpusFileKey, { fileName: string; defaultContent: string }> = {
  taste: {
    fileName: "taste.md",
    defaultContent: `# Taste

- 这里记录用户长期稳定的听感偏好。
- 建议写法：喜欢的歌手、语言、年代、编曲密度、偏爱夜晚还是白天、是否偏爱人声或器乐。
- 现在先由系统自动生成摘要，后续可以手动补充。
`
  },
  routines: {
    fileName: "routines.md",
    defaultContent: `# Routines

- 这里记录用户的长期节律。
- 建议写法：通勤时间、工作时段、深夜时段、周末与工作日差异、运动时间。
- 这会成为 Claudio 做日程化推荐的基础。
`
  },
  "mood-rules": {
    fileName: "mood-rules.md",
    defaultContent: `# Mood Rules

- 这里记录心情到音乐编排的映射规则。
- 建议写法：低落时更克制、通勤时更紧凑、深夜时减少高频强刺激、运动时提高推进感。
- 这部分会直接进入 Claudio 的上下文窗口。
`
  }
};

function getCorpusFilePath(fileName: string) {
  return join(corpusDir, fileName);
}

async function ensureCorpusDir() {
  await mkdir(corpusDir, { recursive: true });
}

async function ensureCorpusFile(key: CorpusFileKey) {
  const config = corpusFiles[key];
  const filePath = getCorpusFilePath(config.fileName);
  try {
    return await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, config.defaultContent, "utf8");
    return config.defaultContent;
  }
}

function buildPlaylistDigest(playlists: ImportedPlaylist[]) {
  if (!playlists.length) {
    return [
      "# playlists.json digest",
      "",
      "- 还没有导入真实歌单。",
      "- 导入网易云或 QQ 音乐后，这里会自动生成摘要供 Claudio 使用。"
    ].join("\n");
  }

  const lines = ["# playlists.json digest", ""];

  for (const playlist of playlists.slice(0, 12)) {
    const topArtists = Array.from(
      new Set(
        playlist.tracks
          .flatMap((track) => track.artist.split(/[,&/、]/))
          .map((artist) => artist.trim())
          .filter(Boolean)
      )
    )
      .slice(0, 6)
      .join(" / ");

    lines.push(
      `- ${playlist.title} (${playlist.source})`,
      `  - creator: ${playlist.creator}`,
      `  - trackCount: ${playlist.trackCount}`,
      `  - topArtists: ${topArtists || "unknown"}`
    );
  }

  return lines.join("\n");
}

async function writeCorpusFile(key: CorpusFileKey, content: string) {
  const config = corpusFiles[key];
  const filePath = getCorpusFilePath(config.fileName);
  await writeFile(filePath, content.trim() ? content : config.defaultContent, "utf8");
}

export async function getUserCorpus(): Promise<UserCorpus> {
  await ensureCorpusDir();

  const [tasteMarkdown, routinesMarkdown, moodRulesMarkdown, playlists] = await Promise.all([
    ensureCorpusFile("taste"),
    ensureCorpusFile("routines"),
    ensureCorpusFile("mood-rules"),
    getAllImportedPlaylists()
  ]);

  return {
    tasteMarkdown,
    routinesMarkdown,
    moodRulesMarkdown,
    playlistsDigest: buildPlaylistDigest(playlists),
    sourceFiles: {
      taste: getCorpusFilePath(corpusFiles.taste.fileName),
      routines: getCorpusFilePath(corpusFiles.routines.fileName),
      "mood-rules": getCorpusFilePath(corpusFiles["mood-rules"].fileName),
      playlists: join(corpusDir, "playlists.generated.md")
    }
  };
}

export async function saveUserCorpus(input: UserCorpusUpdateInput) {
  await ensureCorpusDir();

  const writes: Promise<void>[] = [];
  if (input.tasteMarkdown !== undefined) {
    writes.push(writeCorpusFile("taste", input.tasteMarkdown));
  }
  if (input.routinesMarkdown !== undefined) {
    writes.push(writeCorpusFile("routines", input.routinesMarkdown));
  }
  if (input.moodRulesMarkdown !== undefined) {
    writes.push(writeCorpusFile("mood-rules", input.moodRulesMarkdown));
  }

  await Promise.all(writes);
  return getUserCorpus();
}
