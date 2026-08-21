import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

import {
	expandHome,
	findRepositoryRoot,
	safeRelativePath,
} from "./config.ts";
import type {
	KnowledgeAccess,
	KnowledgeBudget,
	KnowledgeManifest,
	KnowledgeRelation,
	KnowledgeSourceConfig,
	KnowledgeVaultConfig,
	ResolvedKnowledgeContext,
	ResolvedKnowledgeSource,
} from "./knowledge-types.ts";

const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "knowledge-vaults.json");
const DEFAULT_BUDGET: KnowledgeBudget = {
	startupChars: 1_200,
	maxSearchResults: 5,
	maxReadChars: 12_000,
	maxFilesPerSource: 500,
};
const VALID_ACCESS = new Set<KnowledgeAccess>(["index", "sections", "search", "full"]);
const VALID_RELATIONS = new Set<KnowledgeRelation>([
	"official-implementation",
	"reproduces",
	"reference-implementation",
	"background",
	"validates",
	"inspired-by",
	"project-memory",
]);

async function readJson<T>(filePath: string, required: boolean): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(filePath, "utf8")) as T;
	} catch (error) {
		if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
		throw error;
	}
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function resolveBudget(
	globalDefaults: KnowledgeVaultConfig["defaults"],
	manifestBudget: KnowledgeManifest["budget"],
): KnowledgeBudget {
	const merged = { ...DEFAULT_BUDGET, ...globalDefaults, ...manifestBudget };
	return {
		startupChars: boundedInt(merged.startupChars, DEFAULT_BUDGET.startupChars, 200, 5_000),
		maxSearchResults: boundedInt(merged.maxSearchResults, DEFAULT_BUDGET.maxSearchResults, 1, 20),
		maxReadChars: boundedInt(merged.maxReadChars, DEFAULT_BUDGET.maxReadChars, 1_000, 100_000),
		maxFilesPerSource: boundedInt(
			merged.maxFilesPerSource,
			DEFAULT_BUDGET.maxFilesPerSource,
			10,
			5_000,
		),
	};
}

function ensureContained(vaultPath: string, targetPath: string, label: string): void {
	const rel = relative(vaultPath, targetPath);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../")) {
		throw new Error(`${label} escapes its configured vault`);
	}
}

async function resolveVaults(config: KnowledgeVaultConfig): Promise<Record<string, string>> {
	if (!config.vaults || typeof config.vaults !== "object") {
		throw new Error("knowledge-vaults.json must define a vaults object");
	}
	const resolved: Record<string, string> = {};
	for (const [alias, configuredPath] of Object.entries(config.vaults)) {
		if (!/^[a-z][a-z0-9_-]*$/i.test(alias)) throw new Error(`Invalid vault alias: ${alias}`);
		if (typeof configuredPath !== "string" || !configuredPath.trim()) {
			throw new Error(`Vault alias ${alias} has no path`);
		}
		const vaultPath = await realpath(resolve(expandHome(configuredPath))).catch(() => undefined);
		if (!vaultPath || !(await stat(vaultPath)).isDirectory()) {
			throw new Error(`Vault alias ${alias} does not resolve to a directory`);
		}
		resolved[alias] = vaultPath;
	}
	return resolved;
}

function validateSource(source: KnowledgeSourceConfig): void {
	if (!/^[a-z][a-z0-9._-]*$/i.test(source.id)) throw new Error(`Invalid knowledge source id: ${source.id}`);
	if (!VALID_ACCESS.has(source.access)) throw new Error(`Invalid access mode for ${source.id}: ${source.access}`);
	if (!VALID_RELATIONS.has(source.relation)) {
		throw new Error(`Invalid relation for ${source.id}: ${source.relation}`);
	}
	const safePath = safeRelativePath(source.path, `source ${source.id} path`);
	if (safePath.split("/").some((segment) => segment.startsWith("."))) {
		throw new Error(`Source ${source.id} must not target hidden paths`);
	}
	if (source.access === "sections") {
		if (!Array.isArray(source.sections) || source.sections.length === 0) {
			throw new Error(`Source ${source.id} uses sections access but declares no sections`);
		}
		if (source.sections.some((section) => typeof section !== "string" || !section.trim())) {
			throw new Error(`Source ${source.id} contains an empty section name`);
		}
	}
}

