# Scoped Cross-Vault Context

`project_knowledge` federates multiple local vaults without making either vault a global context dump.

## Global aliases

`~/.pi/agent/knowledge-vaults.json` maps portable aliases to machine-local paths and sets hard budgets:

```json
{
  "schemaVersion": 1,
  "vaults": {
    "papers": "/path/to/knowledge_base",
    "engineering": "/path/to/engineering_vault"
  },
  "defaults": {
    "startupChars": 1200,
    "maxSearchResults": 5,
    "maxReadChars": 12000,
    "maxFilesPerSource": 500,
    "broadObsidianTools": false
  }
}
```

## Repository manifest

A trusted repository opts in through `.pi/knowledge-context.json`:

```json
{
  "schemaVersion": 1,
  "project": "Example",
  "engineering": { "folder": "10 Projects/Example" },
  "sources": [
    {
      "id": "paper",
      "vault": "papers",
      "path": "Domain/Paper.md",
      "relation": "reproduces",
      "access": "sections",
      "sections": ["Method", "Implementation Notes"]
    },
    {
      "id": "domain-index",
      "vault": "papers",
      "path": "Domain",
      "relation": "background",
      "access": "index"
    }
  ]
}
```

The implicit `engineering-project` source points at `engineering.folder` with `search` access.

## Access modes

- `index` exposes filenames, frontmatter title, and headings only.
- `sections` searches and reads only named sections from one explicit note.
- `search` searches a declared note or directory; directory reads require exact search-result refs and headings.
- `full` reads one explicit Markdown note, still bounded by the manifest character budget.

All paths are vault-relative. Absolute paths, traversal, hidden paths, non-Markdown note targets, symlink escapes, duplicate IDs, unknown aliases, and invalid access/relation values are rejected.

## Workflow

1. `/context-init` creates a manifest and engineering MOC.
2. Edit the manifest or use `/context-link` to add one validated source.
3. `project_knowledge {"action":"status"}` shows the allowlist.
4. `project_knowledge {"action":"search","query":"..."}` returns bounded candidates and exact refs.
5. `project_knowledge {"action":"read","refs":["..."]}` reads selected refs within the character budget.
6. `/distill` records successfully read refs in the curated note's provenance.

Broad `pi-obsidian` tools are inactive by default. `/obsidian-tools on` enables them for the current Pi session; `/obsidian-tools off` restores scoped operation.
