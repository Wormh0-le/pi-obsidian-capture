import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { captureGlobalConfigPath, expandHome } from "./config.ts";
import { knowledgeGlobalConfigPath } from "./knowledge-config.ts";

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export async function needsSetup(): Promise<boolean> {
	return !(await exists(captureGlobalConfigPath())) || !(await exists(knowledgeGlobalConfigPath()));
}

async function vaultDirectory(value: string): Promise<string> {
	const expanded = expandHome(value.trim());
	if (!isAbsolute(expanded)) throw new Error("Enter an absolute vault path (~/ is supported).");
	const path = await realpath(expanded);
	if (!(await stat(path)).isDirectory()) throw new Error(`Vault is not a directory: ${path}`);
	return path;
}

/** Collect all inputs before creating missing machine-local files; never replace existing files. */
export async function setupObsidian(ctx: Pick<ExtensionContext, "hasUI" | "ui">): Promise<string> {
	const capturePath = captureGlobalConfigPath();
	const knowledgePath = knowledgeGlobalConfigPath();
	if (resolve(capturePath) === resolve(knowledgePath)) {
		throw new Error("Capture and knowledge configuration must use different files.");
	}
	const hasCapture = await exists(capturePath);
	const hasKnowledge = await exists(knowledgePath);
	if (hasCapture && hasKnowledge) return "Both configuration files already exist; no changes made.";
	if (!ctx.hasUI) throw new Error("Run /obsidian-setup in an interactive Pi session.");

	let engineering: string;
	if (hasCapture) {
		const config = JSON.parse(await readFile(capturePath, "utf8"));
		if (typeof config.vault !== "string") throw new Error(`Missing vault in ${capturePath}`);
		engineering = await vaultDirectory(config.vault);
	} else {
		const knowledge = hasKnowledge ? JSON.parse(await readFile(knowledgePath, "utf8")) : undefined;
		const suggested = knowledge?.vaults?.engineering;
		const answer = await ctx.ui.input(
			"Engineering vault path (finalized conversations will be captured here automatically)",
			typeof suggested === "string" ? suggested : "/absolute/path/to/vault",
		);
		if (answer === undefined) return "Setup cancelled; no files changed.";
		engineering = await vaultDirectory(answer);
	}

	let papers: string | undefined;
	if (!hasKnowledge) {
		const answer = await ctx.ui.input("Papers vault path (optional; leave blank to skip)", "/absolute/path/to/papers");
		if (answer === undefined) return "Setup cancelled; no files changed.";
		if (answer.trim()) papers = await vaultDirectory(answer);
	}

	const configs: [string, unknown, boolean][] = [
		[capturePath, { schemaVersion: 1, vault: engineering, autoCapture: true }, hasCapture],
		[knowledgePath, { schemaVersion: 1, vaults: { engineering, ...(papers ? { papers } : {}) } }, hasKnowledge],
	];
	const results: string[] = [];
	for (const [path, config, existed] of configs) {
		if (existed) {
			results.push(`Preserved: ${path}`);
			continue;
		}
		await mkdir(dirname(path), { recursive: true });
		try {
			await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
			results.push(`Created: ${path}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			results.push(`Preserved: ${path} (created by another process)`);
		}
	}
	return `${results.join("\n")}\nRun /note-status to inspect capture. In a trusted repository, run /context-init and /context-link to configure knowledge access.`;
}
