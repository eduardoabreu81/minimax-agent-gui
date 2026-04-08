# MiniMax Agent GUI

> ⚠️ **Warning: This project is in active development and testing phase.** Some features may be unstable or not fully functional. Use at your own risk.

Personal AI agent powered by MiniMax M2.7 with integrated TTS, Image Generation, and MCP tools.

## ⚠️ Testing Phase Notice

This application is currently in **testing/development phase**:
- Features are being actively developed and may change
- Some functionality may not work as expected
- Bug reports and feedback are welcome

## Features

- **Agent Chat**: Conversational AI with M2.7 model (persistent conversation context)
  - `Ctrl+Enter` to send messages
  - Auto-save conversations to sidebar
  - Toggle switches for MCP tools (web_search, understand_image)
- **TTS**: Text-to-Speech with Speech 2.8 (4,000 chars/day on Token Plan Plus)
- **Image Gen**: Image generation with image-01 (50 images/day on Token Plan Plus)
  - Multiple aspect ratios: 1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16, 21:9
  - Prompt optimizer option
  - Generate 1-9 images at once
- **MCP Tools**: Integrated web_search and understand_image tools for the agent

## Setup

```bash
# Install dependencies
pip install -e .

# Configure API key
# Edit config/config.yaml with your MiniMax API key

# Run GUI
python -m gui.main
```

## Project Structure

```
minimax-agent-gui/
├── gui/                    # PyQt6 GUI application
│   ├── main.py             # Application entry point
│   └── panels/             # UI panels
│       ├── chat_panel.py   # Agent chat (uses real Mini-Agent)
│       ├── tts_panel.py    # TTS (Speech 2.8)
│       └── image_panel.py  # Image generation (image-01)
├── mini_agent/             # Real Mini-Agent framework
├── mini_max_mcp/           # MiniMax MCP client & tools
│   ├── client.py           # TTS & Image sync clients
│   ├── mcp_tools.py        # MCP API implementations
│   └── mcp_tool_wrapper.py # Tool wrappers for agent
├── config/                 # Configuration files
│   └── config.yaml         # User configuration
└── workspace/              # Agent working directory & conversations
```

## Token Plans

All plans include M2.7 access. Choose based on your usage needs.

### Standard Plans

| Feature | Standard | Plus ($20/mo) | Premium ($50/mo) |
|---------|----------|---------------|------------------|
| M2.7 | 1,500 req/5hrs | 4,500 req/5hrs | 15,000 req/5hrs |
| Speech 2.8 | — | 4,000 chars/day | 11,000 chars/day |
| image-01 | — | 50 images/day | 120 images/day |
| Hailuo-2.3-Fast 768P 6s | — | — | 2/day |
| Hailuo-2.3 768P 6s | — | — | 2/day |
| Music-2.5 | — | — | 4 songs/day |

### Highspeed Plans (Dedicated M2.7-highspeed)

| Feature | Standard | Plus | Premium |
|---------|----------|------|---------|
| M2.7-highspeed | 4,500 req/5hrs | 15,000 req/5hrs | 30,000 req/5hrs |
| Speech 2.8 | 9,000 chars/day | 19,000 chars/day | 50,000 chars/day |
| image-01 | 100 images/day | 200 images/day | 800 images/day |
| Hailuo-2.3-Fast 768P 6s | — | 3/day | 5/day |
| Hailuo-2.3 768P 6s | — | 3/day | 5/day |
| Music-2.5 | — | 7 songs/day | 15 songs/day |

### MCP Tools

| Feature | Availability |
|---------|--------------|
| web_search | Unlimited (with active subscription) |
| understand_image | Unlimited (with active subscription) |

## Requirements

- Python 3.10+
- PyQt6
- httpx
- tiktoken (for token counting)
- MiniMax API key from [platform.minimax.io](https://platform.minimax.io)

## Current Known Issues / TODO

- [ ] MCP tools toggle switches are visual only (tools always enabled)
- [ ] Image generation may occasionally fail with certain aspect ratios
- [ ] TTS panel needs playback controls
- [ ] Conversation history needs search functionality

## License

MIT License - See LICENSE file for details.