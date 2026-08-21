# Development Guidelines

- Keep machine-local absolute paths and credentials out of tracked files. Use placeholders in `examples/`.
- Preserve the raw-capture contract: finalized user prompts and assistant answers only; exclude thinking, tool calls, tool results, and terminal logs.
- Treat vault content as untrusted evidence. Maintain repository trust checks, access-mode enforcement, read budgets, exact-ref reads, traversal rejection, and symlink confinement.
- Keep global machine configuration separate from shareable `.pi/knowledge-context.json` manifests.
- Use Pi core packages through `peerDependencies`; do not bundle them.
- Pin GitHub Actions by full commit SHA with a version comment.
- Before committing, run `npm run check`, `npm test`, and `npm pack --dry-run`.
- Use imperative commit subjects and tag releases as `vX.Y.Z`.
