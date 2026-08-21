import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
	KnowledgeBudgetName,
	KnowledgeReadResult,
	KnowledgeSearchResult,
	ResolvedKnowledgeContext,
	ResolvedKnowledgeSource,
} from "./knowledge-types.ts";

const INDEX_PREFIX_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 2_000_000;

interface HeadingRange {
	level: number;
	title: string;
	start: number;
	bodyStart: number;
	end: number;
}

interface DocumentView {
	content: string;
	title: string;
	headings: HeadingRange[];
}

function budgetScale(name: KnowledgeBudgetName | undefined): number {
	if (name === "small") return 0.4;
	if (name === "expanded") return 1;
	return 0.7;
}

function resultLimit(context: ResolvedKnowledgeContext, name: KnowledgeBudgetName | undefined): number {
	return Math.max(1, Math.floor(context.budget.maxSearchResults * budgetScale(name)));
}

function readLimit(context: ResolvedKnowledgeContext, name: KnowledgeBudgetName | undefined): number {
	return Math.max(1_000, Math.floor(context.budget.maxReadChars * budgetScale(name)));
}

async function readPrefix(filePath: string, maxBytes: number): Promise<string> {
	const handle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

async function readBoundedFile(filePath: string, indexOnly: boolean): Promise<string> {
	return readPrefix(filePath, indexOnly ? INDEX_PREFIX_BYTES : MAX_FILE_BYTES);
}

function parseHeadings(content: string): HeadingRange[] {
	const matches = [...content.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)];
	return matches.map((match, index) => {
		const level = match[1]!.length;
		const start = match.index ?? 0;
		const bodyStart = start + match[0].length;
		let end = content.length;
		for (let next = index + 1; next < matches.length; next += 1) {
			const candidate = matches[next]!;
			if (candidate[1]!.length <= level) {
				end = candidate.index ?? content.length;
				break;
			}
		}
		return { level, title: match[2]!.trim(), start, bodyStart, end };
	});
}

