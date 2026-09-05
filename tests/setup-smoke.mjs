import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needsSetup, setupObsidian } from "../extensions/obsidian-capture/setup.ts";
import { resolveCaptureContext } from "../extensions/obsidian-capture/config.ts";
import { loadBroadObsidianToolsDefault, resolveKnowledgeContext } from "../extensions/obsidian-capture/knowledge-config.ts";

const temp = await mkdtemp(join(tmpdir(), "obsidian-setup-"));
const capture = join(temp, "agent", "obsidian-capture.json");
const knowledge = join(temp, "agent", "knowledge-vaults.json");
const engineering = join(temp, "Engineering Vault");
const papers = join(temp, "Papers Vault");
const repo = join(temp, "repo");
process.env.PI_OBSIDIAN_CAPTURE_CONFIG = capture;
process.env.PI_KNOWLEDGE_VAULTS_CONFIG = knowledge;
const ui = (...answers) => ({ hasUI: true, ui: { input: async () => answers.shift() } });
const absent = async () => {
  await assert.rejects(readFile(capture), { code: "ENOENT" });
  await assert.rejects(readFile(knowledge), { code: "ENOENT" });
};
try {
  await mkdir(engineering);
  await mkdir(papers);
  await mkdir(join(repo, ".pi"), { recursive: true });
  assert.equal(await needsSetup(), true);
  assert.equal(await loadBroadObsidianToolsDefault(), false);
  await assert.rejects(setupObsidian({ hasUI: false }), /interactive/);
  await setupObsidian(ui(undefined));
  await absent();
  await setupObsidian(ui(engineering, undefined));
  await absent();
  await assert.rejects(setupObsidian(ui("relative/path")), /absolute/);
  await absent();
  await assert.rejects(setupObsidian(ui(engineering, join(temp, "missing"))), { code: "ENOENT" });
  await absent();

  await setupObsidian(ui(engineering, papers));
  assert.equal(await needsSetup(), false);
  const resolved = await resolveCaptureContext(repo, "test-session", true);
  assert.equal(resolved.vaultPath, engineering);
  assert.equal(resolved.autoCapture, true);
  await writeFile(join(repo, ".pi", "knowledge-context.json"), JSON.stringify({
    schemaVersion: 1, project: "Demo", sources: [],
  }));
  const context = await resolveKnowledgeContext(repo, true);
  assert.equal(context.vaults.engineering, engineering);
  assert.equal(context.vaults.papers, papers);
  assert.equal(context.broadObsidianTools, false);
  assert.equal(await resolveKnowledgeContext(repo, false), undefined);

  const originalCapture = await readFile(capture, "utf8");
  const originalKnowledge = await readFile(knowledge, "utf8");
  await setupObsidian({ hasUI: true, ui: { input: () => assert.fail("must not prompt when configured") } });
  assert.equal(await readFile(capture, "utf8"), originalCapture);
  assert.equal(await readFile(knowledge, "utf8"), originalKnowledge);

  await rm(knowledge);
  await setupObsidian(ui(""));
  assert.equal(await readFile(capture, "utf8"), originalCapture);
  assert.deepEqual(JSON.parse(await readFile(knowledge, "utf8")).vaults, { engineering });
  await rm(capture);
  const preservedKnowledge = await readFile(knowledge, "utf8");
  await setupObsidian(ui(engineering));
  assert.equal(await readFile(knowledge, "utf8"), preservedKnowledge);

  // Exclusive creation also protects a file created while the user is answering.
  await rm(capture);
  await setupObsidian({ hasUI: true, ui: { input: async () => {
    await writeFile(capture, originalCapture);
    return papers;
  } } });
  assert.equal(await readFile(capture, "utf8"), originalCapture);

  // A dangling symlink is an existing configuration entry, never a write target.
  await rm(capture);
  const target = join(temp, "untouched");
  await symlink(target, capture);
  await setupObsidian(ui());
  await assert.rejects(readFile(target), { code: "ENOENT" });
  console.log("Setup smoke tests passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
