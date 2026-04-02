<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import type { Model } from "$lib/types/Model";
	import LucideChevronDown from "~icons/lucide/chevron-down";
	import LucideCheck from "~icons/lucide/check";
	import LucideSearch from "~icons/lucide/search";

	type ExtraOption = {
		value: string;
		label: string;
		description?: string;
	};

	interface Props {
		models?: Model[];
		value?: string;
		label: string;
		selectedLabel: string;
		placeholder?: string;
		disabled?: boolean;
		extraOptions?: ExtraOption[];
		onchange?: (value: string) => void | Promise<void>;
		align?: "start" | "end";
	}

	let {
		models = [],
		value = "",
		label,
		selectedLabel,
		placeholder = "Search models",
		disabled = false,
		extraOptions = [],
		onchange,
		align = "start",
	}: Props = $props();

	let open = $state(false);
	let query = $state("");
	let rootEl: HTMLDivElement | undefined = $state();
	let inputEl: HTMLInputElement | undefined = $state();

	const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

	let filteredModels = $derived.by(() => {
		const tokens = normalize(query).split(/\s+/).filter(Boolean);
		return models
			.filter((model) => !model.unlisted && !model.isRouter)
			.filter((model) => {
				if (!tokens.length) return true;
				const haystack = normalize(
					`${model.displayName} ${model.id} ${model.description ?? ""}`
				);
				return tokens.every((token) => haystack.includes(token));
			})
			.sort((a, b) => {
				if (a.id === value) return -1;
				if (b.id === value) return 1;
				return a.displayName.localeCompare(b.displayName);
			})
			.slice(0, 40);
	});

	async function openPopover() {
		if (disabled) return;
		open = true;
		query = "";
		await tick();
		inputEl?.focus();
	}

	async function select(nextValue: string) {
		await onchange?.(nextValue);
		open = false;
		query = "";
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (!open || !rootEl) return;
		if (!rootEl.contains(event.target as Node)) {
			open = false;
		}
	}

	function onDocumentKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			open = false;
		}
	}

	if (typeof window !== "undefined") {
		window.addEventListener("pointerdown", onDocumentPointerDown);
		window.addEventListener("keydown", onDocumentKeydown);
	}

	onDestroy(() => {
		if (typeof window !== "undefined") {
			window.removeEventListener("pointerdown", onDocumentPointerDown);
			window.removeEventListener("keydown", onDocumentKeydown);
		}
	});
</script>

<div class="relative" bind:this={rootEl}>
	<button
		type="button"
		onclick={openPopover}
		{disabled}
		class="inline-flex h-9 max-w-[15rem] items-center gap-2 rounded-full border border-gray-300/80 bg-white/70 px-3 text-sm text-gray-700 backdrop-blur hover:border-gray-400 hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
	>
		<span class="shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
			{label}
		</span>
		<span class="truncate font-medium">{selectedLabel}</span>
		<LucideChevronDown class="size-4 shrink-0 text-gray-400" />
	</button>

	{#if open}
		<div
			class="absolute bottom-full z-50 mb-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 {align === 'end' ? 'right-0' : 'left-0'}"
		>
			<div class="border-b border-gray-200 p-3 dark:border-gray-700">
				<div class="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800">
					<LucideSearch class="size-4 text-gray-400" />
					<input
						bind:this={inputEl}
						bind:value={query}
						type="search"
						placeholder={placeholder}
						aria-label={placeholder}
						class="h-10 w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
					/>
				</div>
			</div>

			<div class="max-h-80 overflow-y-auto p-2">
				{#each extraOptions as option (option.value)}
					<button
						type="button"
						onclick={() => select(option.value)}
						class="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
					>
						<div class="min-w-0 flex-1">
							<div class="font-medium text-gray-900 dark:text-gray-100">{option.label}</div>
							{#if option.description}
								<div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
							{/if}
						</div>
						{#if value === option.value}
							<LucideCheck class="mt-0.5 size-4 shrink-0 text-gray-900 dark:text-gray-100" />
						{/if}
					</button>
				{/each}

				{#if filteredModels.length}
					{#each filteredModels as model (model.id)}
						<button
							type="button"
							onclick={() => select(model.id)}
							class="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
						>
							{#if model.logoUrl}
								<img src={model.logoUrl} alt="" class="mt-0.5 size-6 rounded-md border border-gray-200 object-cover dark:border-gray-700" />
							{:else}
								<div class="mt-0.5 size-6 rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"></div>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="truncate font-medium text-gray-900 dark:text-gray-100">{model.displayName}</div>
								<div class="truncate text-xs text-gray-500 dark:text-gray-400">{model.id}</div>
							</div>
							{#if value === model.id}
								<LucideCheck class="mt-0.5 size-4 shrink-0 text-gray-900 dark:text-gray-100" />
							{/if}
						</button>
					{/each}
				{:else}
					<div class="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
						No models matched "{query}".
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
