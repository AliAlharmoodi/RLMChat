<script lang="ts">
	import DOMPurify from "isomorphic-dompurify";
	import { processBlocksSync, type Token } from "$lib/utils/marked";

	interface Props {
		content: string;
	}

	let { content }: Props = $props();

	let blocks = $derived(processBlocksSync(content));

	const sanitizeHtml = (value: string | Promise<string>) =>
		typeof value === "string" ? DOMPurify.sanitize(value) : "";

	const isTextToken = (token: Token): token is Extract<Token, { type: "text" }> =>
		token.type === "text";
</script>

<div class="trace-markdown-root">
	{#each blocks as block, blockIndex (`trace-block-${block.id}-${blockIndex}`)}
		<div class="trace-block">
			{#each block.tokens as token, tokenIndex (`${block.id}-${tokenIndex}`)}
				{#if isTextToken(token)}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="trace-text">{@html sanitizeHtml(token.html)}</div>
				{:else}
					<div class="trace-code-wrap">
						<pre class="trace-code"><code
								><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html DOMPurify.sanitize(token.code)}</code
							></pre>
					</div>
				{/if}
			{/each}
		</div>
	{/each}
</div>

<style>
	.trace-markdown-root {
		font-size: 0.76rem;
		line-height: 1.55rem;
		color: rgb(255 255 255 / 0.76);
	}

	.trace-block + .trace-block {
		margin-top: 0.6rem;
	}

	.trace-text :global(p),
	.trace-text :global(ul),
	.trace-text :global(ol),
	.trace-text :global(blockquote) {
		margin: 0;
	}

	.trace-text :global(p + p),
	.trace-text :global(p + ul),
	.trace-text :global(p + ol),
	.trace-text :global(ul + p),
	.trace-text :global(ol + p),
	.trace-text :global(blockquote + p),
	.trace-text :global(p + blockquote) {
		margin-top: 0.55rem;
	}

	.trace-text :global(ul),
	.trace-text :global(ol) {
		padding-left: 1.15rem;
	}

	.trace-text :global(li + li) {
		margin-top: 0.2rem;
	}

	.trace-text :global(h1),
	.trace-text :global(h2),
	.trace-text :global(h3),
	.trace-text :global(h4) {
		margin: 0 0 0.45rem 0;
		font-size: 0.78rem;
		line-height: 1.3rem;
		font-weight: 600;
		color: rgb(255 255 255 / 0.8);
	}

	.trace-text :global(code) {
		border-radius: 0.28rem;
		background: rgb(255 255 255 / 0.05);
		padding: 0.08rem 0.32rem;
		font-size: 0.72rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
			"Courier New", monospace;
		color: rgb(255 255 255 / 0.82);
	}

	.trace-code-wrap {
		margin-top: 0.45rem;
	}

	.trace-code {
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
		border-radius: 0.65rem;
		background: rgb(255 255 255 / 0.03);
		padding: 0.75rem 0.9rem;
		font-size: 0.72rem;
		line-height: 1.45rem;
		color: rgb(255 255 255 / 0.82);
	}

	.trace-code :global(code) {
		background: transparent;
		padding: 0;
		font-size: inherit;
		color: inherit;
	}
</style>
