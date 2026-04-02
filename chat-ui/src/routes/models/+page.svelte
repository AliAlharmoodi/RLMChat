<script lang="ts">
	import type { PageData } from "./$types";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	import { base } from "$app/paths";
	import { page } from "$app/state";

	import CarbonHelpFilled from "~icons/carbon/help-filled";
	import LucideHammer from "~icons/lucide/hammer";
	import LucideImage from "~icons/lucide/image";
	import LucideSettings from "~icons/lucide/settings";
	import IconFast from "$lib/components/icons/IconFast.svelte";
	import IconCheap from "$lib/components/icons/IconCheap.svelte";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import { useSettingsStore } from "$lib/stores/settings";
	import { goto } from "$app/navigation";
	import Switch from "$lib/components/Switch.svelte";
	import ModelPicker from "$lib/components/ModelPicker.svelte";
	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const settings = useSettingsStore();

	const publicConfig = usePublicConfig();

	// Local filter state for model search (hyphen/space insensitive)
	let modelFilter = $state("");
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
	let queryTokens = $derived(normalize(modelFilter).trim().split(/\s+/).filter(Boolean));

	// Filtered models list
	let filteredModels = $derived(
		data.models
			.filter((el) => !el.unlisted)
			.filter((el) => !el.isRouter)
			.filter((el) => {
				const haystack = normalize(`${el.id} ${el.name ?? ""} ${el.displayName ?? ""}`);
				return queryTokens.every((q) => haystack.includes(q));
			})
	);

	function getRlmMode() {
		return $settings.rlmMode;
	}

	function setRlmMode(v: boolean) {
		settings.update((s) => ({ ...s, rlmMode: v }));
	}

	let rlmCandidateModels = $derived(
		data.models.filter((model) => !model.unlisted && !model.isRouter)
	);

	function getRlmSubcallModel() {
		return $settings.rlmSubcallModel ?? "";
	}

	function setRlmSubcallModel(v: string) {
		settings.update((s) => ({ ...s, rlmSubcallModel: v }));
	}

	function setActiveModel(modelId: string) {
		settings.instantSet({ activeModel: modelId });
	}
</script>

