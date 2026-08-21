import type { ConversationExchange, MessageEntry, UserPrompt } from "./types.ts";

const CONTROL_COMMAND = /^\/(?:note|note-status|note-auto|distill)(?:\s|$)/i;

function extractText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	return content
		.filter(
			(block): block is { type: string; text: string } =>
				Boolean(block) &&
				typeof block === "object" &&
				(block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function boundedText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const suffix = "\n\n[… truncated by obsidian-capture …]";
	const tailLength = Math.min(2_000, Math.floor(maxChars * 0.15));
	const headLength = Math.max(0, maxChars - tailLength - suffix.length);
	return `${text.slice(0, headLength)}${suffix}\n\n${text.slice(-tailLength)}`;
}

function entryTimestamp(entry: MessageEntry): string | undefined {
	if (entry.timestamp) return entry.timestamp;
	const timestamp = entry.message?.timestamp;
	return typeof timestamp === "number" ? new Date(timestamp).toISOString() : undefined;
}

export function buildConversationExchanges(entries: MessageEntry[], maxMessageChars: number): ConversationExchange[] {
	const exchanges: ConversationExchange[] = [];
	let pendingUsers: UserPrompt[] = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.id || !entry.message?.role) continue;

		if (entry.message.role === "user") {
			const text = extractText(entry.message.content);
			if (!text || CONTROL_COMMAND.test(text)) continue;
			pendingUsers.push({
				id: entry.id,
				text: boundedText(text, maxMessageChars),
				timestamp: entryTimestamp(entry),
			});
			continue;
		}

		if (entry.message.role !== "assistant") continue;
		if (entry.message.stopReason !== "stop" && entry.message.stopReason !== "length") continue;

		const assistantText = extractText(entry.message.content);
		if (!assistantText || pendingUsers.length === 0) continue;
		exchanges.push({
			assistantId: entry.id,
			assistantText: boundedText(assistantText, maxMessageChars),
			assistantTimestamp: entryTimestamp(entry),
			userPrompts: pendingUsers,
		});
		pendingUsers = [];
	}

	return exchanges;
}

export function exchangeMarker(exchange: ConversationExchange): string {
	return `<!-- pi-capture:assistant=${exchange.assistantId} -->`;
}

export function formatExchange(exchange: ConversationExchange): string {
	const timestamp = exchange.assistantTimestamp ?? exchange.userPrompts.at(-1)?.timestamp ?? new Date().toISOString();
	const userSections = exchange.userPrompts
		.map((prompt, index) => {
			const heading = exchange.userPrompts.length === 1 ? "### Question" : `### User prompt ${index + 1}`;
			return `${heading}\n\n${prompt.text}`;
		})
		.join("\n\n");

	return [
		exchangeMarker(exchange),
		`## ${timestamp}`,
		userSections,
		"### Answer",
		exchange.assistantText,
	].join("\n\n");
}

export function buildDistillationSource(exchanges: ConversationExchange[], maxChars: number): string {
	const sections = exchanges.map((exchange) => {
		const users = exchange.userPrompts.map((prompt) => `User: ${prompt.text}`).join("\n\n");
		return `${users}\n\nAssistant: ${exchange.assistantText}`;
	});
	const full = sections.join("\n\n---\n\n");
	if (full.length <= maxChars) return full;
	return `[Earlier conversation omitted to stay within the distillation budget.]\n\n${full.slice(-maxChars)}`;
}