async function resolveSource(
	source: KnowledgeSourceConfig,
	vaults: Record<string, string>,
): Promise<ResolvedKnowledgeSource> {
	validateSource(source);
	const vaultPath = vaults[source.vault];
	if (!vaultPath) throw new Error(`Source ${source.id} references unknown vault alias: ${source.vault}`);
	const safePath = safeRelativePath(source.path, `source ${source.id} path`);
	let absolutePath = resolve(vaultPath, safePath);
	ensureContained(vaultPath, absolutePath, `Source ${source.id}`);

	let info = await stat(absolutePath).catch(() => undefined);
	if (!info && !safePath.toLowerCase().endsWith(".md")) {
		absolutePath = `${absolutePath}.md`;
		info = await stat(absolutePath).catch(() => undefined);
	}
	if (!info) throw new Error(`Knowledge source not found: ${source.vault}:${source.path}`);
	absolutePath = await realpath(absolutePath);
	ensureContained(vaultPath, absolutePath, `Source ${source.id}`);
	info = await stat(absolutePath);
	const kind = info.isDirectory() ? "directory" : info.isFile() ? "note" : undefined;
	if (!kind) throw new Error(`Knowledge source is not a file or directory: ${source.id}`);
	if (kind === "note" && !absolutePath.toLowerCase().endsWith(".md")) {
		throw new Error(`Knowledge note source must be Markdown: ${source.id}`);
	}
	if ((source.access === "sections" || source.access === "full") && kind !== "note") {
		throw new Error(`${source.access} access requires one explicit Markdown note: ${source.id}`);
	}

	return {
		...source,
		path: relative(vaultPath, absolutePath).replaceAll("\\", "/"),
		sections: source.sections?.map((section) => section.trim()),
		vaultPath,
		absolutePath,
		kind,
	};
}

function knowledgeGlobalConfigPath(): string {
	return resolve(expandHome(process.env.PI_KNOWLEDGE_VAULTS_CONFIG ?? DEFAULT_CONFIG_PATH));
}

export async function loadBroadObsidianToolsDefault(): Promise<boolean> {
	const config = await readJson<KnowledgeVaultConfig>(knowledgeGlobalConfigPath(), true);
	return config?.defaults?.broadObsidianTools ?? false;
}

export async function resolveKnowledgeContext(
	cwd: string,
	allowProjectConfig: boolean,
): Promise<ResolvedKnowledgeContext | undefined> {
	const repoRoot = await findRepositoryRoot(cwd);
	const manifestPath = join(repoRoot, ".pi", "knowledge-context.json");
	if (!allowProjectConfig) return undefined;
	const manifest = await readJson<KnowledgeManifest>(manifestPath, false);
	if (!manifest) return undefined;
	if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
		throw new Error(`Unsupported knowledge-context schemaVersion: ${manifest.schemaVersion}`);
	}

	const globalConfigPath = knowledgeGlobalConfigPath();
	const globalConfig = await readJson<KnowledgeVaultConfig>(globalConfigPath, true);
	if (!globalConfig) throw new Error(`Missing knowledge vault config: ${globalConfigPath}`);
	if (globalConfig.schemaVersion !== undefined && globalConfig.schemaVersion !== 1) {
		throw new Error(`Unsupported knowledge-vaults schemaVersion: ${globalConfig.schemaVersion}`);
	}
	const vaults = await resolveVaults(globalConfig);
	const configuredSources = [...(manifest.sources ?? [])];
	if (manifest.engineering?.folder) {
		configuredSources.unshift({
			id: "engineering-project",
			vault: "engineering",
			path: manifest.engineering.folder,
			relation: "project-memory",
			access: "search",
		});
	}
	const ids = new Set<string>();
	for (const source of configuredSources) {
		if (ids.has(source.id)) throw new Error(`Duplicate knowledge source id: ${source.id}`);
		ids.add(source.id);
	}
	const sources = await Promise.all(configuredSources.map((source) => resolveSource(source, vaults)));
	return {
		globalConfigPath,
		manifestPath,
		projectName: manifest.project?.trim() || basename(repoRoot),
		repoRoot,
		budget: resolveBudget(globalConfig.defaults, manifest.budget),
		broadObsidianTools: globalConfig.defaults?.broadObsidianTools ?? false,
		vaults,
		sources,
	};
}

export function buildKnowledgeContextCard(context: ResolvedKnowledgeContext): string {
	const sources = context.sources
		.map((source) => `${source.id}:${source.relation}/${source.access}`)
		.join(", ");
	const card = [
		"Project knowledge is explicitly scoped by .pi/knowledge-context.json.",
		`Linked sources: ${sources || "none"}.`,
		"Use project_knowledge status/search/read; search metadata first and read only selected references.",
	].join(" ");
	return card.slice(0, context.budget.startupChars);
}
