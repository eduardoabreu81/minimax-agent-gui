# Product Vision — MiniMax Agent GUI

## What This Is

MiniMax Agent GUI is a simple all-in-one web interface for MiniMax. It gives MiniMax Token Plan users a practical GUI for chat, image, video, music, speech, MCP tools, skills, and agent workflows — without jumping between CLI commands, scripts, and separate API calls.

## What This Is Not

- It is **not** an IDE.
- It is **not** trying to be the "best coding agent editor."
- It is **not** a replacement for VS Code, Cursor, or Zed.

The Code Workspace is one module among several. It exists because users sometimes want the agent to write or edit files, but it does not dominate the product.

## Target Audience

**Primary:** MiniMax Token Plan subscribers who want a practical, multi-modal GUI.

These users already have API access. They need a single place to:
- Chat with M2.7
- Generate images, videos, music, and speech
- Toggle MCP tools like web search and image understanding
- Run agent workflows and skills
- Occasionally let the agent read, write, or edit files

## Core Workflows

1. **Chat** — Persistent conversations with attachments, image understanding, markdown, and conversation search.
2. **Image Generation** — T2I and I2I with aspect ratio, batch, gallery, prompt optimizer, and recent generations history.
3. **Video Generation** — Text or image to video with progress tracking and recent video history.
4. **Music Generation** — Prompt or lyrics to music, instrumental mode, cover generation, and recent music history.
5. **Speech / TTS** — 30+ voices, speed control, streaming playback, and recent speech history.
6. **MCP Tools** — Built-in Web Search and Image Understanding, configurable custom MCP servers, connection testing, tool discovery, and external MCP tools available to the agent.
7. **Agent & Skills** — Slash commands, multi-step agent tasks, skill templates, and Plan Mode with editable approve-and-run drafts.
8. **Code Workspace** — File explorer, editor, terminal, and code-chat for agent-driven file operations.
9. **Session Protection** — Guards against accidental context loss when switching tabs, refreshing, or leaving the page.

## Design Principles

- **All-in-one:** One tabbed interface for every MiniMax workflow. No context switching.
- **Simple:** Practical defaults, minimal configuration, clear UI.
- **Agent-first:** The agent can use every feature — chat, media generation, file tools, MCP — from a single session.
- **MCP-friendly:** Make MiniMax MCP tools and custom MCP servers easy to configure, test, and use from the agent.

## Workspace Organization

User data and agent outputs live in `workspace/`:

```
workspace/
├── conversations/     # Persistent chat and code-chat history
├── generations/       # Agent-generated media outputs
│   ├── images/
│   ├── videos/
│   ├── music/
│   └── tts/
└── uploads/           # User-uploaded files
```

This keeps outputs organized and prevents IDE clutter.

## Positioning Against Alternatives

| Approach | Pain Point | How MiniMax Agent GUI Helps |
|----------|-----------|----------------------------|
| Raw API / curl | Tedious, no persistence | Web UI with auto-save |
| Separate scripts per modality | Context switching | Single tabbed interface |
| CLI-only agents | No GUI for media preview | Built-in gallery and player |
| Raw API / scripts with manual MCP setup | Complex server configuration, no GUI | Built-in MCP server management with connection testing and tool discovery |

## Success Metrics

- A MiniMax user can go from zero to first image/video/music generation in under 2 minutes.
- MCP tools and custom MCP servers can be configured, tested, discovered, and used by the agent without editing config files.
- Agent outputs are automatically organized and easy to find.
- The Code Workspace is used when needed, but never feels like the whole app.
