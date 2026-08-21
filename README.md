# pi-obsidian-capture

A [Pi](https://github.com/earendil-works/pi-mono) package for two deliberately separate knowledge layers:

1. append-only capture of finalized Pi question-and-answer exchanges;
2. bounded, repository-scoped retrieval across explicitly linked Obsidian vaults.

Raw capture never stores thinking, tool calls, tool results, or terminal logs. Curated notes are created only through `/distill`.

## Install

Install the tagged Git package globally:

```bash
pi install git:github.com/Wormh0-le/pi-obsidian-capture@v0.1.0
```

To test without installing:

```bash
pi -e git:github.com/Wormh0-le/pi-obsidian-capture@v0.1.0
```

Pi packages execute with the user's full system permissions. Review the source and [security model](SECURITY.md) before installation.

Tested with Pi `0.84.2` and Node.js 24.

## Configure capture

Copy [examples/obsidian-capture.example.json](examples/obsidian-capture.example.json) to:

```text
~/.pi/agent/obsidian-capture.json
```

Set `vault` to the absolute path of the engineering vault. Machine-local absolute paths belong only in this global file and should not be committed.

A repository can optionally provide `.pi/obsidian-capture.json` using [examples/project-obsidian-capture.example.json](examples/project-obsidian-capture.example.json). Project configuration may change project metadata and capture behavior, but cannot override the vault path.

## Configure scoped cross-vault knowledge

Copy [examples/knowledge-vaults.example.json](examples/knowledge-vaults.example.json) to:

```text
~/.pi/agent/knowledge-vaults.json
```

This global file maps portable aliases such as `papers` and `engineering` to machine-local vault paths and establishes hard budgets.

Inside a trusted repository, run:

```text
/context-init
/context-link
/context-status
```

The resulting `.pi/knowledge-context.json` is portable and may be committed. It contains aliases and vault-relative paths, never personal absolute paths. See [KNOWLEDGE_CONTEXT.md](KNOWLEDGE_CONTEXT.md) for access modes and manifest examples.

The model-facing workflow is intentionally narrow:

```text
project_knowledge status
        ↓
project_knowledge search
        ↓
project_knowledge read with exact returned refs
```

Vault content returned by `project_knowledge` is explicitly marked as untrusted evidence, not instructions.

## Commands

| Command | Purpose |
|---|---|
| `/note-status` | Show capture routing and current state. |
| `/note` | Capture unseen finalized exchanges now. |
| `/note-auto on\|off\|status` | Override automatic capture for the session. |
| `/distill <title>` | Create a curated note using the current Pi model. |
| `/distill --force <title>` | Replace the target curated note without confirmation. |
| `/context-status` | Show allowed sources and budgets. |
| `/context-init` | Create a project manifest and engineering MOC. |
| `/context-link` | Add one source through a validated JSON editor. |
| `/obsidian-tools on\|off\|status` | Control broad `pi-obsidian` tools for the session. |

Successfully read `project_knowledge` refs are recorded in subsequent `/distill` note provenance.

## Optional: broad Obsidian tools

This package does not bundle `pi-obsidian`. Install it separately if you want general-purpose note, backlink, tag, Canvas, Kanban, Mermaid, daily-note, and dashboard tools:

```bash
pi install npm:pi-obsidian@0.2.3
```

Broad `obsidian_*` tools are inactive by default when this package is loaded. Enable them explicitly for one session:

```text
/obsidian-tools on
```

Scoped capture and `project_knowledge` work without `pi-obsidian`.

## Capture contract

- `agent_settled` captures only after retries, compaction, and queued follow-ups settle.
- `session_shutdown` performs a final no-model fallback capture.
- Entry markers make repeated capture idempotent.
- Per-file mutation queues and atomic rename prevent concurrent lost updates.
- `/distill` is separate from raw capture and links the resulting note to the configured MOC when present.

## 中文快速说明

安装：

```bash
pi install git:github.com/Wormh0-le/pi-obsidian-capture@v0.1.0
```

个人机器路径分别放在：

```text
~/.pi/agent/obsidian-capture.json
~/.pi/agent/knowledge-vaults.json
```

仓库只提交可移植配置：

```text
.pi/obsidian-capture.json
.pi/knowledge-context.json
```

日常使用优先走 `project_knowledge`；只有需要管理整个 Vault 时才执行 `/obsidian-tools on`。

## Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

## License

[MIT](LICENSE)
