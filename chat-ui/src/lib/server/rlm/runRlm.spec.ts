import { describe, expect, it } from "vitest";

import type { RlmSnapshotMessage } from "./runRlm";
import { shouldResetPersistentSession } from "./runRlm";

const msg = (role: RlmSnapshotMessage["role"], content: string): RlmSnapshotMessage => ({
	role,
	content,
});

describe("shouldResetPersistentSession", () => {
	it("does not reset for linear continuation on the same branch", () => {
		expect(
			shouldResetPersistentSession({
				previousPreprompt: "",
				nextPreprompt: "",
				previousMessages: [msg("user", "A"), msg("assistant", "B")],
				nextMessages: [msg("user", "A"), msg("assistant", "B"), msg("user", "C")],
			})
		).toBe(false);
	});

	it("resets when editing the latest user message", () => {
		expect(
			shouldResetPersistentSession({
				previousPreprompt: "",
				nextPreprompt: "",
				previousMessages: [msg("user", "Original"), msg("assistant", "Answer")],
				nextMessages: [msg("user", "Edited"), msg("assistant", "")],
			})
		).toBe(true);
	});

	it("resets when editing an earlier message in a deeper branch", () => {
		expect(
			shouldResetPersistentSession({
				previousPreprompt: "",
				nextPreprompt: "",
				previousMessages: [
					msg("user", "Root"),
					msg("assistant", "A1"),
					msg("user", "Follow-up"),
					msg("assistant", "A2"),
					msg("user", "Deep question"),
				],
				nextMessages: [
					msg("user", "Root"),
					msg("assistant", "A1"),
					msg("user", "Edited follow-up"),
					msg("assistant", ""),
				],
			})
		).toBe(true);
	});

	it("resets when switching to a sibling branch with the same depth", () => {
		expect(
			shouldResetPersistentSession({
				previousPreprompt: "",
				nextPreprompt: "",
				previousMessages: [
					msg("user", "Root"),
					msg("assistant", "Branch one"),
					msg("user", "Question on branch one"),
				],
				nextMessages: [
					msg("user", "Root"),
					msg("assistant", "Branch two"),
					msg("user", "Question on branch two"),
				],
			})
		).toBe(true);
	});

	it("resets when the preprompt changes even if the messages do not", () => {
		expect(
			shouldResetPersistentSession({
				previousPreprompt: "Old system",
				nextPreprompt: "New system",
				previousMessages: [msg("user", "A")],
				nextMessages: [msg("user", "A")],
			})
		).toBe(true);
	});
});
