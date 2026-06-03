from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "claudio-architecture.jpg"

WIDTH = 2400
HEIGHT = 1600
BG = "#0B1020"
PANEL = "#121A30"
PANEL_ALT = "#16213D"
TEXT = "#F5F7FB"
SUBTEXT = "#A5B3D9"
LINE = "#6AC6FF"
ACCENT = "#7DE0C1"
ACCENT_2 = "#F4B860"


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        ("C:/Windows/Fonts/msyhbd.ttc", bold),
        ("C:/Windows/Fonts/msyh.ttc", False),
        ("C:/Windows/Fonts/segoeuib.ttf", bold),
        ("C:/Windows/Fonts/segoeui.ttf", False),
    ]
    for path, is_bold in candidates:
        if bold and not is_bold:
            continue
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    for path, _ in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


FONT_TITLE = load_font(52, bold=True)
FONT_H2 = load_font(30, bold=True)
FONT_BODY = load_font(24)
FONT_SMALL = load_font(20)


def rounded_box(draw: ImageDraw.ImageDraw, xy, fill, outline=None, width=2, radius=28):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_text(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, font, fill, spacing=8):
    draw.multiline_text((x, y), text, font=font, fill=fill, spacing=spacing)


def arrow(draw: ImageDraw.ImageDraw, start, end, color=LINE, width=6):
    draw.line([start, end], fill=color, width=width)
    ex, ey = end
    sx, sy = start
    if abs(ex - sx) > abs(ey - sy):
        direction = 1 if ex > sx else -1
        draw.polygon(
            [
                (ex, ey),
                (ex - 18 * direction, ey - 10),
                (ex - 18 * direction, ey + 10),
            ],
            fill=color,
        )
    else:
        direction = 1 if ey > sy else -1
        draw.polygon(
            [
                (ex, ey),
                (ex - 10, ey - 18 * direction),
                (ex + 10, ey - 18 * direction),
            ],
            fill=color,
        )


def glass_panel(draw: ImageDraw.ImageDraw, xy, title: str, body: str, color: str):
    rounded_box(draw, xy, fill=color, outline="#FFFFFF22", width=2, radius=34)
    x1, y1, x2, y2 = xy
    draw.line([(x1 + 28, y1 + 74), (x2 - 28, y1 + 74)], fill="#FFFFFF22", width=2)
    draw_text(draw, x1 + 28, y1 + 20, title, FONT_H2, TEXT)
    draw_text(draw, x1 + 28, y1 + 96, body, FONT_BODY, SUBTEXT)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    # Background shapes
    draw.ellipse((150, 80, 750, 680), fill="#102B52")
    draw.ellipse((1680, 160, 2280, 760), fill="#1B2E58")
    draw.ellipse((820, 1080, 1600, 1760), fill="#13324B")
    draw.rectangle((0, 0, WIDTH, HEIGHT), fill="#05070D88")

    draw_text(draw, 120, 70, "Claudio AI 电台结构图", FONT_TITLE, TEXT)
    draw_text(
        draw,
        120,
        145,
        "零成本 TTS 先跑通，IndexTTS2 作为本地主力，后期可无缝切到 MiniMax / Fish。",
        FONT_BODY,
        SUBTEXT,
    )

    # Frontend
    glass_panel(
        draw,
        (120, 260, 740, 540),
        "PWA Frontend",
        "React + Vite\n播放器 UI\nDJ 串词卡片\n聊天输入\n播放音频 URL / 浏览器 fallback TTS",
        "#16233FCC",
    )

    # Node server
    glass_panel(
        draw,
        (900, 220, 1540, 620),
        "Node Server",
        "节目编排引擎\n选曲 / 队列 / 状态机\n聊天控制\n统一 TTS Provider 抽象层\nAudio API / Stream API",
        "#1B2948CC",
    )

    # DB and Import
    glass_panel(
        draw,
        (1680, 250, 2260, 470),
        "Music Import + SQLite",
        "网易云 / QQ 音乐导入\n用户画像\n节目状态\n播放历史\n缓存索引",
        "#1A2E36CC",
    )

    # Providers
    glass_panel(
        draw,
        (180, 760, 620, 1080),
        "TTS Providers",
        "Web Speech API\nPiper\nIndexTTS2\nMiniMax Speech\nFish Audio",
        "#21314ACC",
    )

    # Python service
    glass_panel(
        draw,
        (900, 760, 1540, 1080),
        "Python TTS Service",
        "FastAPI\n/synthesize\n/health\n/warmup\n本地推理微服务",
        "#223256CC",
    )

    # Model
    glass_panel(
        draw,
        (1720, 710, 2260, 1010),
        "IndexTTS2 Runtime",
        "模型权重\n参考音色\n情绪参数\n音频输出 wav / mp3\n后期可替换云端 provider",
        "#372843CC",
    )

    # Cache
    glass_panel(
        draw,
        (900, 1180, 1540, 1440),
        "Audio Cache",
        "按 text + voice + emotion hash\n缓存串词音频\n避免重复推理\n加速重播和切歌",
        "#28354ACC",
    )

    glass_panel(
        draw,
        (180, 1180, 620, 1440),
        "Fallback Strategy",
        "开发期默认 Web Speech\n本地主力 IndexTTS2\n失败时降级到 Piper\n后期切 MiniMax / Fish",
        "#384224CC",
    )

    glass_panel(
        draw,
        (1720, 1160, 2260, 1450),
        "Playback Flow",
        "LLM 生成主持词\nNode 调 TTS\n返回 audioUrl\n前端插播 DJ 音频\n歌曲与主持词交替播出",
        "#4A3420CC",
    )

    # Arrows
    arrow(draw, (740, 400), (900, 400), color=ACCENT)
    arrow(draw, (1540, 360), (1680, 360), color=ACCENT_2)
    arrow(draw, (1220, 620), (1220, 760), color=LINE)
    arrow(draw, (620, 920), (900, 920), color=ACCENT)
    arrow(draw, (1540, 920), (1720, 860), color=ACCENT_2)
    arrow(draw, (1220, 1080), (1220, 1180), color=LINE)
    arrow(draw, (620, 1300), (900, 1300), color=ACCENT)
    arrow(draw, (1540, 1300), (1720, 1300), color=ACCENT_2)
    arrow(draw, (1220, 760), (1220, 620), color="#88AFFF")
    arrow(draw, (1220, 220), (1220, 170), color="#88AFFF")

    draw_text(
        draw,
        990,
        118,
        "统一接口，前端不关心底层 TTS 是本地还是云端",
        FONT_SMALL,
        "#D8E7FF",
    )

    image.save(OUTPUT, quality=94)
    print(str(OUTPUT))


if __name__ == "__main__":
    main()
