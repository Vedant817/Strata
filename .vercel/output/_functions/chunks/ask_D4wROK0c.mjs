import { c as askModelBudgets, n as readyDb } from "./db_NRbr6ekn.mjs";
import { c as getProvider, i as resolveKey, t as chosenModel } from "./providerKeys_Dw83htch.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
//#region src/lib/ai/client.ts
/**
* Grounding prompt. Identical for every provider on purpose: the promise is a
* property of the request, not of the vendor.
*/
var GROUNDED_SYSTEM = [
	"You answer questions about a single article using ONLY the quoted passages provided.",
	"Never use outside knowledge. Never speculate. If the passages do not answer the question,",
	"reply with exactly: NOT COVERED",
	"Cite the passage number(s) you used like [1] or [2]. Keep it under 80 words. No preamble."
].join(" ");
function numberedPassages(passages) {
	return passages.map((p, i) => `[${i + 1}] ${p}`).join("\n\n");
}
async function callOpenAI(provider, apiKey, model, passages, question, timeoutMs) {
	const started = Date.now();
	let res;
	try {
		res = await fetch(`${provider.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...provider.id === "openrouter" ? {
					"HTTP-Referer": "https://strata.pub",
					"X-Title": "Strata"
				} : {}
			},
			signal: AbortSignal.timeout(timeoutMs),
			body: JSON.stringify({
				model,
				max_tokens: 300,
				temperature: .2,
				messages: [{
					role: "system",
					content: GROUNDED_SYSTEM
				}, {
					role: "user",
					content: `Passages:\n\n${numberedPassages(passages)}\n\nQuestion: ${question}`
				}]
			})
		});
	} catch (err) {
		return {
			ok: false,
			text: "",
			outcome: "error",
			model,
			latencyMs: Date.now() - started,
			error: `unreachable: ${err.message}`
		};
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		return {
			ok: false,
			text: "",
			outcome: "error",
			model,
			latencyMs: Date.now() - started,
			error: `HTTP ${res.status} ${detail.slice(0, 160)}`
		};
	}
	return interpret((await res.json().catch(() => null))?.choices?.[0]?.message?.content?.trim() ?? "", model, started);
}
async function callAnthropic(provider, apiKey, model, passages, question, timeoutMs) {
	const started = Date.now();
	let res;
	try {
		res = await fetch(`${provider.baseUrl}/v1/messages`, {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json"
			},
			signal: AbortSignal.timeout(timeoutMs),
			body: JSON.stringify({
				model,
				max_tokens: 300,
				system: GROUNDED_SYSTEM,
				messages: [{
					role: "user",
					content: `Passages:\n\n${numberedPassages(passages)}\n\nQuestion: ${question}`
				}]
			})
		});
	} catch (err) {
		return {
			ok: false,
			text: "",
			outcome: "error",
			model,
			latencyMs: Date.now() - started,
			error: `unreachable: ${err.message}`
		};
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		return {
			ok: false,
			text: "",
			outcome: "error",
			model,
			latencyMs: Date.now() - started,
			error: `HTTP ${res.status} ${detail.slice(0, 160)}`
		};
	}
	return interpret((await res.json().catch(() => null))?.content?.find((c) => c.type === "text")?.text?.trim() ?? "", model, started);
}
function interpret(text, model, started) {
	const latencyMs = Date.now() - started;
	if (!text) return {
		ok: true,
		text: "",
		outcome: "abstained",
		model,
		latencyMs
	};
	if (text === "NOT COVERED" || /^\s*NOT COVERED\s*$/i.test(text)) return {
		ok: true,
		text: "",
		outcome: "not_covered",
		model,
		latencyMs
	};
	return {
		ok: true,
		text,
		outcome: "answered",
		model,
		latencyMs
	};
}
async function chatGrounded(args) {
	const provider = getProvider(args.providerId);
	if (!provider) return {
		ok: false,
		text: "",
		outcome: "error",
		model: args.model,
		latencyMs: 0,
		error: `unknown provider "${args.providerId}"`
	};
	if (args.passages.length === 0) return {
		ok: false,
		text: "",
		outcome: "error",
		model: args.model,
		latencyMs: 0,
		error: "no passages"
	};
	const timeout = args.timeoutMs ?? 8e3;
	return provider.wire === "anthropic" ? callAnthropic(provider, args.apiKey, args.model, args.passages, args.question, timeout) : callOpenAI(provider, args.apiKey, args.model, args.passages, args.question, timeout);
}
//#endregion
//#region src/lib/ai/catalog.ts
/**
* Model catalogues, fetched live and filtered for free tiers.
*
* The requirement was "only free models in the selector" for the owner's own
* Groq and OpenRouter keys. A hardcoded list is wrong the moment a provider
* rotates its catalogue: a model gets retired and the picker 500s, or a free
* model is withdrawn and we keep offering a key that now costs money. So the
* list is derived from the provider, at runtime, and cached.
*
* Free detection differs by provider and both signals are used:
*   - OpenRouter tags each model with `pricing.prompt === "0"` and appends
*     `:free` to the id. Both are checked, because the tag is the reliable one
*     and the suffix is a useful sanity check.
*   - Groq publishes no price field, so its free tier is the set of model ids
*     it currently serves that are not marked paid elsewhere; we treat the
*     whole catalogue as free-eligible and let the owner's key's own quota
*     absorb it, which is the honest behaviour for a free-tier key.
*
* A failed fetch is never fatal: the caller's fallback model is used, so the
* Ask feature keeps working when a provider's catalogue endpoint is down.
*/
var CACHE_TTL_MS = 216e5;
var HOLDER$1 = globalThis;
function env(name) {
	const existing = process.env[name];
	if (existing) return existing;
	try {
		const file = readFileSync(resolve(process.cwd(), ".env"), "utf8");
		for (const line of file.split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const at = t.indexOf("=");
			if (at < 0) continue;
			if (t.slice(0, at).trim() !== name) continue;
			return t.slice(at + 1).trim().replace(/^["']|["']$/g, "");
		}
	} catch {}
}
function titleCase(id) {
	return (id.split("/").pop() ?? id).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
}
function openRouterIsFree(m) {
	if (String(m.id ?? "").endsWith(":free")) return true;
	const pricing = m.pricing;
	if (!pricing || pricing.prompt === void 0) return false;
	return Number(pricing.prompt) === 0 && Number(pricing.completion ?? 0) === 0;
}
/**
* Fetch a provider's model list. Returns [] on any failure — the caller falls
* back to the provider's default model.
*/
async function fetchCatalog(provider, apiKey) {
	const url = provider.wire === "anthropic" ? `${provider.baseUrl}/v1/models?limit=1000` : `${provider.baseUrl}/models`;
	const headers = provider.wire === "anthropic" ? {
		"x-api-key": apiKey,
		"anthropic-version": "2023-06-01"
	} : { Authorization: `Bearer ${apiKey}` };
	const res = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(1e4)
	});
	if (!res.ok) return [];
	const body = await res.json().catch(() => null);
	const rows = body?.data ?? body?.models ?? [];
	const out = [];
	for (const m of rows) {
		const id = String(m.id ?? "");
		if (!id) continue;
		const free = provider.id === "openrouter" ? openRouterIsFree(m) : true;
		out.push({
			id,
			label: String(m.name ?? titleCase(id)),
			free
		});
	}
	return out;
}
/**
* Models for a provider, from cache when fresh.
*
* `freeOnly` is the owner's rule for their own keys. When false (a user
* brought their own key) everything the provider offers is fair game, because
* that key is theirs and they chose it.
*/
async function listModels(providerId, apiKey, opts) {
	const provider = getProvider(providerId);
	if (!provider) return [];
	HOLDER$1.__strataCatalog ??= /* @__PURE__ */ new Map();
	const cache = HOLDER$1.__strataCatalog;
	const hit = cache.get(providerId);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return opts.freeOnly ? hit.models.filter((m) => m.free) : hit.models;
	let models = [];
	try {
		models = await fetchCatalog(provider, apiKey);
	} catch {
		models = [];
	}
	if (models.length > 0) cache.set(providerId, {
		at: Date.now(),
		models
	});
	const usable = models.length > 0 ? models : [{
		id: provider.fallbackModel,
		label: provider.fallbackModel,
		free: true
	}];
	return opts.freeOnly ? usable.filter((m) => m.free) : usable;
}
/** The deployment's own key for a provider, if it has one. */
function houseKeyFor(providerId) {
	const provider = getProvider(providerId);
	if (!provider?.envKey) return void 0;
	return env(provider.envKey);
}
//#endregion
//#region src/lib/ai/budget.ts
/**
* Cost boundary, now per (author, provider).
*
* The old table was keyed by post alone, because there was one provider. With
* a dozen, "the cap" is ambiguous: a reader who has burned a Groq quota has
* not spent anything at OpenAI, and a Groq outage should not silence a working
* Anthropic key. So the key is (postId, providerId) and the breaker trips per
* provider, for the same reason the caps are per provider.
*
* Enforcement is still in the database, not process memory: a restart cannot
* reset it and two instances cannot each decide they are the first to spend.
*/
var HOLDER = globalThis;
function limit(name, fallback) {
	HOLDER.__strataAskLimits ??= {};
	const hit = HOLDER.__strataAskLimits[name];
	if (hit !== void 0) return hit;
	const raw = Number(process.env[name]);
	const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
	HOLDER.__strataAskLimits[name] = value;
	return value;
}
var dailyCap = () => limit("ASK_DAILY_CAP", 25);
var breakerAfter = () => limit("ASK_BREAKER_AFTER", 3);
var breakerMs = () => limit("ASK_BREAKER_MS", 6e4);
function dayBucket() {
	return Math.floor(Date.now() / 864e5) * 864e5;
}
async function checkBudget(postId, providerId) {
	const [row] = await (await readyDb()).select().from(askModelBudgets).where(and(eq(askModelBudgets.postId, postId), eq(askModelBudgets.providerId, providerId))).limit(1);
	if (row?.openUntil && row.openUntil > Date.now()) return {
		ok: false,
		reason: `${providerId} is temporarily unavailable after repeated failures.`
	};
	if ((row && row.windowStart === dayBucket() ? row.calls : 0) >= dailyCap()) return {
		ok: false,
		reason: `Daily cap reached for ${providerId}; answering with quotes instead.`
	};
	return { ok: true };
}
async function recordCall(postId, providerId, ok) {
	const database = await readyDb();
	const bucket = dayBucket();
	const [row] = await database.select().from(askModelBudgets).where(and(eq(askModelBudgets.postId, postId), eq(askModelBudgets.providerId, providerId))).limit(1);
	const previous = row?.consecutiveFailures ?? 0;
	const failures = ok ? 0 : previous + 1;
	const openUntil = ok ? null : failures >= breakerAfter() ? Date.now() + breakerMs() : row?.openUntil ?? null;
	const calls = row && row.windowStart === bucket ? row.calls + 1 : 1;
	if (!row) {
		await database.insert(askModelBudgets).values({
			postId,
			providerId,
			windowStart: bucket,
			calls,
			consecutiveFailures: failures,
			openUntil,
			updatedAt: Date.now()
		});
		return;
	}
	await database.update(askModelBudgets).set({
		windowStart: bucket,
		calls,
		consecutiveFailures: failures,
		openUntil,
		updatedAt: Date.now()
	}).where(and(eq(askModelBudgets.postId, postId), eq(askModelBudgets.providerId, providerId)));
}
//#endregion
//#region src/lib/ai/ask.ts
async function resolve$1(userId) {
	if (userId) {
		const key = await resolveKey(userId, "anthropic").catch(() => null);
		if (key) return {
			providerId: "anthropic",
			model: await chosenModel(userId, "anthropic").catch(() => null) ?? "claude-sonnet-4-5",
			key,
			paidBy: "reader"
		};
	}
	for (const candidate of [
		"openrouter",
		"groq",
		"anthropic"
	]) {
		const key = houseKeyFor(candidate);
		if (!key) continue;
		const provider = getProvider(candidate);
		if (!provider) continue;
		return {
			providerId: candidate,
			model: provider.fallbackModel,
			key,
			paidBy: "house"
		};
	}
	return null;
}
/**
* Attempt a grounded model answer. Returns null for every non-answer so the
* caller can show quotes. Never throws.
*/
async function answerFromAnyModel(postId, userId, passages, question) {
	if (passages.length === 0) return null;
	let chosen;
	try {
		chosen = await resolve$1(userId);
	} catch (err) {
		console.error("[strata] model resolve failed:", err);
		return null;
	}
	if (!chosen) return null;
	if (!(await checkBudget(postId, chosen.providerId).catch(() => ({ ok: true }))).ok) return null;
	const result = await chatGrounded({
		providerId: chosen.providerId,
		apiKey: chosen.key,
		model: chosen.model,
		passages: passages.map((p) => p.replace(/<\/?mark>/g, "")),
		question
	}).catch(() => null);
	if (!result) return null;
	await recordCall(postId, chosen.providerId, result.ok).catch(() => {});
	if (!result.ok || result.outcome !== "answered") return null;
	return {
		text: result.text,
		model: result.model,
		providerId: chosen.providerId,
		label: `${chosen.providerId} / ${result.model}`,
		latencyMs: result.latencyMs
	};
}
/**
* What the model picker should show. The owner's keys are restricted to free
* models; a reader's own key can see everything that key can reach, because
* they chose it and they pay.
*/
async function modelsFor(providerId, userId) {
	const provider = getProvider(providerId);
	if (!provider) return [];
	let key = userId ? await resolveKey(userId, providerId).catch(() => null) : null;
	const usingHouse = !key;
	if (!key) key = houseKeyFor(providerId) ?? null;
	if (!key) return [{
		id: provider.fallbackModel,
		label: provider.fallbackModel,
		free: true
	}];
	const models = await listModels(providerId, key, { freeOnly: usingHouse });
	if (models.length > 0) return models;
	return [{
		id: provider.fallbackModel,
		label: provider.fallbackModel,
		free: true
	}];
}
//#endregion
export { modelsFor as n, answerFromAnyModel as t };
