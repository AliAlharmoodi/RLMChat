<script lang="ts">
	import { onDestroy } from "svelte";
	import TraceMarkdown from "./TraceMarkdown.svelte";
	import {
		buildFormattedTraceSections,
		renderTraceContent,
		type TraceDetailLine,
	} from "./rlmTraceFormatting";
	import {
		MessageRlmTraceUpdateType,
		type MessageRlmTraceUpdate,
	} from "$lib/types/MessageUpdate";

	interface Props {
		trace: MessageRlmTraceUpdate[];
		loading?: boolean;
	}

	let { trace, loading = false }: Props = $props();
	let isOpen = $state(false);
	let activePanel = $state("main");
	let elapsedSeconds = $state(0);
	let startedAt = $state<number | null>(null);
	let timer: ReturnType<typeof setInterval> | undefined;

	let section = $derived(
		[...trace].reverse().find((update) => update.subtype === MessageRlmTraceUpdateType.Section) as
			| Extract<MessageRlmTraceUpdate, { subtype: MessageRlmTraceUpdateType.Section }>
			| undefined
	);
	let streamUpdates = $derived(
		trace.filter(
			(update): update is Extract<MessageRlmTraceUpdate, { subtype: MessageRlmTraceUpdateType.Stream }> =>
				update.subtype === MessageRlmTraceUpdateType.Stream
		)
	);
	let statusUpdates = $derived(
		trace.filter(
			(update): update is Extract<MessageRlmTraceUpdate, { subtype: MessageRlmTraceUpdateType.Status }> =>
				update.subtype === MessageRlmTraceUpdateType.Status
		)
	);
	let liveStatusLines = $derived(
		statusUpdates
			.map((update) => update.status.trim())
			.filter(Boolean)
			.filter((status, index, arr) => arr.findIndex((entry) => entry === status) === index)
	);
	const formatWholeSeconds = (seconds: number) => `${Math.max(1, Math.round(seconds))}s`;
	let inspectionLabel = $derived.by(() => {
		const seconds = section?.durationSeconds;
		if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
			return `Worked for ${formatWholeSeconds(seconds)}`;
		}
		if (loading) {
			return `Working for ${formatWholeSeconds(elapsedSeconds || 0)}`;
		}
		return "Worked";
	});

	$effect(() => {
		if ((loading || trace.length > 0) && startedAt === null) {
			startedAt = Date.now();
			elapsedSeconds = 0;
		}
	});

	$effect(() => {
		if (loading) {
			if (timer) return;
			timer = setInterval(() => {
				if (startedAt !== null) {
					elapsedSeconds = (Date.now() - startedAt) / 1000;
				}
			}, 100);
			return () => {
				if (timer) {
					clearInterval(timer);
					timer = undefined;
				}
			};
		}

		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		if (section?.durationSeconds) {
			elapsedSeconds = section.durationSeconds;
		}
	});

	onDestroy(() => {
		if (timer) {
			clearInterval(timer);
		}
	});

	let latestLiveStatus = $derived(liveStatusLines.at(-1) ?? "Working");
	let shouldRender = $derived(loading || statusUpdates.length > 0 || Boolean(section));
	let liveIterationOutputs = $derived.by(() => {
		const grouped = new Map<number, string>();
		for (const update of streamUpdates) {
			const previous = grouped.get(update.iteration) ?? "";
			grouped.set(update.iteration, previous + update.delta);
		}

		return [...grouped.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([iteration, content]) => ({
				iteration,
				content,
				renderedContent: renderTraceContent(content),
			}));
	});
	let detailLines = $derived<TraceDetailLine[]>(
		section?.details.length
			? section.details
			: liveIterationOutputs.length
				? liveIterationOutputs.map((entry) => ({
						label: `Iteration ${entry.iteration}`,
						content: entry.content,
					}))
				: liveStatusLines.length
				? [
						{
							label: "Live output",
							content: liveStatusLines.join("\n"),
						},
					]
				: [
						{
							label: "Live output",
							content: latestLiveStatus,
						},
				]
	);
	let workerDetailLines = $derived(
		detailLines.filter((detail) => detail.kind === "output")
	);
	let workerTabs = $derived.by(() =>
		workerDetailLines.map((detail, index) => ({
			id: `worker-${index + 1}`,
			label:
				workerDetailLines.length === 1 ? "Worker" : `Worker ${index + 1}`,
			detail,
		}))
	);
	let visibleDetailLines = $derived.by(() => {
		if (!section?.details.length) return detailLines;
		const workerTab = workerTabs.find((tab) => tab.id === activePanel);
		if (workerTab) {
			return [workerTab.detail];
		}
		return detailLines.filter(
			(detail) => detail.kind !== "output" && detail.label !== "Worker activity"
		);
	});
	let formattedSections = $derived(buildFormattedTraceSections(visibleDetailLines));

	$effect(() => {
		if (!loading && !section && statusUpdates.length === 0 && streamUpdates.length === 0) {
			isOpen = false;
		}
	});

	$effect(() => {
		if (activePanel !== "main" && !workerTabs.some((tab) => tab.id === activePanel)) {
			activePanel = "main";
		}
	});
