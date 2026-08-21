import { readFile } from "node:fs/promises";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import { atomicWrite } from "./capture.ts";
import { buildConversationExchanges, buildDistillationSource } from "./conversation.ts";
import {
	localDateString,
	resolveVaultRelativePath,
	sanitizeNoteTitle,
	yamlString,
} from "./config.ts";
import {
	KNOWLEDGE_PROVENANCE_ENTRY,
	type KnowledgeProvenanceReference,
} from "./knowledge-types.ts";
import type { MessageEntry, ResolvedCaptureContext } from "./types.ts";

export interface DistillResult {
	path: string;
	relativePath: string;
	title: string;
	updatedMoc: boolean;
}

async function readOptional(filePath: string): Promise<string | undefined> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function stripModelWrapper(markdown: string): string {
	let body = markdown.trim();
	const fenced = body.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
	if (fenced) body = fenced[1]!.trim();
	if (body.startsWith("---\n")) {
		const end = body.indexOf("\n---\n", 4);
		if (end >= 0) body = body.slice(end + 5).trim();
	}
	return body;
}

function buildPrompt(source: string, title: string, context: ResolvedCaptureContext): string {
	return [
		"你是一名严谨的工程知识编辑。请把下面的 Pi 会话提炼成可长期维护的中文 Obsidian 技术笔记。",
		"",
		"要求：",
		"- 只记录会话中有依据的内容，不补写未验证事实。",
		"- 合并重复结论，保留关键理由、限制、风险和待验证事项。",
		"- 明确区分稳定公共 API、内部实现细节、实验性能力和迁移假设。",
		"- 文件路径、类名、函数名和命令使用反引号。",
		"- 使用简洁、可扫读的中文技术写作。",
		`- 第一行必须是且只能是：# ${title}`,
		"- 不要输出 YAML frontmatter，不要使用包围整篇内容的代码围栏。",
		"- 视内容需要使用：核心结论、心智模型、关键流程、接口与数据契约、决策与理由、限制与风险、待验证事项、源码线索。空章节省略。",
		"",
		`项目：${context.projectName}`,
		`仓库：${context.repoRoot}`,
		`Pi session：${context.sessionId}`,
		"",
		"<conversation>",
		source,
		"</conversation>",
	].join("\n");
}

function extractKnowledgeReferences(entries: MessageEntry[]): KnowledgeProvenanceReference[] {
	const references = new Map<string, KnowledgeProvenanceReference>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== KNOWLEDGE_PROVENANCE_ENTRY) continue;
		const data = entry.data as { refs?: KnowledgeProvenanceReference[] } | undefined;
		for (const reference of data?.refs ?? []) {
			if (!reference?.ref || !reference.vault || !reference.path) continue;
			const key = `${reference.vault}:${reference.path}#${reference.heading ?? ""}`;
			references.set(key, reference);
		}
	}
	return [...references.values()];
}

