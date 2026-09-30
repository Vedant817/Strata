import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { c as getProvider } from "./providerKeys_Dw83htch.mjs";
import { n as modelsFor } from "./ask_D4wROK0c.mjs";
//#region src/pages/api/models.ts
var models_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* The model catalogue for the picker.
*
* Two rules, both enforced here rather than in the browser:
*   - The deployment's own keys only ever return free models. The owner's
*     Groq and OpenRouter are a shared resource; a reader must not be able to
*     spend the owner's money on a paid tier by editing a request.
*   - A reader's own key gets the full catalogue, because it is their key.
*
* An unknown provider, or a provider with no usable key, returns an empty list
* rather than an error — the picker simply shows the provider's default model.
*/
var GET = async ({ url, cookies }) => {
	const providerId = url.searchParams.get("provider") ?? "";
	if (!getProvider(providerId)) return new Response(JSON.stringify({ error: "Unknown provider." }), {
		status: 400,
		headers: { "content-type": "application/json" }
	});
	const identity = await getIdentity(cookies);
	const models = await modelsFor(providerId, identity.userId);
	return new Response(JSON.stringify({ models }), { headers: {
		"content-type": "application/json",
		"cache-control": "no-store"
	} });
};
//#endregion
//#region \0virtual:astro:page:src/pages/api/models@_@ts
var page = () => models_exports;
//#endregion
export { page };
