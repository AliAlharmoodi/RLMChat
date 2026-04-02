import { logger } from "$lib/server/logger";
import { config } from "$lib/server/config";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";

export type RlmSnapshotMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

type RlmRequestBase = {
	model: string;
	subcall_model?: string;
	base_url: string;
	api_key: string;
	root_prompt: string;
	context: string | Record<string, unknown> | unknown[];
	app_name?: string;
	public_origin?: string;
	max_depth: number;
	max_iterations: number;
	max_timeout?: number;
	max_budget?: number;
	max_errors?: number;
	max_concurrent_subcalls: number;
	abortSignal?: AbortSignal;
};

type SessionInitPayload = Omit<RlmRequestBase, "context" | "root_prompt" | "abortSignal"> & {
	command: "init";
	persistent: true;
	state_path?: string;
	model_fingerprint?: string;
};

type SessionCompletePayload = Pick<RlmRequestBase, "context" | "root_prompt"> & {
	command: "complete";
};

type SessionClosePayload = {
	command: "close";
};

type SessionResponse =
	| {
			ok: true;
			response?: string;
			execution_time?: number;
			root_model?: string;
			metadata?: Record<string, unknown> | null;
	  }
	| { ok: false; error: string };

type TraceResponse = {
	event: "trace";
	trace: import("../endpoints/endpoints").RlmTraceEvent;
};

const isTraceResponse = (response: SessionResponse | TraceResponse): response is TraceResponse =>
	"event" in response && response.event === "trace";

const isErrorSessionResponse = (
	response: SessionResponse | TraceResponse
): response is Extract<SessionResponse, { ok: false }> =>
	!isTraceResponse(response) && response.ok === false;

const isSuccessSessionResponse = (
	response: SessionResponse | TraceResponse
): response is Extract<SessionResponse, { ok: true }> =>
	!isTraceResponse(response) && response.ok === true;

type ConversationScopedRequest = Omit<RlmRequestBase, "context"> & {
	conversationId?: string;
	messages: RlmSnapshotMessage[];
	preprompt?: string;
	modelDisplayName: string;
	structuredContext: Record<string, unknown>;
	modelFingerprint: string;
};

type SessionState = {
	process: ChildProcessWithoutNullStreams;
	rl: ReadLineInterface;
	modelFingerprint: string;
	previousMessages: RlmSnapshotMessage[];
	previousPreprompt: string;
	queue: Promise<void>;
	idleTimer?: NodeJS.Timeout;
	statePath: string;
	metadataPath: string;
};

const DEFAULT_RLM_REPO_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
	"rlm"
);
const DEFAULT_RLM_DB_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../../db"
);

const SESSION_IDLE_MS = 15 * 60 * 1000;
const sessionMap = new Map<string, SessionState>();