function buildNote(
	context: ResolvedCaptureContext,
	title: string,
	body: string,
	knowledgeReferences: KnowledgeProvenanceReference[],
): string {
	const tags = [...new Set([...context.projectTags, "distilled", "knowledge-note"])];
	const tagLines = tags.map((tag) => `  - ${yamlString(tag)}`).join("\n");
	const contentWithoutLeadingTitle = body.replace(/^#\s+[^\n]+\n*/u, "").trim();
	const normalizedBody = `# ${title}${contentWithoutLeadingTitle ? `\n\n${contentWithoutLeadingTitle}` : ""}`;
	const knowledgeLines = knowledgeReferences.length > 0
		? [
			"- Linked knowledge used:",
			...knowledgeReferences.map(
				(reference) =>
					`  - \`${reference.vault}:${reference.path}${reference.heading ? `#${reference.heading}` : ""}\` · ${reference.relation} · ref \`${reference.ref}\``,
			),
		]
		: [];
	return [
		"---",
		"type: knowledge-note",
		`project: ${yamlString(context.projectName)}`,
		`repo: ${yamlString(context.repoRoot)}`,
		`source_session: ${yamlString(context.sessionId)}`,
		`created: ${localDateString()}`,
		"tags:",
		tagLines,
		"source: pi-distill",
		"---",
		"",
		normalizedBody.trim(),
		"",
		"## Provenance",
		"",
		`- Raw session: [[${context.rawNoteRelativePath.replace(/\.md$/i, "")}]]`,
		`- Repository: \`${context.repoRoot}\``,
		`- Pi session: \`${context.sessionId}\``,
		...knowledgeLines,
		"",
	].join("\n");
}

async function addMocLink(
	context: ResolvedCaptureContext,
	noteRelativePath: string,
	title: string,
): Promise<boolean> {
	if (!context.mocRelativePath) return false;
	const mocPath = resolveVaultRelativePath(context.vaultPath, context.mocRelativePath);
	return withFileMutationQueue(mocPath, async () => {
		const current = await readOptional(mocPath);
		if (current === undefined) return false;

		const target = noteRelativePath.replace(/\.md$/i, "").replaceAll("\\", "/");
		if (current.includes(`[[${target}`)) return false;
		const link = `- [[${target}|${title}]]`;
		const heading = "## Curated knowledge";
		const headingIndex = current.indexOf(heading);
		let next: string;
		if (headingIndex >= 0) {
			const lineEnd = current.indexOf("\n", headingIndex + heading.length);
			const insertionPoint = lineEnd >= 0 ? lineEnd + 1 : current.length;
			next = `${current.slice(0, insertionPoint)}\n${link}\n\n${current.slice(insertionPoint).replace(/^\n+/, "")}`;
		} else {
			next = `${current.trimEnd()}\n\n${heading}\n\n${link}\n`;
		}
		await atomicWrite(mocPath, next);
		return true;
	});
}

export async function distillConversation(
	context: ResolvedCaptureContext,
	entries: MessageEntry[],
	commandContext: ExtensionCommandContext,
	requestedTitle?: string,
	force = false,
): Promise<DistillResult> {
	const model = commandContext.model;
	if (!model) throw new Error("No active model is available for distillation");
	if (!commandContext.modelRegistry.hasConfiguredAuth(model)) {
		throw new Error(`No authentication configured for ${model.provider}/${model.id}`);
	}

	const exchanges = buildConversationExchanges(entries, context.maxMessageChars);
	if (exchanges.length === 0) throw new Error("No completed user/assistant exchanges found to distill");

	const date = localDateString();
	const sessionShortId = context.sessionId.replaceAll("-", "").slice(0, 8) || "ephemeral";
	const title = sanitizeNoteTitle(requestedTitle || `${context.projectName} 会话提炼 ${date}`);
	const noteRelativePath = requestedTitle
		? `${context.projectFolder}/${title}.md`
		: `${context.projectFolder}/Distillations/${date} Session ${sessionShortId}.md`;
	const notePath = resolveVaultRelativePath(context.vaultPath, noteRelativePath);
	const existing = await readOptional(notePath);
	if (existing !== undefined && !force) {
		if (!commandContext.hasUI) {
			throw new Error(`Note already exists: ${noteRelativePath}. Re-run with --force to replace it.`);
		}
		const confirmed = await commandContext.ui.confirm(
			"Replace distilled note?",
			`${noteRelativePath} already exists. Replace it with a fresh distillation?`,
		);
		if (!confirmed) throw new Error("Distillation cancelled");
	}

	const source = buildDistillationSource(exchanges, context.distillMaxChars);
	const response = await commandContext.modelRegistry.complete(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: buildPrompt(source, title, context) }],
					timestamp: Date.now(),
				},
			],
		},
		{
			cacheRetention: "none",
			sessionId: uuidv7(),
		},
	);
	const body = stripModelWrapper(
		response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n"),
	);
	if (!body) throw new Error("The distillation model returned no Markdown content");

	const knowledgeReferences = extractKnowledgeReferences(entries);
	await withFileMutationQueue(notePath, async () => {
		await atomicWrite(notePath, buildNote(context, title, body, knowledgeReferences));
	});
	const updatedMoc = await addMocLink(context, noteRelativePath, title);
	return { path: notePath, relativePath: noteRelativePath, title, updatedMoc };
}