<svelte:head>
	{#if publicConfig.isHuggingChat}
		<title>{publicConfig.PUBLIC_APP_NAME} - Models</title>
		<meta property="og:title" content="{publicConfig.PUBLIC_APP_NAME} - Models" />
		<meta property="og:type" content="website" />
		<meta
			property="og:description"
			content="Browse {publicConfig.PUBLIC_APP_NAME} available models"
		/>
		<meta property="og:url" content={page.url.href} />
		<meta property="og:image" content="{publicConfig.assetPath}/thumbnail.png" />
		<meta property="og:image:alt" content="{publicConfig.PUBLIC_APP_NAME} preview" />
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content="{publicConfig.PUBLIC_APP_NAME} - Models" />
		<meta
			name="twitter:description"
			content="Browse {publicConfig.PUBLIC_APP_NAME} available models"
		/>
		<meta name="twitter:image" content="{publicConfig.assetPath}/thumbnail.png" />
		<meta name="twitter:image:alt" content="{publicConfig.PUBLIC_APP_NAME} preview" />
	{/if}
</svelte:head>

<div class="scrollbar-custom h-full overflow-y-auto py-12 max-sm:pt-8 md:py-24">
	<div class="pt-42 mx-auto flex flex-col px-5 xl:w-[60rem] 2xl:w-[64rem]">
		<div class="flex items-center">
			<h1 class="text-xl font-bold sm:text-2xl">Models</h1>
			{#if publicConfig.isHuggingChat}
				<a
					href="https://huggingface.co/docs/inference-providers"
					class="ml-auto text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
					target="_blank"
					aria-label="Hub discussion about models"
				>
					<CarbonHelpFilled />
				</a>
			{/if}
		</div>
		<h2 class="text-gray-500">
			Pick the root model once, then search only when you need to change it.{#if publicConfig.isHuggingChat}&nbsp;Available
			via <a
					target="_blank"
					href="https://huggingface.co/inference/models"
					class="underline decoration-gray-300 hover:decoration-gray-500 dark:decoration-gray-600 dark:hover:decoration-gray-500"
					>Inference Providers</a
				>{/if}
		</h2>

		<div class="mt-5 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950 md:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.1fr)] md:items-start">
			<ModelPicker
				models={filteredModels.length ? filteredModels : rlmCandidateModels}
				value={$settings.activeModel}
				label="Root model"
				placeholder="Search root model"
				onchange={setActiveModel}
			/>

			<div class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800 md:min-w-[12rem]">
				<div class="min-w-0 pr-3">
					<div class="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
						RLM mode
					</div>
					<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
						Recursive runtime
					</div>
				</div>
				<Switch name="rlmMode" bind:checked={getRlmMode, setRlmMode} />
			</div>

			{#if $settings.rlmMode}
				<ModelPicker
					models={rlmCandidateModels}
					value={getRlmSubcallModel()}
					label="Subcall model"
					placeholder="Search subcall model"
					emptyLabel="Same as root model"
					emptyDescription="Use the selected root model for both top-level reasoning and recursive subcalls."
					onchange={setRlmSubcallModel}
				/>
			{:else}
				<div class="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
					RLM is off, so only the root model matters.
				</div>
			{/if}
		</div>

		<div class="mt-4 flex items-center gap-3">
			<input
				type="search"
				bind:value={modelFilter}
				placeholder="Filter the long tail by name or id"
				aria-label="Search models by name or id"
				class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-gray-700"
			/>
			<div class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
				{filteredModels.length} results
			</div>
		</div>

		<div class="mt-6 min-h-[50vh]">
			<div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
				{#each filteredModels as model, index (model.id)}
					{@const isActive = model.id === $settings.activeModel}
					{@const isLast = index === filteredModels.length - 1}
					<div
						class="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-4 {isLast ? '' : 'border-b border-gray-100 dark:border-gray-800'} {isActive ? 'bg-gray-50 dark:bg-gray-900/70' : ''}"
					>
						<div class="flex-shrink-0">
							{#if model.logoUrl}
								<img
									alt={model.displayName}
									class="size-8 rounded-md border border-gray-100 bg-gray-50 object-cover dark:border-gray-700 dark:bg-gray-100"
									src={model.logoUrl}
								/>
							{:else}
								<div
									class="size-8 rounded-md border border-gray-100 bg-gray-200 dark:border-gray-700 dark:bg-gray-700"
									aria-hidden="true"
								></div>
							{/if}
						</div>

						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<h3
									class="truncate text-sm font-medium text-gray-900 dark:text-gray-200"
									class:font-bold={isActive}
									class:dark:text-white={isActive}
								>
									{model.displayName}
								</h3>
							</div>
							<div class="truncate text-xs text-gray-500 dark:text-gray-400">{model.id}</div>
							{#if model.description}
								<p class="mt-1 truncate pr-4 text-xs text-gray-500 dark:text-gray-400">
									{model.description}
								</p>
							{/if}
						</div>

						<div class="flex flex-shrink-0 items-center gap-2">
							{#if publicConfig.isHuggingChat && !model.isRouter && $settings.providerOverrides?.[model.id] && $settings.providerOverrides[model.id] !== "auto"}
								{@const providerOverride = $settings.providerOverrides[model.id]}
								{@const hubOrg =
									PROVIDERS_HUB_ORGS[providerOverride as keyof typeof PROVIDERS_HUB_ORGS]}
								{#if providerOverride === "fastest"}
									<div
										title="Provider: Fastest"
										class="rounded-md bg-green-50 p-1.5 text-green-600 dark:bg-green-900/20 dark:text-green-400"
									>
										<IconFast classNames="size-3 sm:size-3.5" />
									</div>
								{:else if providerOverride === "cheapest"}
									<div
										title="Provider: Cheapest"
										class="rounded-md bg-blue-50 p-1.5 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
									>
										<IconCheap classNames="size-3 sm:size-3.5" />
									</div>
								{:else if hubOrg}
									<div
										title="Provider: {providerOverride}"
										class="flex size-[26px] items-center justify-center rounded-md bg-gray-100 p-1 dark:bg-gray-800 sm:size-[30px]"
									>
										<img
											src="https://huggingface.co/api/avatars/{hubOrg}"
											alt={providerOverride}
											class="size-full rounded"
										/>
									</div>
								{/if}
							{/if}
							{#if $settings.toolsOverrides?.[model.id] ?? (model as { supportsTools?: boolean }).supportsTools}
								<div
									title="This model supports tool calling (functions)."
									class="rounded-md bg-purple-50 p-1.5 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
								>
									<LucideHammer class="size-3 sm:size-3.5" />
								</div>
							{/if}
							{#if $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
								<div
									title="This model is multimodal and supports image inputs natively."
									class="rounded-md bg-blue-50 p-1.5 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
								>
									<LucideImage class="size-3 sm:size-3.5" />
								</div>
							{/if}

							{#if isActive}
								<span
									class="rounded-md bg-black px-2 py-1 text-xs font-semibold text-white dark:bg-white dark:text-black"
								>
									Active
								</span>
							{/if}

							<button
								type="button"
								class="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
								onclick={() => setActiveModel(model.id)}
							>
								Use
							</button>
							<a
								href="{base}/models/{model.id}"
								class="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
							>
								Chat
							</a>
							<button
								type="button"
								title="Model settings"
								aria-label="Model settings for {model.displayName}"
								class="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
								onclick={() => goto(`${base}/settings/${model.id}`)}
							>
								<LucideSettings class="size-3 sm:size-3.5" />
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
