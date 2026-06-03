import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outDir = join(repoRoot, "output", "diagrams");

const size = { width: 2200, height: 1400 };

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textLines(lines, x, y, width, lineHeight = 29) {
  return lines
    .map((line, index) => {
      const bullet = line.startsWith("-") ? "" : "• ";
      return `<text x="${x}" y="${y + index * lineHeight}" class="body" textLength="${Math.min(width, Math.max(0, (bullet + line).length * 18))}" lengthAdjust="spacingAndGlyphs">${esc(bullet + line)}</text>`;
    })
    .join("\n");
}

function box({ x, y, w, h, title, lines, accent = "#46a6ff" }) {
  return `
    <g class="box">
      <rect x="${x + 10}" y="${y + 14}" width="${w}" height="${h}" rx="30" class="shadow"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" class="panel"/>
      <rect x="${x + 20}" y="${y + 24}" width="9" height="${h - 48}" rx="5" fill="${accent}"/>
      <text x="${x + 46}" y="${y + 54}" class="box-title">${esc(title)}</text>
      ${textLines(lines, x + 48, y + 98, w - 80)}
    </g>
  `;
}

function arrow(x1, y1, x2, y2, label = "") {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 14;
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="arrow"/>
    ${label ? `<text x="${mx}" y="${my}" class="edge-label" text-anchor="middle">${esc(label)}</text>` : ""}
  `;
}

function html(title, subtitle, content, height = size.height) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    html, body {
      margin: 0;
      width: ${size.width}px;
      height: ${height}px;
      overflow: hidden;
      background: #081222;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    svg {
      display: block;
      width: ${size.width}px;
      height: ${height}px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 80px),
        linear-gradient(45deg, #07111f 0%, #132238 52%, #0c182a 100%);
    }
    .title {
      fill: #f7fbff;
      font-size: 48px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .subtitle {
      fill: rgba(220, 232, 248, 0.78);
      font-size: 24px;
      letter-spacing: 0;
    }
    .panel {
      fill: rgba(248, 250, 255, 0.92);
      stroke: rgba(255, 255, 255, 0.76);
      stroke-width: 2;
      filter: url(#glass);
    }
    .shadow {
      fill: rgba(0, 0, 0, 0.28);
      filter: blur(10px);
    }
    .box-title {
      fill: #0d2035;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .body {
      fill: rgba(36, 50, 69, 0.95);
      font-size: 20px;
      letter-spacing: 0;
    }
    .arrow {
      stroke: rgba(153, 191, 235, 0.85);
      stroke-width: 6;
      stroke-linecap: round;
      marker-end: url(#arrow);
    }
    .edge-label {
      fill: rgba(226, 236, 250, 0.92);
      font-size: 19px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .chip {
      fill: rgba(255, 255, 255, 0.12);
      stroke: rgba(255, 255, 255, 0.18);
      stroke-width: 1;
    }
    .chip-text {
      fill: rgba(232, 240, 252, 0.9);
      font-size: 18px;
      font-weight: 700;
    }
  </style>
</head>
<body>
<svg viewBox="0 0 ${size.width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glass" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000000" flood-opacity="0.22"/>
    </filter>
    <marker id="arrow" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto">
      <path d="M 0 0 L 14 7 L 0 14 z" fill="rgba(153, 191, 235, 0.9)"/>
    </marker>
  </defs>
  <text x="100" y="92" class="title">${esc(title)}</text>
  <text x="104" y="140" class="subtitle">${esc(subtitle)}</text>
  ${content}
</svg>
</body>
</html>`;
}

const architecture = html(
  "Claudio AI DJ 系统架构",
  "本地优先：桌面壳、后端代理、真实歌曲流、LLM 推荐、IndexTTS2 口播",
  `
  ${box({ x: 120, y: 250, w: 420, h: 230, title: "用户与桌面壳", accent: "#55a7ff", lines: ["Claudio.exe 一键启动", "设置、凭据、音色面板", "播放器 / 聊天 / 歌单选择"] })}
  ${box({ x: 660, y: 250, w: 420, h: 230, title: "React 前端 UI", accent: "#24c7d9", lines: ["毛玻璃 Apple 风界面", "真实 audio 播放控件", "天气、心情、行程输入"] })}
  ${box({ x: 1200, y: 250, w: 420, h: 230, title: "Fastify 本地后端", accent: "#23be80", lines: ["电台会话与队列", "播放解析与失败跳过", "安全代理远端音频流"] })}
  ${box({ x: 1660, y: 210, w: 420, h: 190, title: "本地数据目录", accent: "#f59a44", lines: ["歌单 JSON / 设置", "Cookie 与平台凭据", "音色库 / 短时缓存"] })}
  ${box({ x: 420, y: 720, w: 430, h: 230, title: "音乐平台解析", accent: "#e95b7b", lines: ["网易云 Enhanced 取链", "QQ Music songMid/vkey", "跨平台补链与自动跳过"] })}
  ${box({ x: 960, y: 720, w: 430, h: 230, title: "AI 编排层", accent: "#55a7ff", lines: ["DeepSeek / Ollama", "天气 + 心情 + 行程", "生成 DJ 口播与推荐理由"] })}
  ${box({ x: 1500, y: 720, w: 430, h: 230, title: "TTS 声音层", accent: "#24c7d9", lines: ["IndexTTS2 本地服务", "自定义参考音色", "WebSpeech 兜底"] })}
  ${box({ x: 660, y: 1080, w: 880, h: 190, title: "输出体验", accent: "#23be80", lines: ["用户直接选歌、切歌、暂停、拖动进度", "AI DJ 可聊天，并根据当天场景重排节目单", "浏览器网络面板只看到 127.0.0.1 本地代理请求"] })}
  ${arrow(540, 365, 660, 365, "本机 UI")}
  ${arrow(1080, 365, 1200, 365, "API")}
  ${arrow(1620, 365, 1660, 320, "安全读写")}
  ${arrow(1410, 480, 780, 720)}
  ${arrow(1410, 480, 1175, 720)}
  ${arrow(1410, 480, 1715, 720)}
  ${arrow(635, 950, 830, 1080)}
  ${arrow(1175, 950, 1100, 1080)}
  ${arrow(1715, 950, 1370, 1080)}
  <rect x="1690" y="430" width="320" height="46" rx="23" class="chip"/>
  <text x="1850" y="460" text-anchor="middle" class="chip-text">密钥与 Cookie 不暴露给前端</text>
  `
);