</script>

{#if shouldRender}
	<div class="w-full space-y-1.5">
		<button
			type="button"
			class="inline-flex items-center gap-1 align-middle text-left text-[0.82rem] leading-none text-white/56 transition-colors hover:text-white/72"
			onclick={() => (isOpen = !isOpen)}
			aria-label={isOpen ? "Collapse trace" : "Expand trace"}
		>
			<span class="font-normal">{inspectionLabel}</span>
			<span
				class="relative top-px text-[0.94rem] leading-none text-white/32 transition-transform duration-200"
				class:rotate-90={isOpen}
			>
				›
			</span>
		</button>

		{#if isOpen}
			<div class="space-y-3 pt-0.5">
				{#if workerTabs.length > 0}
					<div class="flex items-center gap-2 text-[11px] text-white/42">
						<button
							type="button"
							class="rounded-full px-2.5 py-1 transition-colors {activePanel === 'main'
								? 'bg-white/[0.08] text-white/86'
								: 'hover:bg-white/[0.04]'}"
							onclick={() => (activePanel = "main")}
						>
							Root
						</button>
						{#each workerTabs as tab (tab.id)}
							<button
								type="button"
								class="rounded-full px-2.5 py-1 transition-colors {activePanel === tab.id
									? 'bg-white/[0.08] text-white/86'
									: 'hover:bg-white/[0.04]'}"
								onclick={() => (activePanel = tab.id)}
							>
								{tab.label}
							</button>
						{/each}
					</div>
				{/if}

				{#each formattedSections as detail, index (`${section?.sectionId ?? 'live'}-${index}`)}
					<div class="space-y-1.5">
						{#if !(workerTabs.some((tab) => tab.id === activePanel) && formattedSections.length === 1)}
							<div class="text-[11px] font-medium uppercase tracking-[0.16em] text-white/32">
								{detail.label}
							</div>
						{/if}
						<div class="space-y-2.5">
							{#each detail.blocks as block, blockIndex (`${detail.label}-${blockIndex}`)}
								<div class="border-l border-white/[0.08] pl-4">
									{#if block.chromeLabel}
										<div
											class="mb-2 inline-flex rounded-full border px-2 py-0.5 text-[0.67rem] font-medium uppercase tracking-[0.12em] {block.chromeTone === 'error'
												? 'border-rose-400/55 bg-rose-400/8 text-rose-200/75'
												: 'border-white/[0.06] bg-white/[0.02] text-white/40'}"
										>
											{block.chromeLabel}
										</div>
									{/if}
									{#if block.title}
										<div class="mb-1 text-[0.82rem] font-medium text-white/68">{block.title}</div>
									{/if}
									<TraceMarkdown content={block.content} />
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
