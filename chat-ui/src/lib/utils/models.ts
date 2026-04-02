import type { Model } from "$lib/types/Model";

export const LEGACY_RLM_PREFIX = "rlm/";

export const isLegacyRlmModelId = (modelId: string) => modelId.startsWith(LEGACY_RLM_PREFIX);

export const stripLegacyRlmPrefix = (modelId: string) =>
	isLegacyRlmModelId(modelId) ? modelId.slice(LEGACY_RLM_PREFIX.length) : modelId;

export const findCurrentModel = (
	models: Model[],
	_oldModels: { id: string; transferTo?: string }[] = [],
	id?: string
): Model => {
	if (id) {
		const direct = models.find((m) => m.id === id);
		if (direct) return direct;

		if (isLegacyRlmModelId(id)) {
			const normalized = stripLegacyRlmPrefix(id);
			const legacy = models.find((m) => m.id === normalized);
			if (legacy) return legacy;
		}
	}

	return models[0];
};
