import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "pi-obsidian-capture-"));
const papers = join(temp, "papers");
const engineering = join(temp, "engineering");
const repo = join(temp, "repo");
const globalConfig = join(temp, "knowledge-vaults.json");

try {
  await mkdir(join(papers, "Domain"), { recursive: true });
  await mkdir(join(engineering, "Projects", "Demo"), { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });
  await mkdir(join(repo, ".pi"), { recursive: true });

  await writeFile(
    join(papers, "Domain", "Method.md"),
    [
      "---",
      "title: Method Paper",
      "tags: [simulation]",
      "---",
      "# Method Paper",
      "## Method",
      "Bounded integrator coupling is explained here.",
      "## Private Appendix",
      "SECTION_BODY_SECRET",
    ].join("\n"),
  );
  await writeFile(
    join(papers, "Domain", "Index Note.md"),
    ["# Index Note", "## Metadata Only", "INDEX_BODY_SECRET"].join("\n"),
  );
  await writeFile(join(engineering, "Projects", "Demo", "Notes.md"), "# Demo Notes\nLocal engineering memory.\n");

  await writeFile(
    globalConfig,
    `${JSON.stringify({
      schemaVersion: 1,
      vaults: { papers, engineering },
      defaults: {
        startupChars: 1200,
        maxSearchResults: 5,
        maxReadChars: 5000,
        maxFilesPerSource: 20,
        broadObsidianTools: false,
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    join(repo, ".pi", "knowledge-context.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      project: "Demo",
      engineering: { folder: "Projects/Demo" },
      sources: [
        {
          id: "method",
          vault: "papers",
          path: "Domain/Method.md",
          relation: "reproduces",
          access: "sections",
          sections: ["Method"],
        },
        {
          id: "domain-index",
          vault: "papers",
          path: "Domain/Index Note.md",
          relation: "background",
          access: "index",
        },
      ],
    }, null, 2)}\n`,
  );

  process.env.PI_KNOWLEDGE_VAULTS_CONFIG = globalConfig;
  const { resolveKnowledgeContext } = await import("../extensions/obsidian-capture/knowledge-config.ts");
  const { readKnowledge, searchKnowledge } = await import("../extensions/obsidian-capture/knowledge-router.ts");

  const context = await resolveKnowledgeContext(repo, true);
  assert(context, "context should resolve");
  assert.equal(context.sources.length, 3);
  assert.equal(context.broadObsidianTools, false);

  const methodMatches = await searchKnowledge(context, "integrator coupling", "standard");
  const methodMatch = methodMatches.find((result) => result.sourceId === "method");
  assert(methodMatch, "allowed section should be searchable");
  const methodRead = await readKnowledge(context, [methodMatch.ref], "small");
  assert.match(methodRead[0].content, /Bounded integrator coupling/);
  assert.doesNotMatch(methodRead[0].content, /SECTION_BODY_SECRET/);

  const indexMatches = await searchKnowledge(context, "Metadata Only", "standard");
  const indexMatch = indexMatches.find((result) => result.sourceId === "domain-index");
  assert(indexMatch, "index metadata should be searchable");
  const indexRead = await readKnowledge(context, [indexMatch.ref], "small");
  assert.match(indexRead[0].content, /Metadata Only/);
  assert.doesNotMatch(indexRead[0].content, /INDEX_BODY_SECRET/);

  await assert.rejects(
    () => readKnowledge(context, ["engineering-project::../escape.md"], "small"),
    /Unsafe file path/,
  );

  const totalReadChars = [...methodRead, ...indexRead].reduce((total, result) => total + result.content.length, 0);
  assert(totalReadChars <= context.budget.maxReadChars);
  console.log("Router smoke test passed: scoped sections, metadata-only index, traversal rejection, and read budgets.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
