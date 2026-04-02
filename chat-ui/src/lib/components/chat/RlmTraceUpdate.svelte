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
			<div class="space-y-4 pt-1">
				{#each detailLines as detail, index (`${section?.sectionId ?? 'live'}-${index}`)}
					<div class="space-y-2.5">
						<div class="text-[11px] font-medium uppercase tracking-[0.16em] text-white/32">
							{detail.label}
						</div>
						<pre
							class="scrollbar-custom max-h-[70vh] overflow-auto rounded-[0.95rem] border border-white/[0.05] bg-black/[0.14] px-4 py-3 whitespace-pre-wrap break-words font-mono text-[0.74rem] leading-6 text-white/78"
						>{detail.content}</pre>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
