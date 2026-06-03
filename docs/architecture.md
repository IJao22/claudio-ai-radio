# Claudio Architecture

这版骨架先落实四件事：

1. 前端播放器壳和电台 UI 风格先定住。
2. 后端先产出一个结构化节目计划，而不是让前端写死。
3. TTS 通过 provider 抽象解耦，默认零成本方案。
4. 未来接 `IndexTTS2 / Piper / MiniMax / Fish` 不改业务层。

## 第一阶段模块

- `show planner`: 生成当前节目、曲目和串词
- `tts manager`: 根据配置选择 provider
- `radio api`: 给前端返回当前节目卡片
- `player shell`: 显示播放、串词、队列、聊天输入

## 后续优先级

1. 接网易云 / QQ 音乐导入
2. 接真实 `IndexTTS2` Python 服务
3. 增加对话控制和状态持久化
4. 加入时段调度和自动切换节目

