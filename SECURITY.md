# Security

Pi extensions execute with the user's full operating-system permissions. Review this package before installation and only configure vaults and repositories you trust.

## Data handling

- Conversation capture writes only finalized user prompts and assistant answers. It excludes thinking, tool calls, tool results, and terminal logs.
- Capture and scoped knowledge retrieval operate on local files.
- `/distill` calls the model already selected and authenticated in Pi; the configured provider receives the bounded distillation source.
- `project_knowledge` treats vault content as untrusted reference material and does not interpret it as instructions.

## Scope controls

The knowledge router rejects absolute paths, traversal segments, hidden paths, non-Markdown note targets, duplicate source IDs, unknown vault aliases, and symlink escapes. Repository manifests are honored only for trusted projects.

Never commit `~/.pi/agent/obsidian-capture.json` or `~/.pi/agent/knowledge-vaults.json`; these files normally contain machine-local absolute paths.

## Reporting

Report security issues privately to the repository owner through GitHub before opening a public issue.