const playback = html(
  "Claudio AI DJ 推荐与播放流程",
  "从场景理解到真实歌曲播放：先保证可播，再做口播与个性化编排",
  `
  ${box({ x: 110, y: 240, w: 360, h: 180, title: "1. 收集上下文", accent: "#55a7ff", lines: ["天气城市", "心情描述", "今日行程"] })}
  ${box({ x: 570, y: 240, w: 360, h: 180, title: "2. 读取偏好", accent: "#24c7d9", lines: ["网易云 / QQ 歌单", "歌手、年代、风格画像", "最近选择与跳过记录"] })}
  ${box({ x: 1030, y: 240, w: 410, h: 180, title: "3. AI 编排", accent: "#23be80", lines: ["LLM 生成节目主题", "推荐候选歌曲", "生成 DJ 串词"] })}
  ${box({ x: 1540, y: 240, w: 420, h: 180, title: "4. 生成播放队列", accent: "#f59a44", lines: ["优先用户已导入歌曲", "按情境排序", "预解析当前 + 后 2 首"] })}
  ${box({ x: 230, y: 610, w: 410, h: 190, title: "5. 原平台取链", accent: "#e95b7b", lines: ["网易云原生 URL", "QQ vkey / purl", "携带本地平台凭据"] })}
  ${box({ x: 790, y: 610, w: 410, h: 190, title: "6. 可播判断", accent: "#55a7ff", lines: ["URL 有效", "不是试听片段", "状态 ready / failed"] })}
  ${box({ x: 1350, y: 610, w: 410, h: 190, title: "7. 后端音频代理", accent: "#23be80", lines: ["隐藏远端直链", "转发音频流", "短时缓存 15 分钟"] })}
  ${box({ x: 230, y: 1000, w: 410, h: 190, title: "失败分支", accent: "#f59a44", lines: ["跨平台精确补链", "歌名 + 主歌手 + 时长容差", "仍失败则自动跳过"] })}
  ${box({ x: 790, y: 1000, w: 410, h: 190, title: "前端真实播放", accent: "#24c7d9", lines: ["<audio> 是进度真源", "暂停 / 拖动 / 下一首", "ended/error 回传后端"] })}
  ${box({ x: 1350, y: 1000, w: 410, h: 190, title: "AI DJ 交互", accent: "#e95b7b", lines: ["聊天请求改节目单", "IndexTTS2 生成口播", "根据反馈继续重排"] })}
  ${box({ x: 790, y: 1255, w: 410, h: 140, title: "持续循环", accent: "#23be80", lines: ["播放事件同步", "预取下一首", "更新用户偏好"] })}
  ${arrow(470, 330, 570, 330)}
  ${arrow(930, 330, 1030, 330)}
  ${arrow(1440, 330, 1540, 330)}
  ${arrow(1750, 420, 445, 610)}
  ${arrow(640, 705, 790, 705)}
  ${arrow(1200, 705, 1350, 705, "成功")}
  ${arrow(995, 800, 435, 1000, "失败")}
  ${arrow(640, 1095, 790, 1095)}
  ${arrow(1200, 1095, 1350, 1095)}
  ${arrow(995, 1190, 995, 1255)}
  ${arrow(1200, 1325, 1580, 420, "下一轮")}
  `
);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "claudio-system-architecture.html"), architecture, "utf8");
await writeFile(join(outDir, "claudio-ai-dj-playback-flow.html"), playback, "utf8");

console.log(join(outDir, "claudio-system-architecture.html"));
console.log(join(outDir, "claudio-ai-dj-playback-flow.html"));
