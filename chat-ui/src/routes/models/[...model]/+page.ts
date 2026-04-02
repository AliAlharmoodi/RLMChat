import { base } from "$app/paths";
import { stripLegacyRlmPrefix, isLegacyRlmModelId } from "$lib/utils/models";

export async function load({ params, parent, fetch }) {
	const modelId = stripLegacyRlmPrefix(params.model);

	await fetch(`${base}/api/v2/models/${modelId}/subscribe`, {
		method: "POST",
	});

	return {
		settings: await parent().then((data) => ({
			...data.settings,
			activeModel: modelId,
			rlmMode: isLegacyRlmModelId(params.model) ? true : data.settings.rlmMode,
		})),
	};
}
