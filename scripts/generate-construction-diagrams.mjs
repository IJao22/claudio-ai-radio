import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outDir = join(repoRoot, "output", "diagrams");
const width = 2200;
const height = 1400;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lineText(lines, x, y, size = 18, gap = 26, cls = "mini") {
  return lines
    .map((line, i) => `<text x="${x}" y="${y + i * gap}" class="${cls}" style="font-size:${size}px">${esc(line)}</text>`)
    .join("\n");
}

function node({ x, y, w, h, title, code = "", accent = "#48a5ff", muted = [] }) {
  return `
    <g>
      <rect x="${x + 10}" y="${y + 14}" width="${w}" height="${h}" rx="18" class="shadow"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" class="node"/>
      <rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${accent}"/>
      <text x="${x + 28}" y="${y + 38}" class="node-title">${esc(title)}</text>
      ${code ? `<text x="${x + 28}" y="${y + 72}" class="code">${esc(code)}</text>` : ""}
      ${lineText(muted, x + 28, y + 104, 17, 25, "mini")}
    </g>
  `;
}

function zone({ x, y, w, h, title, accent = "#ffffff22" }) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" fill="${accent}" stroke="rgba(255,255,255,.14)" stroke-width="2"/>
      <text x="${x + 28}" y="${y + 42}" class="zone-title">${esc(title)}</text>
    </g>
  `;
}

function arrow(x1, y1, x2, y2, label = "", dashed = false) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 12;
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${dashed ? "arrow dashed" : "arrow"}"/>
    ${label ? `<text x="${mx}" y="${my}" class="arrow-label" text-anchor="middle">${esc(label)}</text>` : ""}
  `;
}

function db({ x, y, w, h, title, lines, accent = "#f4a442" }) {
  return `
    <g>
      <ellipse cx="${x + w / 2}" cy="${y + 24}" rx="${w / 2}" ry="24" class="store-top"/>
      <rect x="${x}" y="${y + 24}" width="${w}" height="${h - 48}" class="store-body"/>
      <ellipse cx="${x + w / 2}" cy="${y + h - 24}" rx="${w / 2}" ry="24" class="store-bottom"/>
      <path d="M ${x} ${y + 24} L ${x} ${y + h - 24}" stroke="rgba(255,255,255,.36)" stroke-width="2"/>
      <path d="M ${x + w} ${y + 24} L ${x + w} ${y + h - 24}" stroke="rgba(255,255,255,.36)" stroke-width="2"/>
      <rect x="${x + 14}" y="${y + 54}" width="8" height="${h - 88}" rx="4" fill="${accent}"/>
      <text x="${x + 38}" y="${y + 72}" class="node-title">${esc(title)}</text>
      ${lineText(lines, x + 38, y + 104, 17, 25, "mini")}
    </g>
  `;
}

