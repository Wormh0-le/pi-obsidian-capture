# pi-obsidian-capture

A [Pi](https://github.com/earendil-works/pi-mono) package for two deliberately separate knowledge layers:

1. append-only capture of finalized Pi question-and-answer exchanges;
2. bounded, repository-scoped retrieval across explicitly linked Obsidian vaults.

Raw capture never stores thinking, tool calls, tool results, or terminal logs. Curated notes are created only through `/distill`.

## Install

Install the npm package globally:

```bash
pi install npm:pi-obsidian-capture@0.1.2
```

To test without installing:

```bash
pi -e npm:pi-obsidian-capture@0.1.2
```

Pi packages execute with the user's full system permissions. Review the source and [security model](SECURITY.md) before installation.

Tested with Pi `0.84.2` and Node.js 24.

## First-run setup

Setup is optional. Until capture is configured, new and resumed sessions stay silent and automatic capture is skipped. Run `/obsidian-setup` when you want to enable it; explicit capture commands explain how to configure it if needed.

After installation, start Pi (or run `/reload` in an existing session), then run:

```text
/obsidian-setup
```

Enter the absolute path of your existing engineering vault (`~/` is supported), then optionally enter a papers vault path. Leave the papers input blank to skip it. The command creates both global configuration files with working defaults:

```text
~/.pi/agent/obsidian-capture.json
~/.pi/agent/knowledge-vaults.json
```

Automatic capture is enabled for the selected engineering vault. Existing files are preserved; rerunning setup creates only missing files. Cancelling either input leaves files unchanged. Setup requires an interactive Pi session and takes effect immediately for capture and subsequent knowledge commands. It does not create a vault or grant repository knowledge access.

If `PI_OBSIDIAN_CAPTURE_CONFIG` or `PI_KNOWLEDGE_VAULTS_CONFIG` is set, setup uses the same overridden file path as the plugin.

### Optional manual configuration

Use [the capture example](examples/obsidian-capture.example.json) to customize capture folders, limits, or project routing, and [the vault mapping example](examples/knowledge-vaults.example.json) to add aliases or customize hard budgets. Machine-local paths belong only in these global files and should not be committed.

A repository can optionally provide `.pi/obsidian-capture.json` using [the project example](examples/project-obsidian-capture.example.json). Project configuration may change project metadata and capture behavior, but cannot override the vault path.

## Configure scoped cross-vault knowledge

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
| `/obsidian-setup` | Create missing global configuration files through interactive vault path prompts. |
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
pi install npm:pi-obsidian-capture@0.1.2
```

配置是可选的：未配置采集时，新建或恢复会话不会提示配置，回答结束也不会自动采集或报未配置错误。需要使用时，启动 Pi（已打开的会话先执行 `/reload`），运行 `/obsidian-setup`，输入工程 Vault 路径和可选的资料 Vault 路径即可，无需手动复制 JSON。工程 Vault 默认开启自动采集，可通过 `/note-auto off` 关闭当前会话的自动采集。已有配置不会被覆盖，取消输入不会写入文件。

引导自动创建以下个人配置：

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