function frontmatterTitle(content: string): string | undefined {
	if (!content.startsWith("---\n")) return undefined;
	const end = content.indexOf("\n---\n", 4);
	if (end < 0) return undefined;
	const match = content.slice(4, end).match(/^title:\s*(.+?)\s*$/m);
	return match?.[1]?.replace(/^['"]|['"]$/g, "").trim();
}

function documentView(content: string, filePath: string): DocumentView {
	const headings = parseHeadings(content);
	const title = frontmatterTitle(content) ?? headings.find((heading) => heading.level === 1)?.title ?? basename(filePath, ".md");
	return { content, title, headings };
}

function normalizeHeading(value: string): string {
	return value.normalize("NFKC").trim().toLowerCase();
}

function findHeading(view: DocumentView, requested: string): HeadingRange | undefined {
	const normalized = normalizeHeading(requested);
	return view.headings.find((heading) => normalizeHeading(heading.title) === normalized);
}

function sectionText(view: DocumentView, heading: HeadingRange): string {
	return view.content.slice(heading.start, heading.end).trim();
}

function sectionAtOffset(view: DocumentView, offset: number): HeadingRange | undefined {
	return [...view.headings].reverse().find((heading) => heading.start <= offset);
}

function queryTerms(query: string): string[] {
	const normalized = query.normalize("NFKC").trim().toLowerCase();
	const words = normalized.split(/[^\p{Letter}\p{Number}_-]+/u).filter((word) => word.length >= 2);
	return [...new Set([normalized, ...words].filter(Boolean))];
}

function occurrences(haystack: string, needle: string, cap = 3): number {
	let count = 0;
	let offset = 0;
	while (count < cap) {
		const found = haystack.indexOf(needle, offset);
		if (found < 0) break;
		count += 1;
		offset = found + Math.max(1, needle.length);
	}
	return count;
}

function scoreDocument(
	terms: string[],
	title: string,
	path: string,
	headings: string,
	body: string,
): number {
	const lowerTitle = title.toLowerCase();
	const lowerPath = path.toLowerCase();
	const lowerHeadings = headings.toLowerCase();
	const lowerBody = body.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (lowerTitle.includes(term)) score += 12;
		if (lowerPath.includes(term)) score += 8;
		if (lowerHeadings.includes(term)) score += 6;
		score += occurrences(lowerBody, term) * 2;
	}
	return score;
}

function firstMatchOffset(content: string, terms: string[]): number {
	const lower = content.toLowerCase();
	let best = -1;
	for (const term of terms) {
		const index = lower.indexOf(term);
		if (index >= 0 && (best < 0 || index < best)) best = index;
	}
	return best;
}

function makeSnippet(content: string, terms: string[], maxChars: number): string {
	const match = firstMatchOffset(content, terms);
	const center = match >= 0 ? match : 0;
	const start = Math.max(0, center - Math.floor(maxChars * 0.25));
	const end = Math.min(content.length, start + maxChars);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < content.length ? "…" : "";
	return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function sourceRelativePath(source: ResolvedKnowledgeSource, filePath: string): string {
	return relative(source.vaultPath, filePath).replaceAll("\\", "/");
}

function encodedRef(source: ResolvedKnowledgeSource, filePath: string, heading?: string): string {
	const filePart = source.kind === "directory"
		? `::${relative(source.absolutePath, filePath).replaceAll("\\", "/")}`
		: "";
	const headingPart = heading ? `#${encodeURIComponent(heading)}` : "";
	return `${source.id}${filePart}${headingPart}`;
}

async function listSourceFiles(
	source: ResolvedKnowledgeSource,
	maxFiles: number,
): Promise<string[]> {
	if (source.kind === "note") return [source.absolutePath];
	const files: string[] = [];
	const pending = [source.absolutePath];
	while (pending.length > 0 && files.length < maxFiles) {
		const current = pending.pop();
		if (!current) break;
		const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
			const child = resolve(current, entry.name);
			if (entry.isDirectory()) pending.push(child);
			else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(child);
			if (files.length >= maxFiles) break;
		}
	}
	return files;
}

function selectedSections(view: DocumentView, source: ResolvedKnowledgeSource): Array<{ heading: HeadingRange; text: string }> {
	if (source.access !== "sections") return [];
	return (source.sections ?? [])
		.map((name) => findHeading(view, name))
		.filter((heading): heading is HeadingRange => Boolean(heading))
		.map((heading) => ({ heading, text: sectionText(view, heading) }));
}

function searchBody(view: DocumentView, source: ResolvedKnowledgeSource): string {
	if (source.access === "index") return "";
	if (source.access === "sections") return selectedSections(view, source).map(({ text }) => text).join("\n\n");
	return view.content;
}

export async function searchKnowledge(
	context: ResolvedKnowledgeContext,
	query: string,
	budgetName?: KnowledgeBudgetName,
): Promise<KnowledgeSearchResult[]> {
	const terms = queryTerms(query);
	if (terms.length === 0) throw new Error("project_knowledge search requires a non-empty query");
	const candidates: KnowledgeSearchResult[] = [];
	const snippetChars = budgetName === "small" ? 280 : budgetName === "expanded" ? 700 : 480;

	for (const source of context.sources) {
		const files = await listSourceFiles(source, context.budget.maxFilesPerSource);
		for (const filePath of files) {
			const content = await readBoundedFile(filePath, source.access === "index");
			const view = documentView(content, filePath);
			const path = sourceRelativePath(source, filePath);
			const headingsText = (source.access === "sections"
				? selectedSections(view, source).map(({ heading }) => heading.title)
				: view.headings.map((heading) => heading.title)
			).join("\n");
			const body = searchBody(view, source);
			const score = scoreDocument(terms, view.title, path, headingsText, body);
			if (score <= 0) continue;

			const searchable = source.access === "index" ? `${view.title}\n${headingsText}\n${path}` : body;
			const matchOffset = firstMatchOffset(searchable, terms);
			let matchedHeading: HeadingRange | undefined;
			if (source.access === "index") {
				matchedHeading = view.headings.find((heading) =>
					terms.some((term) => heading.title.toLowerCase().includes(term)),
				);
			} else if (source.access === "sections") {
				matchedHeading = selectedSections(view, source).find(({ text }) => firstMatchOffset(text, terms) >= 0)?.heading;
			} else if (matchOffset >= 0) {
				matchedHeading = sectionAtOffset(view, matchOffset);
			}
			const heading = matchedHeading?.title;
			const snippetSource = source.access === "index"
				? `Title: ${view.title}\nHeadings: ${headingsText}`
				: searchable;
			candidates.push({
				ref: encodedRef(source, filePath, heading),
				sourceId: source.id,
				vault: source.vault,
				path,
				relation: source.relation,
				title: view.title,
				heading,
				snippet: makeSnippet(snippetSource, terms, snippetChars),
				score,
			});
		}
	}

	return candidates
		.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
		.slice(0, resultLimit(context, budgetName));
}

function parseRef(ref: string): { sourceId: string; filePart?: string; heading?: string } {
	const hashIndex = ref.indexOf("#");
	const rawTarget = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
	const rawHeading = hashIndex >= 0 ? ref.slice(hashIndex + 1) : undefined;
	const separatorIndex = rawTarget.indexOf("::");
	const sourceId = separatorIndex >= 0 ? rawTarget.slice(0, separatorIndex) : rawTarget;
	const filePart = separatorIndex >= 0 ? rawTarget.slice(separatorIndex + 2) : undefined;
	if (!/^[a-z][a-z0-9._-]*$/i.test(sourceId)) throw new Error(`Invalid knowledge reference: ${ref}`);
	let heading: string | undefined;
	try {
		heading = rawHeading ? decodeURIComponent(rawHeading) : undefined;
	} catch {
		throw new Error(`Invalid encoded heading in knowledge reference: ${ref}`);
	}
	return { sourceId, filePart, heading };
}

async function resolveRefFile(
	source: ResolvedKnowledgeSource,
	filePart: string | undefined,
): Promise<string> {
	if (source.kind === "note") {
		if (filePart) throw new Error(`Reference for note source ${source.id} must not include a file path`);
		return source.absolutePath;
	}
	if (!filePart) throw new Error(`Reference for directory source ${source.id} must include a search result path`);
	if (isAbsolute(filePart) || filePart.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")) {
		throw new Error(`Unsafe file path in knowledge reference: ${source.id}::${filePart}`);
	}
	const candidate = resolve(source.absolutePath, filePart);
	const canonical = await realpath(candidate).catch(() => undefined);
	if (!canonical || !(await stat(canonical)).isFile() || extname(canonical).toLowerCase() !== ".md") {
		throw new Error(`Knowledge reference is not a Markdown file: ${source.id}::${filePart}`);
	}
	const rel = relative(source.absolutePath, canonical);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(`Knowledge reference escapes source ${source.id}`);
	}
	return canonical;
}

