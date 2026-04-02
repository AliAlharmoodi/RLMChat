import { describe, expect, it } from "vitest";

import { buildFormattedTraceSections, parseIterationSections } from "./rlmTraceFormatting";

describe("rlmTraceFormatting", () => {
	it("removes duplicate response code when a matching code block section exists", () => {
		const content = [
			"Response",
			'print("Context variable:", context)',
			'print("\\n--- Checking all available variables ---")',
			"print(SHOW_VARS())",
			"",
			"Code block 1",
			"```python",
			'print("Context variable:", context)',
			'print("\\n--- Checking all available variables ---")',
			"print(SHOW_VARS())",
			"```",
			"",
			"Stdout",
			"Context variable: {'kind': 'chat_ui_conversation_delta'}",
			"--- Checking all available variables ---",
			"Available variables: {'context': 'dict', 'final_response': 'str'}",
		].join("\n");

		const sections = parseIterationSections(content);

		expect(sections).toHaveLength(2);
		expect(sections[0]).toMatchObject({
			title: undefined,
			renderAsCode: true,
		});
		expect(sections[0].content).toContain('print("Context variable:", context)');
		expect(sections[1]).toMatchObject({
			title: undefined,
			renderAsCode: true,
			chromeLabel: undefined,
		});
		expect(sections[1].content).toContain("```");
		expect(sections.find((section) => section.title === "Response")).toBeUndefined();
	});

	it("keeps non-duplicate response prose alongside code and output sections", () => {
		const content = [
			"Response",
			"Let me inspect the variables first.",
			"",
			"Code block 1",
			"```python",
			"print(SHOW_VARS())",
			"```",
			"",
			"Stdout",
			"{'context': 'dict'}",
		].join("\n");

		const sections = parseIterationSections(content);

		expect(sections).toHaveLength(3);
		expect(sections[0]).toMatchObject({
			title: "Response",
			renderAsCode: false,
			content: "Let me inspect the variables first.",
		});
		expect(sections[1]).toMatchObject({
			title: undefined,
			renderAsCode: true,
		});
		expect(sections[2]).toMatchObject({
			title: undefined,
			renderAsCode: true,
			chromeLabel: undefined,
		});
	});

	it("strips a leading worker model banner in worker output details", () => {
		const formatted = buildFormattedTraceSections([
			{
				label: "Worker",
				kind: "output",
				content: ["provider/model-name", "", "Here is the worker response."].join("\n"),
			},
		]);

		expect(formatted).toHaveLength(1);
		expect(formatted[0]?.blocks).toHaveLength(1);
		expect(formatted[0]?.blocks[0]?.content).toBe("Here is the worker response.");
	});

	it("removes executed code from mixed response text when the same code block exists later", () => {
		const content = [
			"print(context)",
			"",
			"Let me understand the context structure",
			"",
			"print(type(context))",
			"print(repr(context))",
			"",
			"Code block 1",
			"```python",
			"print(context)",
			"```",
			"",
			"Code block 2",
			"```python",
			"print(type(context))",
			"print(repr(context))",
			"```",
		].join("\n");

		const sections = parseIterationSections(content);

		expect(sections).toHaveLength(3);
		expect(sections[0]?.content).toBe("Let me understand the context structure");
		expect(sections[1]).toMatchObject({ title: undefined, renderAsCode: true });
		expect(sections[2]).toMatchObject({ title: undefined, renderAsCode: true });
	});
});
