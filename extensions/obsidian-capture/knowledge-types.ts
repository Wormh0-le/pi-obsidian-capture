export type KnowledgeAccess = "index" | "sections" | "search" | "full";

export type KnowledgeRelation =
	| "official-implementation"
	| "reproduces"
	| "reference-implementation"
	| "background"
	| "validates"
	| "inspired-by"
	| "project-memory";

export interface KnowledgeVaultConfig {
	schemaVersion?: number;
	vaults: Record<string, string>;
	defaults?: Partial<KnowledgeBudget> & {
		broadObsidianTools?: boolean;
	};
}

export interface KnowledgeBudget {
	startupChars: number;
	maxSearchResults: number;
	maxReadChars: number;
	maxFilesPerSource: number;
}

export interface KnowledgeSourceConfig {
	id: string;
	vault: string;
	path: string;
	relation: KnowledgeRelation;
	access: KnowledgeAccess;
	sections?: string[];
}

export interface KnowledgeManifest {
	schemaVersion?: number;
	project?: string;
	engineering?: {
		folder: string;
	};
	sources?: KnowledgeSourceConfig[];
	budget?: Partial<KnowledgeBudget>;
}

export interface ResolvedKnowledgeSource extends KnowledgeSourceConfig {
	vaultPath: string;
	absolutePath: string;
	kind: "note" | "directory";
}

export interface ResolvedKnowledgeContext {
	globalConfigPath: string;
	manifestPath: string;
	projectName: string;
	repoRoot: string;
	budget: KnowledgeBudget;
	broadObsidianTools: boolean;
	vaults: Record<string, string>;
	sources: ResolvedKnowledgeSource[];
}

export interface KnowledgeSearchResult {
	ref: string;
	sourceId: string;
	vault: string;
	path: string;
	relation: KnowledgeRelation;
	title: string;
	heading?: string;
	snippet: string;
	score: number;
}

export interface KnowledgeReadResult {
	ref: string;
	sourceId: string;
	vault: string;
	path: string;
	relation: KnowledgeRelation;
	title: string;
	heading?: string;
	content: string;
	truncated: boolean;
}

export type KnowledgeBudgetName = "small" | "standard" | "expanded";

export interface KnowledgeSessionState {
	broadObsidianToolsEnabled?: boolean;
}

export const KNOWLEDGE_PROVENANCE_ENTRY = "project-knowledge-provenance";

export interface KnowledgeProvenanceReference {
	ref: string;
	vault: string;
	path: string;
	relation: KnowledgeRelation;
	heading?: string;
}