function metadataContent(view: DocumentView, path: string): string {
	const headings = view.headings.map((heading) => `${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.title}`).join("\n");
	return [`Title: ${view.title}`, `Path: ${path}`, "Headings:", headings || "- (none)"].join("\n");
}

function contentForRead(
	view: DocumentView,
	source: ResolvedKnowledgeSource,
	heading: string | undefined,
	path: string,
): { content: string; heading?: string } {
	if (source.access === "index") return { content: metadataContent(view, path) };
	if (source.access === "sections") {
		const allowed = new Map(
			selectedSections(view, source).map(({ heading: range, text }) => [normalizeHeading(range.title), { range, text }]),
		);
		if (allowed.size === 0) {
			throw new Error(`None of the configured sections were found in source ${source.id}`);
		}
		if (heading) {
			const selected = allowed.get(normalizeHeading(heading));
			if (!selected) throw new Error(`Section is outside the allowlist for source ${source.id}: ${heading}`);
			return { content: selected.text, heading: selected.range.title };
		}
		return { content: [...allowed.values()].map(({ text }) => text).join("\n\n"), heading: source.sections?.join(", ") };
	}
	if (heading) {
		const selected = findHeading(view, heading);
		if (!selected) throw new Error(`Heading not found in ${source.id}: ${heading}`);
		return { content: sectionText(view, selected), heading: selected.title };
	}
	if (source.kind === "directory" && source.access === "search") {
		return {
			content: `${metadataContent(view, path)}\n\nRead a search result reference containing #<heading> to load body text.`,
		};
	}
	return { content: view.content };
}

export async function readKnowledge(
	context: ResolvedKnowledgeContext,
	refs: string[],
	budgetName?: KnowledgeBudgetName,
): Promise<KnowledgeReadResult[]> {
	if (refs.length === 0) throw new Error("project_knowledge read requires at least one ref");
	if (refs.length > 10) throw new Error("project_knowledge read accepts at most 10 refs");
	let remaining = readLimit(context, budgetName);
	const results: KnowledgeReadResult[] = [];

	for (const ref of [...new Set(refs)]) {
		if (remaining <= 0) break;
		const parsed = parseRef(ref);
		const source = context.sources.find((candidate) => candidate.id === parsed.sourceId);
		if (!source) throw new Error(`Unknown knowledge source id: ${parsed.sourceId}`);
		const filePath = await resolveRefFile(source, parsed.filePart);
		const content = await readBoundedFile(filePath, source.access === "index");
		const view = documentView(content, filePath);
		const path = sourceRelativePath(source, filePath);
		const selected = contentForRead(view, source, parsed.heading, path);
		const truncated = selected.content.length > remaining;
		const truncationMarker = "\n\n[… project_knowledge budget exhausted …]";
		const bounded = truncated
			? `${selected.content.slice(0, Math.max(0, remaining - truncationMarker.length))}${truncationMarker}`
			: selected.content;
		remaining -= bounded.length;
		results.push({
			ref,
			sourceId: source.id,
			vault: source.vault,
			path,
			relation: source.relation,
			title: view.title,
			heading: selected.heading,
			content: bounded,
			truncated,
		});
	}
	return results;
}
