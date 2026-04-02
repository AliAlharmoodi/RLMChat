export type TraceDetailLine = {
	label: string;
	content: string;
	rawContent?: string;
	kind?: "text" | "code" | "output" | "error";
};

export type IterationBlock = {
	title: string;
	content: string;
};

export type IterationSection = {
	title?: string;
	content: string;
	renderAsCode?: boolean;
	chromeLabel?: string;
	chromeTone?: "neutral" | "error";
	kind?: "response" | "code" | "stdout" | "stderr" | "final" | "text";
};

const withTemporaryMarkdownClosers = (value: string) => {
	let output = value;
	const fenceCount = (output.match(/```/g) ?? []).length;
	if (fenceCount % 2 === 1) {
		output += "\n```";
	}
	return output;
};

export const renderTraceContent = (value: string) =>
	withTemporaryMarkdownClosers(value)
		.replace(/```repl\s*/gi, "```python\n")
		.replace(/FINAL\(([\s\S]*?)\)\s*$/g, "$1")
		.replace(/FINAL_VAR\(([\s\S]*?)\)\s*$/g, "$1")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

export const splitIntoIterationBlocks = (value: string): IterationBlock[] => {
	const normalized = renderTraceContent(value);
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

const normalizeForComparison = (value: string) =>
	value
		.replace(/```[\w-]*\n?/g, "")
		.replace(/```/g, "")
		.replace(/\s+/g, " ")
		.trim();

const normalizeCodeBody = (value: string) =>
	value
		.replace(/^```[\w-]*\n?/, "")
		.replace(/\n?```$/, "")
		.trim();

const stripCodeLinesFromResponse = (content: string, codeSections: IterationSection[]) => {
	let result = content;

	for (const section of codeSections) {
		const code = normalizeCodeBody(section.content);
		if (!code) continue;

		result = result.replace(code, "");
	}

	return result
		.split("\n")
		.map((line) => line.replace(/\s+$/g, ""))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
};

const stripDuplicateCodeFromResponse = (content: string, codeSections: IterationSection[]) => {
	if (!content.trim() || codeSections.length === 0) return content.trim();

	const normalizedCodeSections = new Set(
		codeSections.map((section) => normalizeForComparison(section.content)).filter(Boolean)
	);

	const strippedContent = stripCodeLinesFromResponse(content, codeSections);
	const paragraphs = strippedContent
		.split(/\n\s*\n/g)
		.map((part) => part.trim())
		.filter(Boolean)
		.filter((part) => !normalizedCodeSections.has(normalizeForComparison(part)));

	return paragraphs.join("\n\n").trim();
};

const wrapAsCodeFence = (content: string, language = "") => {
	const normalizedLanguage = language.trim();
	return `\`\`\`${normalizedLanguage}\n${content.trim()}\n\`\`\``;
};

const stripWorkerModelBanner = (value: string) => {
	const normalized = value.trim();
	const lines = normalized.split("\n");
	const firstLine = lines[0]?.trim() ?? "";
	if (/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(firstLine) && lines.length > 1) {
		return lines.slice(1).join("\n").trim();
	}
	return normalized;
};

const isOutputSection = (title?: string) => title === "Stdout" || title === "Stderr";
const toChromeLabel = (title?: string) => {
	if (title === "Stderr") return "Error";
	return undefined;
};

export const parseIterationSections = (value: string): IterationSection[] => {
	const lines = value.split("\n");
	const sections: IterationSection[] = [];
	const headingPattern = /^(Response|Code block \d+|Stdout|Stderr|Final answer)$/;
	let currentTitle: string | undefined;
	let currentLines: string[] = [];

	const flush = () => {
		const content = currentLines.join("\n").trim();
		if (!content) {
			currentTitle = undefined;
			currentLines = [];
			return;
		}

		const isCodeBlock = Boolean(currentTitle && /^Code block \d+$/.test(currentTitle));
		const isOutput = isOutputSection(currentTitle);
		const shouldRenderAsCode = isCodeBlock || isOutputSection(currentTitle);
		sections.push({
			title: isCodeBlock || isOutput ? undefined : currentTitle,
			content: shouldRenderAsCode
				? isCodeBlock && content.startsWith("```")
					? content
					: wrapAsCodeFence(content, isCodeBlock ? "python" : "")
				: content,
			renderAsCode: shouldRenderAsCode,
			chromeLabel: toChromeLabel(currentTitle),
			chromeTone: currentTitle === "Stderr" ? "error" : currentTitle === "Stdout" ? "neutral" : undefined,
			kind: isCodeBlock
				? "code"
				: currentTitle === "Stdout"
					? "stdout"
					: currentTitle === "Stderr"
						? "stderr"
						: currentTitle === "Final answer"
							? "final"
							: currentTitle === "Response"
								? "response"
								: "text",
		});
		currentTitle = undefined;
		currentLines = [];
	};

	for (const line of lines) {
		if (headingPattern.test(line.trim())) {
			flush();
			currentTitle = line.trim();
			continue;
		}
		currentLines.push(line);
	}
	flush();

	const codeSections = sections.filter((section) => section.kind === "code");
	return sections
		.map((section) => {
			const shouldStripDuplicateCode =
				section.title === "Response" ||
				(section.kind === "text" && section.renderAsCode !== true);
			if (!shouldStripDuplicateCode) return section;
			return {
				...section,
				content: stripDuplicateCodeFromResponse(section.content, codeSections),
			};
		})
		.filter((section) => {
			const shouldFilterEmptyAfterStrip =
				section.title === "Response" ||
				(section.kind === "text" && section.renderAsCode !== true);
			if (!shouldFilterEmptyAfterStrip) return true;
			const normalized = normalizeForComparison(section.content);
			if (!normalized) return false;
			return !codeSections.some(
				(codeSection) => normalizeForComparison(codeSection.content) === normalized
			);
		});
};

export const buildFormattedTraceSections = (detailLines: TraceDetailLine[]) =>
	detailLines.flatMap((detail) => {
		const normalizedContent =
			detail.kind === "output" ? stripWorkerModelBanner(detail.content) : detail.content;
		const blocks = splitIntoIterationBlocks(normalizedContent);
		if (detail.label === "Root model outputs" && blocks.length > 1) {
			return blocks.map((block) => ({
				label: block.title || detail.label,
				blocks: parseIterationSections(block.content),
			}));
		}

		return [
			{
				label: detail.label,
				blocks: blocks.flatMap((block) => {
					const parsed = parseIterationSections(block.content);
					if (parsed.length > 0) return parsed;
					return [{ title: block.title, content: block.content }];
				}),
			},
		];
	});
