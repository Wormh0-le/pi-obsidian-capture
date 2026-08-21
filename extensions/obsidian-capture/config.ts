import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
	CaptureConfig,
	ProjectLocalConfig,
	ProjectRouteConfig,
	ResolvedCaptureContext,
} from "./types.ts";

const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-capture.json");
const DEFAULT_INBOX_FOLDER = "00 Inbox/Pi Sessions";
const DEFAULT_PROJECTS_FOLDER = "10 Projects";
const DEFAULT_MAX_MESSAGE_CHARS = 80_000;
const DEFAULT_DISTILL_MAX_CHARS = 160_000;

export function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith(`~${sep}`) || value.startsWith("~/")) {
		return join(homedir(), value.slice(2));
	}
	return value;
}

async function readJsonFile<T>(filePath: string, required: boolean): Promise<T | undefined> {
	try {
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!required && code === "ENOENT") return undefined;
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
		}
		throw error;
	}
}

export async function findRepositoryRoot(cwd: string): Promise<string> {
	let current = await realpath(cwd);
	while (true) {
		try {
			await access(join(current, ".git"));
			return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) return await realpath(cwd);
			current = parent;
		}
	}
}

export function safeRelativePath(value: string, label: string): string {
	if (!value.trim()) throw new Error(`${label} cannot be empty`);
	if (isAbsolute(value)) throw new Error(`${label} must be relative to the vault`);

	const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
	const segments = normalized.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
		throw new Error(`${label} contains an unsafe path segment`);
	}
	if (segments.some((segment) => segment.toLowerCase() === ".obsidian")) {
		throw new Error(`${label} must not target Obsidian configuration files`);
	}
	return normalized;
}

export function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
	const safe = safeRelativePath(relativePath, "Vault path");
	const target = resolve(vaultPath, safe);
	const rel = relative(vaultPath, target);
	if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
		throw new Error(`Path escapes the configured vault: ${relativePath}`);
	}
	return target;
}

export function localDateString(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function slugify(value: string): string {
	const slug = value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return slug || "project";
}

export function sanitizeNoteTitle(value: string): string {
	const title = value
		.normalize("NFKC")
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
	return title || "Session Distillation";
}

export function yamlString(value: string): string {
	return JSON.stringify(value);
}

function normalizeTags(tags: unknown, fallback: string[]): string[] {
	const source = Array.isArray(tags) ? tags : fallback;
	return [...new Set(source.filter((tag): tag is string => typeof tag === "string").map(slugify).filter(Boolean))];
}

async function normalizeMappingPath(value: string): Promise<string> {
	const absolute = resolve(expandHome(value));
	try {
		return await realpath(absolute);
	} catch {
		return absolute;
	}
}

async function findConfiguredRoute(
	projects: Record<string, ProjectRouteConfig> | undefined,
	repoRoot: string,
): Promise<ProjectRouteConfig> {
	if (!projects) return {};
	for (const [configuredRoot, route] of Object.entries(projects)) {
		if ((await normalizeMappingPath(configuredRoot)) === repoRoot) return route;
	}
	return {};
}

function boundedPositiveInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export async function resolveCaptureContext(
	cwd: string,
	sessionId: string,
	allowProjectConfig: boolean,
): Promise<ResolvedCaptureContext> {
	const configPath = resolve(expandHome(process.env.PI_OBSIDIAN_CAPTURE_CONFIG ?? DEFAULT_CONFIG_PATH));
	const config = await readJsonFile<CaptureConfig>(configPath, true);
	if (!config?.vault) throw new Error(`Missing required \"vault\" in ${configPath}`);

	const configuredVault = resolve(expandHome(config.vault));
	let vaultPath: string;
	try {
		vaultPath = await realpath(configuredVault);
		if (!(await stat(vaultPath)).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(`Configured Obsidian vault is not a directory: ${configuredVault}`);
	}

	const repoRoot = await findRepositoryRoot(cwd);
	const globalRoute = await findConfiguredRoute(config.projects, repoRoot);
	const localConfigPath = join(repoRoot, ".pi", "obsidian-capture.json");
	const localRoute = allowProjectConfig
		? ((await readJsonFile<ProjectLocalConfig>(localConfigPath, false)) ?? {})
		: {};

	const projectName =
		localRoute.project?.trim() || localRoute.name?.trim() || globalRoute.name?.trim() || basename(repoRoot);
	const projectSlug = slugify(projectName);
	const inboxFolder = safeRelativePath(config.inboxFolder ?? DEFAULT_INBOX_FOLDER, "inboxFolder");
	const projectsFolder = safeRelativePath(config.projectsFolder ?? DEFAULT_PROJECTS_FOLDER, "projectsFolder");
	const projectFolder = safeRelativePath(
		localRoute.folder ?? globalRoute.folder ?? `${projectsFolder}/${projectName}`,
		"project folder",
	);
	const mocRelativePath =
		localRoute.moc ?? globalRoute.moc ?? `${projectFolder}/${sanitizeNoteTitle(projectName)} MOC.md`;
	safeRelativePath(mocRelativePath, "MOC path");

	const date = localDateString();
	const sessionShortId = sessionId.replaceAll("-", "").slice(0, 8) || "ephemeral";
	const rawNoteRelativePath = `${inboxFolder}/${date}-${projectSlug}-${sessionShortId}.md`;
	const rawNotePath = resolveVaultRelativePath(vaultPath, rawNoteRelativePath);
	const projectTags = normalizeTags(localRoute.tags ?? globalRoute.tags, [projectSlug, "pi-session"]);

	return {
		configPath,
		vaultPath,
		repoRoot,
		projectName,
		projectSlug,
		projectFolder,
		projectTags,
		mocRelativePath,
		autoCapture: localRoute.autoCapture ?? globalRoute.autoCapture ?? config.autoCapture ?? true,
		maxMessageChars: boundedPositiveInt(
			config.maxMessageChars,
			DEFAULT_MAX_MESSAGE_CHARS,
			1_000,
			500_000,
		),
		distillMaxChars: boundedPositiveInt(
			config.distillMaxChars,
			DEFAULT_DISTILL_MAX_CHARS,
			10_000,
			1_000_000,
		),
		rawNoteRelativePath,
		rawNotePath,
		sessionId,
	};
}
