import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import { buildConversationExchanges, exchangeMarker, formatExchange } from "./conversation.ts";
import { localDateString, yamlString } from "./config.ts";
import type { CaptureResult, MessageEntry, ResolvedCaptureContext } from "./types.ts";

async function readOptional(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, content, "utf8");
		await rename(temporaryPath, filePath);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

function rawNoteHeader(context: ResolvedCaptureContext): string {
	const tags = [...new Set([...context.projectTags, "pi-session", "raw-capture"])];
	const tagLines = tags.map((tag) => `  - ${yamlString(tag)}`).join("\n");
	const sessionFileLine = context.sessionFile ? `\npi_session_file: ${yamlString(context.sessionFile)}` : "";
	return [
		"---",
		"type: pi-session",
		"capture_mode: raw",
		`project: ${yamlString(context.projectName)}`,
		`repo: ${yamlString(context.repoRoot)}`,
		`session_id: ${yamlString(context.sessionId)}`,
		`created: ${localDateString()}`,
		"tags:",
		tagLines,
		`source: pi${sessionFileLine}`,
		"---",
		"",
		`# Pi Session — ${context.projectName} — ${localDateString()}`,
		"",
		"> [!info] Raw provenance",
		"> Finalized user prompts and assistant answers only. Thinking and tool-result payloads are intentionally excluded.",
		"",
	].join("\n");
}

export async function captureUnseenExchanges(
	context: ResolvedCaptureContext,
	entries: MessageEntry[],
): Promise<CaptureResult> {
	const exchanges = buildConversationExchanges(entries, context.maxMessageChars);
	if (exchanges.length === 0) {
		return {
			path: context.rawNotePath,
			relativePath: context.rawNoteRelativePath,
			captured: 0,
			skipped: 0,
		};
	}

	return withFileMutationQueue(context.rawNotePath, async () => {
		const existing = await readOptional(context.rawNotePath);
		const unseen = exchanges.filter((exchange) => !existing.includes(exchangeMarker(exchange)));
		if (unseen.length === 0) {
			return {
				path: context.rawNotePath,
				relativePath: context.rawNoteRelativePath,
				captured: 0,
				skipped: exchanges.length,
			};
		}

		const prefix = existing || rawNoteHeader(context);
		const separator = prefix.endsWith("\n") ? "\n" : "\n\n";
		const appended = unseen.map(formatExchange).join("\n\n---\n\n");
		await atomicWrite(context.rawNotePath, `${prefix}${separator}${appended}\n`);
		return {
			path: context.rawNotePath,
			relativePath: context.rawNoteRelativePath,
			captured: unseen.length,
			skipped: exchanges.length - unseen.length,
		};
	});
}
