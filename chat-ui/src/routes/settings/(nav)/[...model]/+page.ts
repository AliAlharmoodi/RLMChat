import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import { stripLegacyRlmPrefix } from "$lib/utils/models";

export async function load({ parent, params }) {
	const data = await parent();
	const modelId = stripLegacyRlmPrefix(params.model);

	const model = data.models.find((m: { id: string }) => m.id === modelId);

	if (!model || model.unlisted) {
		redirect(302, `${base}/settings`);
	}

	return data;
}
