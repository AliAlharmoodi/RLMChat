import type {
	Endpoint,
	EndpointParameters,
	EndpointMessage,
	RlmTraceEvent,
	TextGenerationStreamOutputSimplified,
} from "../endpoints/endpoints";
import type { ProcessedModel } from "../models";
import {
	getRlmSettings,
	runConversationScopedRlm,
	type RlmSnapshotMessage,
} from "./runRlm";
import { config } from "../config";

type RlmModel = ProcessedModel & {
	rlmBaseModelId?: string;
	rlmBaseDisplayName?: string;
};

const toRole = (message: EndpointMessage) =>
	message.from === "assistant"
		? "assistant"
		: message.from === "system"
			? "system"
			: "user";

const getLatestUserMessage = (messages: EndpointMessage[]) =>
	[...messages].reverse().find((message) => message.from === "user")?.content?.trim() || "";

const toSnapshotMessages = (messages: EndpointMessage[]): RlmSnapshotMessage[] =>
	messages.map((message) => ({
		role: toRole(message),
		content: message.content,
	}));

const buildStructuredContext = ({
	model,
	messages,
	preprompt,
}: {
	model: RlmModel;
	messages: EndpointMessage[];
	preprompt?: string;
}) => ({
	kind: "chat_ui_conversation",
	target_model: model.rlmBaseModelId ?? model.id,
	target_model_display_name: model.rlmBaseDisplayName ?? model.displayName,
	system_prompt: preprompt?.trim() || "",
	messages: messages.map((message, index) => ({
		index,
		role: toRole(message),
		content: message.content,
	})),
});

const modelFingerprint = (model: RlmModel, settings: ReturnType<typeof getRlmSettings>) =>
	JSON.stringify({
		model: model.rlmBaseModelId ?? model.id,
		baseURL: model.endpoints?.[0]?.type === "openai" ? model.endpoints[0].baseURL : "",
		subcallModel: settings.subcallModel,
		maxDepth: settings.maxDepth,
		maxIterations: settings.maxIterations,
		maxTimeout: settings.maxTimeout,
		maxBudget: settings.maxBudget,
		maxErrors: settings.maxErrors,
		maxConcurrentSubcalls: settings.maxConcurrentSubcalls,
	});

const buildRootPrompt = (messages: EndpointMessage[]) => {
	const latestUserMessage = getLatestUserMessage(messages);
	if (latestUserMessage) {
		return [
			latestUserMessage,
			"",
			"Produce only the next assistant reply for the conversation object in context.",
		].join("\n");
	}

	return "Produce only the next assistant reply for the conversation object in context.";
};

const truncate = (value: unknown, max = 8000) => {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return text.length > max ? `${text.slice(0, max)}\n\n...[truncated]` : text;
};

const cleanTraceText = (value: unknown, max = 12000) =>
	truncate(value, max)
		.replace(/```repl\s*/gi, "")
		.replace(/```/g, "")
		.replace(/FINAL\(([\s\S]*?)\)/g, "$1")
		.replace(/FINAL_VAR\(([\s\S]*?)\)/g, "$1")
		.trim();