const parsePositiveInt = (value: string | undefined, fallback: number) => {
	const parsed = Number.parseInt((value ?? "").trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePositiveFloat = (value: string | undefined) => {
	const trimmed = (value ?? "").trim();
	if (!trimmed) return undefined;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const resolveRlmPaths = () => {
	const repoPath = (Reflect.get(config, "RLM_REPO_PATH") as string | undefined)?.trim();
	const rlmRepoPath = repoPath || DEFAULT_RLM_REPO_PATH;
	const bridgePath = path.join(rlmRepoPath, "scripts", "chat_ui_bridge.py");

	if (!existsSync(rlmRepoPath)) {
		throw new Error(`RLM repository not found at ${rlmRepoPath}`);
	}

	if (!existsSync(bridgePath)) {
		throw new Error(`RLM bridge script not found at ${bridgePath}`);
	}

	return { rlmRepoPath, bridgePath };
};

const resolveApiKey = () => {
	const preferred = config.OPENAI_API_KEY || config.HF_TOKEN;
	if (preferred && !preferred.startsWith("#")) return preferred;

	return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.HF_TOKEN || "";
};

function getStateDir() {
	const dbRoot = config.MONGO_STORAGE_PATH
		? path.resolve(config.MONGO_STORAGE_PATH)
		: DEFAULT_RLM_DB_ROOT;
	return path.join(dbRoot, "rlm-sessions");
}

function getSessionPaths(conversationId: string) {
	const safeId = conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");
	const stateDir = getStateDir();
	return {
		statePath: path.join(stateDir, `${safeId}.pkl`),
		metadataPath: path.join(stateDir, `${safeId}.json`),
	};
}

async function loadDurableMetadata(
	conversationId: string,
	modelFingerprint: string
): Promise<{ previousMessages: RlmSnapshotMessage[]; previousPreprompt: string }> {
	const { metadataPath } = getSessionPaths(conversationId);
	try {
		const raw = await readFile(metadataPath, "utf8");
		const parsed = JSON.parse(raw) as {
			modelFingerprint?: string;
			previousMessages?: RlmSnapshotMessage[];
			previousPreprompt?: string;
		};
		if (parsed.modelFingerprint !== modelFingerprint) {
			return { previousMessages: [], previousPreprompt: "" };
		}
		return {
			previousMessages: parsed.previousMessages ?? [],
			previousPreprompt: parsed.previousPreprompt ?? "",
		};
	} catch {
		return { previousMessages: [], previousPreprompt: "" };
	}
}

async function saveDurableMetadata(session: SessionState): Promise<void> {
	await mkdir(path.dirname(session.metadataPath), { recursive: true });
	await writeFile(
		session.metadataPath,
		JSON.stringify(
			{
				modelFingerprint: session.modelFingerprint,
				previousMessages: session.previousMessages,
				previousPreprompt: session.previousPreprompt,
			},
			null,
			2
		),
		"utf8"
	);
}

function serializeMessage(message: RlmSnapshotMessage) {
	return `${message.role}\u0000${message.content}`;
}

function buildTranscriptContext(
	modelDisplayName: string,
	messages: RlmSnapshotMessage[],
	preprompt?: string
) {
	const parts: string[] = [
		"# CHAT TRANSCRIPT",
		`Target model: ${modelDisplayName}`,
		"",
		"The task is to produce the next assistant reply for this conversation.",
		"Treat the transcript below as the external context you can inspect programmatically in the REPL.",
	];

	if (preprompt?.trim()) {
		parts.push("", "## SYSTEM PROMPT", preprompt.trim());
	}

	for (const [index, message] of messages.entries()) {
		parts.push(
			"",
			`## MESSAGE ${index + 1}`,
			`ROLE: ${message.role.toUpperCase()}`,
			message.content
		);
	}

	return parts.join("\n");
}

function buildStructuredIncrementalContext(
	modelDisplayName: string,
	messages: RlmSnapshotMessage[],
	preprompt?: string
) {
	return {
		kind: "chat_ui_conversation_delta",
		target_model_display_name: modelDisplayName,
		system_prompt: preprompt?.trim() || "",
		messages: messages.map((message, index) => ({
			index,
			role: message.role,
			content: message.content,
		})),
	};
}

function isPrefix(prefix: RlmSnapshotMessage[], full: RlmSnapshotMessage[]) {
	if (prefix.length > full.length) return false;
	for (let i = 0; i < prefix.length; i += 1) {
		if (serializeMessage(prefix[i]) !== serializeMessage(full[i])) return false;
	}
	return true;
}

export function shouldResetPersistentSession(args: {
	previousPreprompt: string;
	nextPreprompt: string;
	previousMessages: RlmSnapshotMessage[];
	nextMessages: RlmSnapshotMessage[];
}) {
	return (
		args.previousPreprompt !== args.nextPreprompt ||
		!isPrefix(args.previousMessages, args.nextMessages)
	);
}

function enqueueSessionWork<T>(
	conversationId: string,
	session: SessionState,
	work: () => Promise<T>
): Promise<T> {
	const result = session.queue.then(work);
	session.queue = result.then(
		() => undefined,
		() => undefined
	);

	void result.then(
		() => {
			scheduleSessionClose(conversationId);
		},
		() => {
			scheduleSessionClose(conversationId);
		}
	);

	return result;
}

function scheduleSessionClose(conversationId: string) {
	const session = sessionMap.get(conversationId);
	if (!session) return;

	if (session.idleTimer) clearTimeout(session.idleTimer);
	session.idleTimer = setTimeout(() => {
		void closeSession(conversationId);
	}, SESSION_IDLE_MS);
}

async function readResponseLine(
	rl: ReadLineInterface,
	abortSignal?: AbortSignal
): Promise<SessionResponse | TraceResponse> {
	return await new Promise<SessionResponse | TraceResponse>((resolve, reject) => {
		const onLine = (line: string) => {
			cleanup();
			try {
				resolve(JSON.parse(line) as SessionResponse | TraceResponse);
			} catch {
				reject(new Error("RLM bridge returned invalid JSON"));
			}
		};

		const onAbort = () => {
			cleanup();
			const error = new Error("Request was aborted.");
			error.name = "AbortError";
			reject(error);
		};

		const cleanup = () => {
			rl.off("line", onLine);
			abortSignal?.removeEventListener("abort", onAbort);
		};

		rl.once("line", onLine);
		abortSignal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function sendSessionCommand(
	session: SessionState,
	command: SessionInitPayload | SessionCompletePayload | SessionClosePayload,
	abortSignal?: AbortSignal,
	onTrace?: (trace: import("../endpoints/endpoints").RlmTraceEvent) => void
) {
	session.process.stdin.write(`${JSON.stringify(command)}\n`);
	while (true) {
		const response = await readResponseLine(session.rl, abortSignal);
		if (isTraceResponse(response)) {
			onTrace?.(response.trace);
			continue;
		}

		if (isErrorSessionResponse(response)) {
			throw new Error(response.error);
		}

		if (isSuccessSessionResponse(response)) {
			return response;
		}
	}
}

async function createSession(
	conversationId: string,
	request: ConversationScopedRequest
): Promise<SessionState> {
	const { rlmRepoPath, bridgePath } = resolveRlmPaths();
	const { statePath, metadataPath } = getSessionPaths(conversationId);
	const durable = await loadDurableMetadata(conversationId, request.modelFingerprint);
	const child = spawn("uv", ["run", "--project", rlmRepoPath, "python", bridgePath, "--session"], {
		cwd: rlmRepoPath,
		env: process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});

	const rl = createInterface({ input: child.stdout });
	const session: SessionState = {
		process: child,
		rl,
		modelFingerprint: request.modelFingerprint,
		previousMessages: durable.previousMessages,
		previousPreprompt: durable.previousPreprompt,
		queue: Promise.resolve(),
		statePath,
		metadataPath,
	};

	child.stderr.on("data", (chunk) => {
		logger.warn({ conversationId, stderr: chunk.toString() }, "[rlm] bridge stderr");
	});

	child.on("exit", () => {
		const existing = sessionMap.get(conversationId);
		if (existing?.process === child) {
			sessionMap.delete(conversationId);
		}
	});

	await sendSessionCommand(session, {
		command: "init",
		persistent: true,
		model: request.model,
		subcall_model: request.subcall_model,
		base_url: request.base_url,
		api_key: request.api_key,
		app_name: request.app_name,
		public_origin: request.public_origin,
		max_depth: request.max_depth,
		max_iterations: request.max_iterations,
		max_timeout: request.max_timeout,
		max_budget: request.max_budget,
		max_errors: request.max_errors,
		max_concurrent_subcalls: request.max_concurrent_subcalls,
		state_path: statePath,
		model_fingerprint: request.modelFingerprint,
	});

	sessionMap.set(conversationId, session);
	scheduleSessionClose(conversationId);
	return session;
}

async function closeSession(conversationId: string) {
	const session = sessionMap.get(conversationId);
	if (!session) return;

	sessionMap.delete(conversationId);
	if (session.idleTimer) clearTimeout(session.idleTimer);

	try {
		await sendSessionCommand(session, { command: "close" });
	} catch (error) {
		logger.warn({ conversationId, error }, "[rlm] failed to close session cleanly");
	} finally {
		session.rl.close();
		session.process.kill("SIGTERM");
	}
}

export async function runRlm(
	request: Omit<RlmRequestBase, "api_key">
): Promise<{ text: string; metadata?: Record<string, unknown> | null; execution_time?: number }> {
	const { rlmRepoPath, bridgePath } = resolveRlmPaths();
	const apiKey = resolveApiKey();

	if (!request.base_url.trim()) {
		throw new Error("OPENAI_BASE_URL is required for RLM models");
	}

	if (!apiKey.trim()) {
		throw new Error("OPENAI_API_KEY or OPENROUTER_API_KEY is required for RLM models");
	}

	const payload: RlmRequestBase = {
		...request,
		api_key: apiKey,
	};

	return await new Promise<{
		text: string;
		metadata?: Record<string, unknown> | null;
		execution_time?: number;
	}>(
		(resolve, reject) => {
		const child = spawn(
			"uv",
			["run", "--project", rlmRepoPath, "python", bridgePath],
			{
				cwd: rlmRepoPath,
				env: process.env,
				stdio: ["pipe", "pipe", "pipe"],
			}
		);

		let stdout = "";
		let stderr = "";
		let finished = false;

		const finish = (handler: () => void) => {
			if (finished) return;
			finished = true;
			handler();
		};

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			finish(() => reject(error));
		});

		const abortHandler = () => {
			child.kill("SIGTERM");
			const error = new Error("Request was aborted.");
			error.name = "AbortError";
			finish(() => reject(error));
		};

		payload.abortSignal?.addEventListener("abort", abortHandler, { once: true });

		child.on("close", (code) => {
			payload.abortSignal?.removeEventListener("abort", abortHandler);

			if (finished) return;

			if (code !== 0) {
				finish(() =>
					reject(new Error(stderr.trim() || `RLM bridge exited with code ${code ?? "unknown"}`))
				);
				return;
			}

			try {
				const parsed = JSON.parse(stdout.trim()) as {
					response?: string;
					metadata?: Record<string, unknown> | null;
					execution_time?: number;
				};
				finish(() =>
					resolve({
						text: parsed.response ?? "",
						metadata: parsed.metadata,
						execution_time: parsed.execution_time,
					})
				);
			} catch (error) {
				logger.error({ stdout, stderr, error }, "[rlm] Failed to parse bridge output");
				finish(() => reject(new Error("RLM bridge returned invalid JSON")));
			}
		});

		const { abortSignal: _abortSignal, ...serializablePayload } = payload;
		void _abortSignal;
		child.stdin.write(JSON.stringify(serializablePayload));
		child.stdin.end();
		}
	);
}

export async function runConversationScopedRlm(
	request: Omit<ConversationScopedRequest, "api_key"> & {
		onTrace?: (trace: import("../endpoints/endpoints").RlmTraceEvent) => void;
	}
): Promise<{ text: string; metadata?: Record<string, unknown> | null; execution_time?: number }> {
	const apiKey = resolveApiKey();

	if (!request.base_url.trim()) {
		throw new Error("OPENAI_BASE_URL is required for RLM models");
	}

	if (!apiKey.trim()) {
		throw new Error("OPENAI_API_KEY or OPENROUTER_API_KEY is required for RLM models");
	}

	if (!request.conversationId) {
		return await runRlm({
			...request,
			context: request.structuredContext,
		});
	}
	const conversationId = request.conversationId;

	const payload: ConversationScopedRequest = {
		...request,
		api_key: apiKey,
	};

	let session = sessionMap.get(conversationId);
	if (!session || session.modelFingerprint !== request.modelFingerprint) {
		if (session) await closeSession(conversationId);
		session = await createSession(conversationId, payload);
	}

	return await enqueueSessionWork(conversationId, session, async () => {
		const preprompt = request.preprompt?.trim() || "";
		const resetRequired = shouldResetPersistentSession({
			previousPreprompt: session.previousPreprompt,
			nextPreprompt: preprompt,
			previousMessages: session.previousMessages,
			nextMessages: request.messages,
		});
		let activeSession = session;

		// Branch edits/retries must not reuse the old persistent REPL state, because
		// LocalREPL appends new contexts as context_1/context_2/... while `context`
		// continues to alias context_0. Recreate the session so the active branch is
		// the only visible conversation context.
		if (resetRequired) {
			await closeSession(conversationId);
			activeSession = await createSession(conversationId, payload);
		}

		let nextMessages = !resetRequired
			? request.messages.slice(activeSession.previousMessages.length)
			: request.messages;
		const needsReseed = resetRequired || nextMessages.length === 0;
		const context = needsReseed
			? request.structuredContext
			: buildStructuredIncrementalContext(request.modelDisplayName, nextMessages);
		const response = await sendSessionCommand(
			activeSession,
			{
				command: "complete",
				context,
				root_prompt: request.root_prompt,
			},
			request.abortSignal,
			request.onTrace
		);

		activeSession.previousMessages = request.messages;
		activeSession.previousPreprompt = preprompt;
		await saveDurableMetadata(activeSession);

		if (!isSuccessSessionResponse(response)) {
			throw new Error("Unexpected non-success RLM session response");
		}

		return {
			text: response.response ?? "",
			metadata: response.metadata,
			execution_time: response.execution_time,
		};
	});
}

export function getRlmSettings(overrides?: { subcallModel?: string }) {
	const configuredSubcallModel =
		overrides?.subcallModel ??
		(Reflect.get(config, "RLM_SUBCALL_MODEL") as string | undefined)?.trim() ??
		"";

	return {
		maxDepth: parsePositiveInt(Reflect.get(config, "RLM_MAX_DEPTH") as string | undefined, 2),
		maxIterations: parsePositiveInt(
			Reflect.get(config, "RLM_MAX_ITERATIONS") as string | undefined,
			12
		),
		maxTimeout: parsePositiveFloat(Reflect.get(config, "RLM_MAX_TIMEOUT_S") as string | undefined),
		maxBudget: parsePositiveFloat(Reflect.get(config, "RLM_MAX_BUDGET_USD") as string | undefined),
		maxErrors: parsePositiveInt(Reflect.get(config, "RLM_MAX_ERRORS") as string | undefined, 3),
		maxConcurrentSubcalls: parsePositiveInt(
			Reflect.get(config, "RLM_MAX_CONCURRENT_SUBCALLS") as string | undefined,
			4
		),
		subcallModel: configuredSubcallModel,
		displayPrefix:
			(Reflect.get(config, "RLM_DISPLAY_PREFIX") as string | undefined)?.trim() || "RLM",
	};
}

process.on("exit", () => {
	for (const conversationId of sessionMap.keys()) {
		void closeSession(conversationId);
	}
});
