export interface ProjectRouteConfig {
	name?: string;
	folder?: string;
	tags?: string[];
	moc?: string;
	autoCapture?: boolean;
}

export interface CaptureConfig {
	schemaVersion?: number;
	vault: string;
	inboxFolder?: string;
	projectsFolder?: string;
	autoCapture?: boolean;
	maxMessageChars?: number;
	distillMaxChars?: number;
	projects?: Record<string, ProjectRouteConfig>;
}

export interface ProjectLocalConfig extends ProjectRouteConfig {
	project?: string;
}

export interface ResolvedCaptureContext {
	configPath: string;
	vaultPath: string;
	repoRoot: string;
	projectName: string;
	projectSlug: string;
	projectFolder: string;
	projectTags: string[];
	mocRelativePath?: string;
	autoCapture: boolean;
	maxMessageChars: number;
	distillMaxChars: number;
	rawNoteRelativePath: string;
	rawNotePath: string;
	sessionId: string;
	sessionFile?: string;
}

export interface MessageEntry {
	type: string;
	id?: string;
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		stopReason?: string;
		timestamp?: number;
	};
	customType?: string;
	data?: unknown;
}

export interface UserPrompt {
	id: string;
	text: string;
	timestamp?: string;
}

export interface ConversationExchange {
	assistantId: string;
	assistantText: string;
	assistantTimestamp?: string;
	userPrompts: UserPrompt[];
}

export interface CaptureResult {
	path: string;
	relativePath: string;
	captured: number;
	skipped: number;
}

export interface ExtensionSessionState {
	autoEnabled?: boolean;
}
