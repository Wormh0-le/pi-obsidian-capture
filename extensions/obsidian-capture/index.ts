import { readFile } from "node:fs/promises";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { captureUnseenExchanges } from "./capture.ts";
import { buildConversationExchanges, exchangeMarker } from "./conversation.ts";
import { resolveCaptureContext } from "./config.ts";
import { distillConversation } from "./distill.ts";
import { registerKnowledgeFeatures } from "./knowledge-extension.ts";
import type {
	ExtensionSessionState,
	MessageEntry,
	ResolvedCaptureContext,
} from "./types.ts";

const STATE_TYPE = "obsidian-capture-state";
const STATUS_KEY = "obsidian-capture";

async function readOptional(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}
}

function parseDistillArgs(args: string): { title?: string; force: boolean } {
	const force = /(?:^|\s)--force(?:\s|$)/.test(args);
	const title = args
		.replace(/(?:^|\s)--force(?=\s|$)/g, " ")
		.trim()
		.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_match, doubleQuoted, singleQuoted) =>
			doubleQuoted ?? singleQuoted,
		)
		.trim();
	return { title: title || undefined, force };
}

export default function obsidianCaptureExtension(pi: ExtensionAPI) {
	registerKnowledgeFeatures(pi);

	let autoOverride: boolean | undefined;
	let lastAutomaticError: string | undefined;

	const resolveContext = async (ctx: ExtensionContext): Promise<ResolvedCaptureContext> => {
		const resolved = await resolveCaptureContext(
			ctx.cwd,
			ctx.sessionManager.getSessionId(),
			ctx.isProjectTrusted(),
		);
		resolved.sessionFile = ctx.sessionManager.getSessionFile();
		return resolved;
	};

	const isAutoEnabled = (resolved: ResolvedCaptureContext): boolean => autoOverride ?? resolved.autoCapture;

	const updateStatus = (ctx: ExtensionContext, resolved: ResolvedCaptureContext): void => {
		const mode = isAutoEnabled(resolved) ? "auto" : "manual";
		ctx.ui.setStatus(STATUS_KEY, `📝 ${resolved.projectSlug} · ${mode}`);
	};

	const captureCurrent = async (
		ctx: ExtensionContext,
		notify: boolean,
	): Promise<void> => {
		const resolved = await resolveContext(ctx);
		const entries = ctx.sessionManager.getBranch() as MessageEntry[];
		const result = await captureUnseenExchanges(resolved, entries);
		updateStatus(ctx, resolved);
		lastAutomaticError = undefined;
		if (!notify) return;
		if (result.captured > 0) {
			ctx.ui.notify(
				`Captured ${result.captured} exchange${result.captured === 1 ? "" : "s"} → ${result.relativePath}`,
				"info",
			);
		} else {
			ctx.ui.notify(`No uncaptured exchanges. Current note: ${result.relativePath}`, "info");
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		autoOverride = undefined;
		for (const entry of ctx.sessionManager.getBranch() as MessageEntry[]) {
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
			const data = entry.data as ExtensionSessionState | undefined;
			if (typeof data?.autoEnabled === "boolean") autoOverride = data.autoEnabled;
		}
		try {
			updateStatus(ctx, await resolveContext(ctx));
		} catch (error) {
			ctx.ui.setStatus(STATUS_KEY, "📝 config error");
			ctx.ui.notify((error as Error).message, "error");
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		try {
			const resolved = await resolveContext(ctx);
			updateStatus(ctx, resolved);
			if (!isAutoEnabled(resolved)) return;
			await captureCurrent(ctx, false);
		} catch (error) {
			const message = (error as Error).message;
			ctx.ui.setStatus(STATUS_KEY, "📝 sync error");
			if (message !== lastAutomaticError) {
				ctx.ui.notify(`Obsidian capture failed: ${message}`, "error");
				lastAutomaticError = message;
			}
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			const resolved = await resolveContext(ctx);
			if (isAutoEnabled(resolved)) await captureCurrent(ctx, false);
		} catch {
			// Shutdown is a best-effort fallback; agent_settled reports actionable errors.
		}
	});

	pi.registerCommand("note-status", {
		description: "Show Obsidian capture routing and pending exchange count",
		handler: async (_args, ctx) => {
			try {
				const resolved = await resolveContext(ctx);
				const existing = await readOptional(resolved.rawNotePath);
				const exchanges = buildConversationExchanges(
					ctx.sessionManager.getBranch() as MessageEntry[],
					resolved.maxMessageChars,
				);
				const pending = exchanges.filter((exchange) => !existing.includes(exchangeMarker(exchange))).length;
				updateStatus(ctx, resolved);
				ctx.ui.notify(
					[
						`Project: ${resolved.projectName}`,
						`Repository: ${resolved.repoRoot}`,
						`Vault: ${resolved.vaultPath}`,
						`Raw note: ${resolved.rawNoteRelativePath}`,
						`Mode: ${isAutoEnabled(resolved) ? "automatic" : "manual"}`,
						`Pending exchanges: ${pending}`,
					].join("\n"),
					"info",
				);
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});

	pi.registerCommand("note", {
		description: "Capture all completed, uncaptured exchanges to the raw session note",
		handler: async (_args, ctx) => {
			try {
				await captureCurrent(ctx, true);
			} catch (error) {
				ctx.ui.notify(`Obsidian capture failed: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("note-auto", {
		description: "Enable, disable, or inspect automatic Obsidian capture for this Pi session",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const choices = ["on", "off", "status"];
			const matches = choices
				.filter((choice) => choice.startsWith(prefix.trim().toLowerCase()))
				.map((choice) => ({ value: choice, label: choice }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			try {
				const resolved = await resolveContext(ctx);
				const action = args.trim().toLowerCase() || "status";
				if (action === "on" || action === "off") {
					autoOverride = action === "on";
					pi.appendEntry(STATE_TYPE, { autoEnabled: autoOverride } satisfies ExtensionSessionState);
				} else if (action !== "status") {
					ctx.ui.notify("Usage: /note-auto on|off|status", "warning");
					return;
				}
				updateStatus(ctx, resolved);
				ctx.ui.notify(
					`Automatic Obsidian capture is ${isAutoEnabled(resolved) ? "ON" : "OFF"} for this session.`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});

	pi.registerCommand("distill", {
		description: "Distill the current branch into a curated project note; optional argument sets the note title",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const { title, force } = parseDistillArgs(args);
			try {
				const resolved = await resolveContext(ctx);
				await captureUnseenExchanges(
					resolved,
					ctx.sessionManager.getBranch() as MessageEntry[],
				);
				ctx.ui.setStatus(STATUS_KEY, `📝 ${resolved.projectSlug} · distilling`);
				ctx.ui.notify("Distilling the current Pi branch…", "info");
				const result = await distillConversation(
					resolved,
					ctx.sessionManager.getBranch() as MessageEntry[],
					ctx,
					title,
					force,
				);
				ctx.ui.notify(
					`Created curated note → ${result.relativePath}${result.updatedMoc ? " (MOC linked)" : ""}`,
					"info",
				);
				updateStatus(ctx, resolved);
			} catch (error) {
				ctx.ui.notify(`Distillation failed: ${(error as Error).message}`, "error");
				try {
					updateStatus(ctx, await resolveContext(ctx));
				} catch {
					ctx.ui.setStatus(STATUS_KEY, "📝 config error");
				}
			}
		},
	});
}
