import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import obsidianCaptureExtension from "../extensions/obsidian-capture/index.ts";
import { resolveCaptureContext } from "../extensions/obsidian-capture/config.ts";

const temp = await mkdtemp(join(tmpdir(), "capture-lifecycle-"));
const config = join(temp, "capture.json");
const vault = join(temp, "vault");
process.env.PI_OBSIDIAN_CAPTURE_CONFIG = config;
process.env.PI_KNOWLEDGE_VAULTS_CONFIG = join(temp, "knowledge.json");

function harness(entries = []) {
  const events = new Map();
  const commands = new Map();
  const notifications = [];
  const statuses = new Map();
  obsidianCaptureExtension({
    on: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
    registerCommand: (name, command) => commands.set(name, command),
    registerTool() {},
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools() {},
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
  });
  const ctx = {
    cwd: temp,
    isProjectTrusted: () => false,
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionFile: () => undefined,
      getBranch: () => entries,
    },
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: (key, value) => statuses.set(key, value),
    },
  };
  return {
    notifications, statuses,
    async emit(name) {
      for (const handler of events.get(name) ?? []) await handler({}, ctx);
    },
    command: (name, args = "") => commands.get(name).handler(args, ctx),
  };
}

try {
  await mkdir(vault);
  await test("unconfigured new and resumed sessions stay silent", async () => {
    for (const entries of [[], [{ type: "custom", customType: "obsidian-capture-state", data: { autoEnabled: true } }]]) {
      const app = harness(entries);
      await app.emit("session_start");
      assert.deepEqual(app.notifications, []);
      assert.equal(app.statuses.get("obsidian-capture"), undefined);
    }
  });
  await test("unconfigured automatic capture stays silent across answers and shutdown", async () => {
    const app = harness();
    await app.emit("agent_settled");
    await app.emit("agent_settled");
    await app.emit("session_shutdown");
    assert.deepEqual(app.notifications, []);
    assert.equal(app.statuses.get("obsidian-capture"), undefined);
  });
  await test("explicit capture still explains how to configure", async () => {
    const app = harness();
    await app.command("note");
    assert.equal(app.notifications.length, 1);
    assert.match(app.notifications[0].message, /Capture is not configured.*\/obsidian-setup/);
  });
  await test("configuration takes effect in the same session and removal clears status", async () => {
    const app = harness([
      { type: "message", id: "u1", message: { role: "user", content: "User prompt" } },
      { type: "message", id: "a1", message: { role: "assistant", content: "Assistant answer", stopReason: "stop" } },
    ]);
    await app.emit("session_start");
    app.notifications.length = 0;
    await writeFile(config, JSON.stringify({ vault, autoCapture: false }));
    await app.emit("agent_settled");
    const resolved = await resolveCaptureContext(temp, "test-session", false);
    await assert.rejects(readFile(resolved.rawNotePath), { code: "ENOENT" });
    await app.command("note-auto", "on");
    await app.emit("agent_settled");
    const note = await readFile(resolved.rawNotePath, "utf8");
    assert.match(note, /User prompt/);
    assert.match(note, /Assistant answer/);
    await app.emit("session_start");
    assert.match(app.statuses.get("obsidian-capture"), /auto/);
    await rm(config);
    app.notifications.length = 0;
    await app.emit("agent_settled");
    assert.deepEqual(app.notifications, []);
    assert.equal(app.statuses.get("obsidian-capture"), undefined);
  });
  await test("invalid configuration still reports actionable errors", async () => {
    await writeFile(config, "{invalid");
    const app = harness();
    await app.emit("session_start");
    await app.emit("agent_settled");
    assert.equal(app.notifications.length, 2);
    assert.ok(app.notifications.every(({ message, level }) => level === "error" && /Invalid JSON/.test(message)));
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