function baseHtml(title, subtitle, content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #05070a;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    svg {
      width: ${width}px;
      height: ${height}px;
      display: block;
      background:
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(0deg, rgba(255,255,255,.026) 1px, transparent 1px),
        radial-gradient(circle at 50% 20%, rgba(44,90,140,.24), transparent 34%),
        #05070a;
      background-size: 80px 80px, 80px 80px, auto, auto;
    }
    .title { fill: #f4f7fb; font-size: 42px; font-weight: 800; letter-spacing: 0; }
    .subtitle { fill: rgba(221,232,246,.62); font-size: 20px; letter-spacing: 0; }
    .zone-title { fill: rgba(240,246,255,.72); font-size: 22px; font-weight: 800; letter-spacing: 0; }
    .node {
      fill: rgba(17,24,34,.92);
      stroke: rgba(178,205,240,.22);
      stroke-width: 2;
    }
    .shadow { fill: rgba(0,0,0,.34); filter: blur(12px); }
    .node-title { fill: #eef6ff; font-size: 24px; font-weight: 800; letter-spacing: 0; }
    .code {
      fill: #9ed1ff;
      font-family: "Cascadia Mono", "Consolas", monospace;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .mini {
      fill: rgba(229,238,248,.76);
      font-size: 17px;
      font-family: "Cascadia Mono", "Microsoft YaHei UI", monospace;
      letter-spacing: 0;
    }
    .arrow {
      stroke: rgba(144,187,238,.82);
      stroke-width: 5;
      stroke-linecap: round;
      marker-end: url(#arrow);
    }
    .dashed { stroke-dasharray: 12 12; }
    .arrow-label {
      fill: rgba(230,240,255,.86);
      font-size: 17px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .store-top, .store-bottom { fill: rgba(24,32,42,.96); stroke: rgba(255,255,255,.28); stroke-width: 2; }
    .store-body { fill: rgba(24,32,42,.96); }
    .badge { fill: rgba(255,255,255,.08); stroke: rgba(255,255,255,.18); stroke-width: 1; }
    .badge-text { fill: rgba(240,246,255,.82); font-size: 16px; font-weight: 800; }
  </style>
</head>
<body>
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="blur"><feGaussianBlur stdDeviation="8"/></filter>
    <marker id="arrow" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto">
      <path d="M0,0 L14,7 L0,14 Z" fill="rgba(144,187,238,.9)"/>
    </marker>
  </defs>
  <text x="92" y="82" class="title">${esc(title)}</text>
  <text x="96" y="120" class="subtitle">${esc(subtitle)}</text>
  ${content}
</svg>
</body>
</html>`;
}

const buildMap = baseHtml(
  "Claudio Construction Map",
  "implementation blueprint / minimal text / local-first",
  `
  ${zone({ x: 80, y: 170, w: 2040, h: 260, title: "01 INPUT / CLIENT" })}
  ${zone({ x: 80, y: 475, w: 2040, h: 330, title: "02 LOCAL SERVICES" })}
  ${zone({ x: 80, y: 850, w: 2040, h: 310, title: "03 DATA + EXTERNAL" })}
  ${zone({ x: 80, y: 1195, w: 2040, h: 145, title: "04 OUTPUT" })}

  ${node({ x: 150, y: 235, w: 330, h: 145, title: "Desktop Shell", code: "Claudio.exe", accent: "#5aa9ff", muted: ["Electron", "auto start services"] })}
  ${node({ x: 570, y: 235, w: 330, h: 145, title: "Web UI", code: "apps/web", accent: "#25c9d8", muted: ["player", "chat", "settings"] })}
  ${node({ x: 990, y: 235, w: 330, h: 145, title: "User Signals", code: "weather+mood+plan", accent: "#37c884", muted: ["city", "mood", "schedule"] })}
  ${node({ x: 1410, y: 235, w: 330, h: 145, title: "Music Library", code: "playlist imports", accent: "#f2a24b", muted: ["netease", "qq music"] })}

  ${node({ x: 150, y: 555, w: 330, h: 160, title: "API Server", code: "127.0.0.1:8787", accent: "#37c884", muted: ["Fastify", "session queue"] })}
  ${node({ x: 570, y: 555, w: 330, h: 160, title: "Resolver", code: "music/resolvers", accent: "#e95d7e", muted: ["native url", "skip failed"] })}
  ${node({ x: 990, y: 555, w: 330, h: 160, title: "LLM Adapter", code: "DeepSeek / Ollama", accent: "#5aa9ff", muted: ["chat", "show plan"] })}
  ${node({ x: 1410, y: 555, w: 330, h: 160, title: "TTS Service", code: "127.0.0.1:8011", accent: "#25c9d8", muted: ["IndexTTS2", "voice clone"] })}
  ${node({ x: 1830, y: 555, w: 210, h: 160, title: "Proxy", code: "/stream", accent: "#f2a24b", muted: ["hide url", "audio pipe"] })}

  ${db({ x: 190, y: 920, w: 260, h: 150, title: "data/config", accent: "#f2a24b", lines: ["settings", "cookies", "voices"] })}
  ${db({ x: 555, y: 920, w: 260, h: 150, title: "data/imports", accent: "#37c884", lines: ["playlists", "tracks", "metadata"] })}
  ${node({ x: 920, y: 925, w: 310, h: 145, title: "Netease", code: "Enhanced API", accent: "#e95d7e", muted: ["song url", "unblock"] })}
  ${node({ x: 1320, y: 925, w: 310, h: 145, title: "QQ Music", code: "songMid/vkey", accent: "#5aa9ff", muted: ["purl", "fallback"] })}
  ${db({ x: 1720, y: 920, w: 260, h: 150, title: "cache", accent: "#25c9d8", lines: ["15 min", "audio url", "tts mp3"] })}

  ${node({ x: 400, y: 1230, w: 360, h: 80, title: "Real Audio Player", code: "<audio>", accent: "#25c9d8" })}
  ${node({ x: 920, y: 1230, w: 360, h: 80, title: "AI DJ Chat", code: "/api/chat", accent: "#5aa9ff" })}
  ${node({ x: 1440, y: 1230, w: 360, h: 80, title: "Show Update", code: "queue + narration", accent: "#37c884" })}

  ${arrow(480, 307, 570, 307)}
  ${arrow(900, 307, 990, 307)}
  ${arrow(1320, 307, 1410, 307)}
  ${arrow(315, 380, 315, 555)}
  ${arrow(735, 380, 315, 555)}
  ${arrow(1155, 380, 1155, 555)}
  ${arrow(1575, 380, 735, 555)}
  ${arrow(480, 635, 570, 635)}
  ${arrow(900, 635, 990, 635)}
  ${arrow(1320, 635, 1410, 635)}
  ${arrow(1740, 635, 1830, 635)}
  ${arrow(315, 715, 320, 920, "rw")}
  ${arrow(735, 715, 685, 920, "rw")}
  ${arrow(735, 715, 1075, 925, "url")}
  ${arrow(735, 715, 1475, 925, "url")}
  ${arrow(1935, 715, 1850, 920, "cache")}
  ${arrow(1935, 715, 580, 1230, "audio")}
  ${arrow(1155, 715, 1100, 1230, "chat")}
  ${arrow(1575, 715, 1620, 1230, "voice")}
  `
);

const runtimeMap = baseHtml(
  "Claudio Runtime Wiring",
  "event flow / ports / endpoints / failure path",
  `
  ${zone({ x: 90, y: 170, w: 2020, h: 190, title: "BOOT" })}
  ${zone({ x: 90, y: 410, w: 2020, h: 310, title: "SESSION" })}
  ${zone({ x: 90, y: 770, w: 2020, h: 310, title: "PLAYBACK" })}
  ${zone({ x: 90, y: 1130, w: 2020, h: 210, title: "FEEDBACK LOOP" })}

  ${node({ x: 160, y: 220, w: 310, h: 105, title: "Electron", code: "main.mjs", accent: "#5aa9ff", muted: ["seed data"] })}
  ${node({ x: 570, y: 220, w: 310, h: 105, title: "Fastify", code: ":8787", accent: "#37c884", muted: ["API ready"] })}
  ${node({ x: 980, y: 220, w: 310, h: 105, title: "IndexTTS2", code: ":8011", accent: "#25c9d8", muted: ["voice ready"] })}
  ${db({ x: 1420, y: 205, w: 260, h: 130, title: "userData", accent: "#f2a24b", lines: ["config", "imports"] })}

  ${node({ x: 150, y: 485, w: 300, h: 150, title: "GET", code: "/api/session", accent: "#5aa9ff", muted: ["current", "queue"] })}
  ${node({ x: 530, y: 485, w: 300, h: 150, title: "POST", code: "/api/chat", accent: "#5aa9ff", muted: ["mood", "intent"] })}
  ${node({ x: 910, y: 485, w: 300, h: 150, title: "POST", code: "/api/show/update", accent: "#37c884", muted: ["plan", "say"] })}
  ${node({ x: 1290, y: 485, w: 300, h: 150, title: "POST", code: "/api/radio/control", accent: "#f2a24b", muted: ["play", "pause", "next"] })}
  ${node({ x: 1670, y: 485, w: 300, h: 150, title: "POST", code: "/api/playback/sync", accent: "#25c9d8", muted: ["time", "state"] })}

  ${node({ x: 150, y: 845, w: 300, h: 150, title: "Resolve", code: "track url", accent: "#e95d7e", muted: ["native first"] })}
  ${node({ x: 530, y: 845, w: 300, h: 150, title: "Validate", code: "ready/failed", accent: "#f2a24b", muted: ["no preview"] })}
  ${node({ x: 910, y: 845, w: 300, h: 150, title: "Stream", code: "/api/audio/stream", accent: "#37c884", muted: ["proxy"] })}
  ${node({ x: 1290, y: 845, w: 300, h: 150, title: "Audio", code: "<audio>", accent: "#25c9d8", muted: ["progress source"] })}
  ${node({ x: 1670, y: 845, w: 300, h: 150, title: "Skip", code: "next playable", accent: "#e95d7e", muted: ["auto"] })}

  ${node({ x: 270, y: 1190, w: 330, h: 100, title: "Telemetry", code: "play / seek / error", accent: "#25c9d8" })}
  ${node({ x: 760, y: 1190, w: 330, h: 100, title: "Preference", code: "likes / skips", accent: "#37c884" })}
  ${node({ x: 1250, y: 1190, w: 330, h: 100, title: "Re-rank", code: "weather + mood + history", accent: "#5aa9ff" })}
  ${node({ x: 1710, y: 1190, w: 250, h: 100, title: "Prefetch", code: "+2 tracks", accent: "#f2a24b" })}

  ${arrow(470, 272, 570, 272)}
  ${arrow(880, 272, 980, 272)}
  ${arrow(1290, 272, 1420, 272)}
  ${arrow(300, 635, 300, 845)}
  ${arrow(1060, 635, 300, 845)}
  ${arrow(1440, 635, 1440, 845)}
  ${arrow(1820, 635, 1820, 845)}
  ${arrow(450, 920, 530, 920)}
  ${arrow(830, 920, 910, 920)}
  ${arrow(1210, 920, 1290, 920)}
  ${arrow(1590, 920, 1670, 920, "error")}
  ${arrow(1440, 995, 435, 1190, "events")}
  ${arrow(600, 1240, 760, 1240)}
  ${arrow(1090, 1240, 1250, 1240)}
  ${arrow(1580, 1240, 1710, 1240)}
  ${arrow(1835, 1190, 1060, 635, "next plan", true)}
  `
);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "claudio-construction-map.html"), buildMap, "utf8");
await writeFile(join(outDir, "claudio-runtime-wiring.html"), runtimeMap, "utf8");
console.log(join(outDir, "claudio-construction-map.html"));
console.log(join(outDir, "claudio-runtime-wiring.html"));
