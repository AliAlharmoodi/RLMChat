<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import type { Model } from "$lib/types/Model";
	import LucideSearch from "~icons/lucide/search";
	import LucideCheck from "~icons/lucide/check";
	import LucideChevronDown from "~icons/lucide/chevron-down";
	import LucideImage from "~icons/lucide/image";
	import LucideHammer from "~icons/lucide/hammer";

	interface Props {
		models: Model[];
		value?: string;
		label: string;
		placeholder?: string;
		emptyLabel?: string;
		emptyDescription?: string;
		noneValue?: string;
		onchange?: (value: string) => void;
	}

	let {
		models,
		value = "",
		label,
		placeholder = "Search models",
		emptyLabel,
		emptyDescription,
		noneValue = "",
		onchange,
	}: Props = $props();

	let open = $state(false);
	let query = $state("");
	let searchInput: HTMLInputElement | undefined = $state();

	const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

	const selectedModel = $derived(models.find((model) => model.id === value));
	const selectedLabel = $derived(
		value === noneValue
			? emptyLabel || "Not set"
			: selectedModel?.displayName || selectedModel?.id || emptyLabel || "Select a model"
	);

	let filteredModels = $derived.by(() => {
		const tokens = normalize(query).split(/\s+/).filter(Boolean);
		const scored = models
			.filter((model) => !model.unlisted)
			.map((model) => {
				const haystack = normalize(`${model.displayName} ${model.id} ${model.description ?? ""}`);
				const exact = normalize(model.displayName) === normalize(query) || model.id === query;
				const selected = model.id === value;
				const matches = tokens.every((token) => haystack.includes(token));
				return { model, selected, exact, matches };
			})
			.filter((entry) => tokens.length === 0 || entry.matches)
			.sort((a, b) => {
				if (a.selected !== b.selected) return a.selected ? -1 : 1;
				if (a.exact !== b.exact) return a.exact ? -1 : 1;
				return a.model.displayName.localeCompare(b.model.displayName);
			});

		return scored.map((entry) => entry.model).slice(0, 60);
	});

	function openPicker() {
		open = true;
		query = "";
		setTimeout(() => searchInput?.focus(), 0);
	}

	function choose(nextValue: string) {
		onchange?.(nextValue);
		open = false;
		query = "";
	}
</script>

<button
	type="button"
	onclick={openPicker}
	class="flex min-w-0 items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-gray-600"
>
	<div class="min-w-0 flex-1">
		<div class="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
			{label}
		</div>
		<div class="truncate font-medium">{selectedLabel}</div>
	</div>
	<LucideChevronDown class="size-4 shrink-0 text-gray-500 dark:text-gray-400" />
</button>

{#if open}
	<Modal width="max-w-2xl" closeButton={true} onclose={() => (open = false)}>
		<div class="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
			<div class="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-gray-900">
				<LucideSearch class="size-4 text-gray-400" />
				<input
					bind:this={searchInput}
					bind:value={query}
					type="search"
					placeholder={placeholder}
					aria-label={placeholder}
					class="h-11 w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
				/>
			</div>
		</div>

		<div class="max-h-[65vh] overflow-y-auto px-3 py-3">
			{#if emptyLabel}
				<button
					type="button"
					onclick={() => choose(noneValue)}
					class="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
				>
					<div class="min-w-0 flex-1">
						<div class="font-medium text-gray-900 dark:text-gray-100">{emptyLabel}</div>
						{#if emptyDescription}
							<div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
								{emptyDescription}
							</div>
						{/if}
					</div>
					{#if value === noneValue}
						<LucideCheck class="mt-0.5 size-4 shrink-0 text-gray-900 dark:text-gray-100" />
					{/if}
				</button>
			{/if}

			{#if filteredModels.length}
				<div class="mt-1 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
					{#each filteredModels as model, index (model.id)}
						<button
							type="button"
							onclick={() => choose(model.id)}
							class="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900/70 {index < filteredModels.length - 1 ? 'border-b border-gray-200 dark:border-gray-800' : ''}"
						>
							{#if model.logoUrl}
								<img src={model.logoUrl} alt="" class="mt-0.5 size-7 rounded-md border border-gray-200 object-cover dark:border-gray-700" />
							{:else}
								<div class="mt-0.5 size-7 rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"></div>
							{/if}

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<div class="truncate font-medium text-gray-900 dark:text-gray-100">
										{model.displayName}
									</div>
									{#if model.multimodal}
										<LucideImage class="size-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
									{/if}
									{#if (model as { supportsTools?: boolean }).supportsTools}
										<LucideHammer class="size-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
									{/if}
								</div>
								<div class="truncate text-xs text-gray-500 dark:text-gray-400">{model.id}</div>
								{#if model.description}
									<div class="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
										{model.description}
									</div>
								{/if}
							</div>

							{#if model.id === value}
								<LucideCheck class="mt-0.5 size-4 shrink-0 text-gray-900 dark:text-gray-100" />
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<div class="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
					No models matched “{query}”.
				</div>
			{/if}
		</div>
	</Modal>
{/if}
