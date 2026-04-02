<script lang="ts">
	import { onDestroy } from "svelte";
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
	let elapsedSeconds = $state(0);
	let startedAt = $state<number | null>(null);
	let timer: ReturnType<typeof setInterval> | undefined;

	let section = $derived(
		[...trace].reverse().find((update) => update.subtype === MessageRlmTraceUpdateType.Section) as
			| Extract<MessageRlmTraceUpdate, { subtype: MessageRlmTraceUpdateType.Section }>
			| undefined
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
	let detailLines = $derived(
		section?.details.length
			? section.details
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
	const cleanTraceContent = (value: string) =>
		value
			.replace(/```repl\s*/gi, "")
			.replace(/```/g, "")
			.replace(/FINAL\(([\s\S]*?)\)/g, "$1")
			.replace(/\n{3,}/g, "\n\n")
			.trim();

	const splitIntoIterationBlocks = (value: string) => {
		const normalized = cleanTraceContent(value);
		const lines = normalized.split("\n");
		const starts: number[] = [];

		for (let i = 0; i < lines.length; i += 1) {
			if (/^Iteration \d+\s*$/.test(lines[i].trim())) {
				starts.push(i);
			}
		}

		if (!starts.length) {
			return normalized
				? [
						{
							title: "",
							content: normalized,
						},
					]
				: [];
		}

		return starts.map((start, index) => {
			const end = starts[index + 1] ?? lines.length;
			const blockLines = lines.slice(start, end);
			const title = blockLines[0]?.trim() ?? "";
			const content = blockLines.slice(1).join("\n").trim();
			return { title, content };
		});
	};

	let structuredDetails = $derived(
		detailLines.flatMap((detail) => {
			const blocks = splitIntoIterationBlocks(detail.content);
			if (detail.label === "Root model outputs" && blocks.length > 1) {
				return blocks.map((block) => ({
					label: block.title || detail.label,
					blocks: [
						{
							title: "",
							content: block.content,
						},
					],
				}));
			}

			return [
				{
					label: detail.label,
					blocks,
				},
			];
		})
	);

	$effect(() => {
		if (!loading && !section) {
			isOpen = false;
		}
	});
</script>

{#if shouldRender}
	<div class="w-full space-y-1.5">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 align-middle text-left text-[0.88rem] leading-none text-white/58 transition-colors hover:text-white/72"
			onclick={() => (isOpen = !isOpen)}
			aria-label={isOpen ? "Collapse trace" : "Expand trace"}
		>
			<span class="font-normal">{inspectionLabel}</span>
			<span
				class="relative top-px text-[1.02rem] leading-none text-white/34 transition-transform duration-200"
				class:rotate-90={isOpen}
			>
				›
			</span>
		</button>

		{#if isOpen}
			<div class="space-y-5 pt-1">
				{#each structuredDetails as detail, index (`${section?.sectionId ?? 'live'}-${index}`)}
					<div class="space-y-2.5">
						<div class="text-[11px] font-medium uppercase tracking-[0.16em] text-white/32">
							{detail.label}
						</div>
						<div class="space-y-4">
							{#each detail.blocks as block, blockIndex (`${detail.label}-${blockIndex}`)}
								<div class="border-l border-white/[0.08] pl-4">
									{#if block.title}
										<div class="mb-2 text-sm font-medium text-white/72">{block.title}</div>
									{/if}
									<pre
										class="overflow-visible whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-[0.76rem] leading-7 text-white/78"
									>{block.content}</pre>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