const buildTraceSections = ({
	finalText,
	metadata,
	executionTime,
}: {
	finalText: string;
	metadata?: Record<string, unknown> | null;
	executionTime?: number;
}): RlmTraceEvent[] => {
	const iterations = Array.isArray(metadata?.iterations) ? metadata?.iterations : [];
	const details: Array<{ label: string; content: string; kind?: "text" | "code" | "output" | "error" }> =
		[];
	const workerOutputs: string[] = [];
	const workerActivity: string[] = [];
	let workerCallCount = 0;

	for (const [index, iteration] of iterations.entries()) {
		const lines: string[] = [];

		if (typeof iteration?.response === "string" && iteration.response.trim()) {
			lines.push(cleanTraceText(iteration.response));
		}

		const codeBlocks = Array.isArray(iteration?.code_blocks) ? iteration.code_blocks : [];
		for (const [blockIndex, block] of codeBlocks.entries()) {
			const code = typeof block?.code === "string" ? cleanTraceText(block.code) : "";
			const stdout =
				typeof block?.result?.stdout === "string" && block.result.stdout.trim()
					? cleanTraceText(block.result.stdout)
					: "";
			const stderr =
				typeof block?.result?.stderr === "string" && block.result.stderr.trim()
					? cleanTraceText(block.result.stderr)
					: "";

			if (code) {
				lines.push(`Code block ${blockIndex + 1}\n${code}`);
			}
			if (stdout) {
				lines.push(`Stdout\n${stdout}`);
			}
			if (stderr) {
				lines.push(`Stderr\n${stderr}`);
			}

			const rlmCalls = Array.isArray(block?.result?.rlm_calls) ? block.result.rlm_calls : [];
			for (const [callIndex, call] of rlmCalls.entries()) {
				workerCallCount += 1;
				const label = call?.root_model ? `${call.root_model}` : `Worker ${callIndex + 1}`;
				workerActivity.push(
					`${label}${typeof call?.depth === "number" ? ` • depth ${call.depth}` : ""}${
						typeof call?.duration === "number" ? ` • ${call.duration.toFixed(1)}s` : ""
					}`
				);
				if (typeof call?.response === "string" && call.response.trim()) {
					workerOutputs.push(`${label}\n${cleanTraceText(call.response)}`);
				}
			}
		}

		if (typeof iteration?.final_answer === "string" && iteration.final_answer.trim()) {
			lines.push(`Final answer\n${cleanTraceText(iteration.final_answer)}`);
		}

		if (lines.length) {
			details.push({
				label: `Iteration ${index + 1}`,
				content: lines.join("\n\n"),
				kind: "text" as const,
			});
		}
	}

	return [
		{
			kind: "section",
			sectionId: "rlm-trace",
			title: "Context Inspection",
			status: "done",
			summary: finalText,
			durationSeconds: executionTime,
			details: [
				{
					label: "Worker activity",
					content:
						workerCallCount > 0
							? `${workerCallCount} worker call${workerCallCount === 1 ? "" : "s"}\n${workerActivity.join("\n")}`
							: "No worker calls were made during this reply.",
					kind: "text" as const,
				},
				...details,
				...(workerOutputs.length
					? [
							{
								label: "Worker model outputs",
								content: workerOutputs.join("\n\n"),
								kind: "output" as const,
							},
						]
					: []),
			],
		},
	];
};

export function makeRlmEndpoint(model: RlmModel): Endpoint {
	return async ({
		messages,
		preprompt,
		conversationId,
		locals,
		abortSignal,
	}: EndpointParameters): ReturnType<Endpoint> => {
		const userSubcallModel =
			(locals as { userSettings?: { rlmSubcallModel?: string } } | undefined)?.userSettings
				?.rlmSubcallModel ?? "";
		const settings = getRlmSettings({ subcallModel: userSubcallModel });
		const snapshotMessages = toSnapshotMessages(messages);
		return (async function* () {
			const queue: TextGenerationStreamOutputSimplified[] = [];
			let done = false;
			let error: Error | null = null;
			let wake: (() => void) | null = null;
			const structuredContext = buildStructuredContext({ model, messages, preprompt });
			const rootPrompt = buildRootPrompt(messages);

			const push = (item: TextGenerationStreamOutputSimplified) => {
				queue.push(item);
				wake?.();
				wake = null;
			};

			void runConversationScopedRlm({
				model: model.rlmBaseModelId ?? model.id,
				subcall_model: settings.subcallModel || undefined,
				base_url: model.endpoints?.[0]?.type === "openai" ? model.endpoints[0].baseURL : "",
				root_prompt: rootPrompt,
				conversationId: conversationId?.toString(),
				messages: snapshotMessages,
				preprompt,
				modelDisplayName: model.rlmBaseDisplayName ?? model.displayName,
				structuredContext,
				modelFingerprint: modelFingerprint(model, settings),
				app_name: config.PUBLIC_APP_NAME,
				public_origin: config.PUBLIC_ORIGIN,
				max_depth: settings.maxDepth,
				max_iterations: settings.maxIterations,
				max_timeout: settings.maxTimeout,
				max_budget: settings.maxBudget,
				max_errors: settings.maxErrors,
				max_concurrent_subcalls: settings.maxConcurrentSubcalls,
				abortSignal,
				onTrace: (trace) => {
					if (trace.kind !== "status") return;
					push({
						token: { id: 0, text: "", logprob: 0, special: true },
						generated_text: null,
						details: null,
						rlmTrace: trace,
					});
				},
			})
				.then(({ text, metadata, execution_time }) => {
					for (const trace of buildTraceSections({
						finalText: text,
						metadata,
						executionTime: execution_time,
					})) {
						push({
							token: { id: 0, text: "", logprob: 0, special: true },
							generated_text: null,
							details: null,
							rlmTrace: trace,
						});
					}
					push({
						token: {
							id: 0,
							text,
							logprob: 0,
							special: false,
						},
						generated_text: text,
						details: null,
					});
					done = true;
					wake?.();
				})
				.catch((err: Error) => {
					error = err;
					done = true;
					wake?.();
				});

			while (!done || queue.length > 0) {
				if (queue.length === 0) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					continue;
				}

				const item = queue.shift();
				if (item) {
					yield item;
				}
			}

			if (error) {
				throw error;
			}
		})();
	};
}
