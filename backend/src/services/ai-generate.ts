/**
 * Provider-side AI generation. Extracted from routes/ai.ts so server-side callers
 * (the citizen brief pipeline) and the client proxy route both run the exact same
 * provider chain.
 *
 * MODEL CHOICE IS CLASSIFIED UP FRONT, NOT DISCOVERED BY TRIAL.
 * classifyBriefJob() picks the model from the document's size and type — plain
 * arithmetic, no AI call — so a job goes to the right model on the first attempt.
 * Walking a ladder of models would cost time on every job to save money on a few.
 * A second provider is touched ONLY when the first one hard-fails (outage or
 * exhausted rate limit), because the alternative is no brief at all.
 *
 * Provider API keys never leave the server.
 */
import { env } from "../env";
import { INCIDENT_AI_ALL_FAILED, INCIDENT_AI_MODEL, reportIncident } from "./service-incidents";

export type AIProvider = "gemini" | "openai";

export interface AIGenerateParams {
  system?: string;
  prompt: string;
  model?: string;
  maxCompletionTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  /**
   * Classified target provider. Omitted by the client proxy route, which keeps
   * the historical "free tier first" order.
   */
  provider?: AIProvider;
  /**
   * Give up on the provider after this long.
   *
   * THERE WAS NO TIMEOUT HERE AT ALL, and it took down live search. A model
   * given room to reason can spend a long time doing it; with no ceiling the
   * request simply hung, the search endpoint never answered, and Railway's
   * edge returned 502 "Application failed to respond" after 36 seconds. The
   * server was healthy the whole time and the log said nothing, because
   * nothing had failed — it was still waiting.
   *
   * A brief is background work and can afford to wait. A search box cannot.
   */
  timeoutMs?: number;
  /**
   * Room for the model to think, on top of the answer asked for.
   *
   * Defaults to a generous allowance because a truncated brief is worse than a
   * slow one. Interactive callers pass something smaller: a short JSON
   * extraction does not need twelve thousand tokens of deliberation, and every
   * one it is offered is one it may decide to use.
   */
  reasoningHeadroom?: number;
}

export type AIGenerateResult =
  | { ok: true; content: string; provider: AIProvider; model: string }
  | { ok: false; error: string; status: 502 | 503 };

export function aiAvailability(): { gemini: boolean; openai: boolean } {
  return {
    gemini: !!env.GEMINI_API_KEY,
    openai: !!env.OPENAI_API_KEY,
  };
}

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

/**
 * Per-model ceiling on a single request. `tpmTokens` is the account's real
 * tokens-per-minute limit for that model (verified against the provider — the
 * mini tier is capped lower than the flagship, which is exactly why chunk size
 * has to follow the chosen model rather than being a fixed constant).
 */
interface ModelSpec {
  provider: AIProvider;
  tpmTokens: number;
}

const MODEL_SPECS: Record<string, ModelSpec> = {
  "gemini-3.6-flash": { provider: "gemini", tpmTokens: 250_000 },
  "gpt-5.4-mini": { provider: "openai", tpmTokens: 200_000 },
  "gpt-5.2": { provider: "openai", tpmTokens: 500_000 },

  // THE SAFETY NET. Older, slower, cheaper, and — the only property that
  // matters here — still served. A model name is not a constant: providers
  // retire them, move them behind a tier, or rename them, and when that
  // happens the name in the line above becomes a 404 on every single call.
  // These exist so that being wrong about the newest name costs quality for a
  // few days instead of taking the Citizen's Brief off the air.
  "gemini-2.5-flash": { provider: "gemini", tpmTokens: 250_000 },
  "gemini-2.0-flash": { provider: "gemini", tpmTokens: 200_000 },
  "gpt-4o-mini": { provider: "openai", tpmTokens: 200_000 },
  "gpt-4o": { provider: "openai", tpmTokens: 450_000 },
};

/**
 * EVERY MODEL WORTH TRYING, BEST FIRST.
 *
 * WHY THIS EXISTS, in the owner's words: "whatever is happening keeps
 * happening again and makes it fail. there needs to be redundancies in place."
 *
 * It kept happening because there was exactly ONE model per provider. Fall over
 * from Gemini to OpenAI existed, but if both names were unusable — retired,
 * renamed, or not on this account's tier — there was nothing left to try and
 * every brief on the platform failed at once, wearing a message that said "try
 * again shortly" about a problem that would never resolve on its own.
 *
 * Now a provider is a LIST. A model that answers "I do not exist" or "you have
 * no access" is struck off and the next one is tried in the same request, so
 * the reader gets their brief rather than an apology.
 */
const MODEL_CHAINS: Record<AIProvider, string[]> = {
  gemini: ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash"],
  openai: ["gpt-5.4-mini", "gpt-4o-mini", "gpt-4o"],
};

/**
 * Models this process has been told, by the provider itself, that it cannot
 * use — a 404 on the name, or no access on this key.
 *
 * REMEMBERED SO THE TAX IS PAID ONCE. Without this, every brief re-discovers
 * the same dead model and pays a round trip for it. Held for an hour rather
 * than forever, because a model can come back — a tier is upgraded, an outage
 * ends — and a permanent strike-off would need a redeploy to undo.
 */
const struckOff = new Map<string, number>();
const STRIKE_OFF_MS = 60 * 60 * 1000;

/**
 * Is this the provider saying "that model is not something you can call"?
 *
 * Deliberately narrow. A rate limit, a timeout or a 500 says nothing about the
 * NAME being wrong, and striking a good model off for a busy minute would make
 * the platform permanently dumber every time a provider had a bad afternoon.
 */
function modelIsUnusable(status: number | undefined, error: string): boolean {
  if (status === 404) return true;
  if (status === 400 && /model|not found|does not exist|unsupported/i.test(error)) return true;
  if (status === 403 && /model|access|permission/i.test(error)) return true;
  return false;
}

function isStruckOff(model: string): boolean {
  const when = struckOff.get(model);
  if (when === undefined) return false;
  if (Date.now() - when > STRIKE_OFF_MS) {
    struckOff.delete(model);
    return false;
  }
  return true;
}

/** What this process currently knows about model availability. For the admin panel. */
export function modelAvailability(): { model: string; provider: AIProvider; struckOff: boolean }[] {
  return (Object.keys(MODEL_CHAINS) as AIProvider[]).flatMap((provider) =>
    MODEL_CHAINS[provider].map((model) => ({ model, provider, struckOff: isStruckOff(model) })),
  );
}

/** For tests, so one does not inherit another's strike-offs. */
export function forgetStruckOffModels(): void {
  struckOff.clear();
}

/**
 * gemini-2.0-flash was the previous default and now returns a hard
 * "free_tier_requests limit: 0" on this project — the free allowance moved to
 * the newer flash models. Keep this pointed at a model the free tier actually
 * serves, or the light lane pays a retry stall on every job before failing over.
 */
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
/** Cheap by default: an unclassified caller should not land on the priciest model. */
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

/** Room left for the rolling draft in the prompt plus the model's own output. */
const RESERVED_TOKENS = 8_000;
/** English legal prose runs ~4 characters per token; 0.85 keeps a margin. */
const CHARS_PER_TOKEN = 4;
const BUDGET_SAFETY = 0.85;

/** Largest official-text slice this model can take in one request. */
export function safeInputChars(model: string): number {
  const spec = MODEL_SPECS[model];
  const tpm = spec?.tpmTokens ?? 200_000;
  return Math.floor(Math.max(tpm - RESERVED_TOKENS, 10_000) * CHARS_PER_TOKEN * BUDGET_SAFETY);
}

export function providerFor(model: string): AIProvider {
  return MODEL_SPECS[model]?.provider ?? "openai";
}

/**
 * Room the model needs to think in, on top of the answer we asked for.
 *
 * THE FAILURE THIS EXISTS FOR. Every current model from both providers reasons
 * before it writes, and the reasoning is billed against the SAME output budget
 * as the visible answer. Ask for 1200 tokens and the model can spend all 1200
 * thinking, then stop: the provider returns 200 OK, finish_reason "length", and
 * an empty string. The caller sees a successful call with no content, fails to
 * parse JSON out of nothing, and reports "no official text is published" — for
 * a bill whose text is sitting in the database.
 *
 * That is what "none of the citizen briefs are working" looked like from the
 * outside, across all three branches at once, with every source key valid.
 *
 * So callers state the size of the ANSWER they want and this adds the thinking
 * room. Unused budget is not billed; a truncated brief is.
 */
const REASONING_HEADROOM_TOKENS = 12_000;

function requestBudget(requested: number | undefined, headroom: number | undefined): number {
  return (requested ?? 800) + (headroom ?? REASONING_HEADROOM_TOKENS);
}

/** No ceiling at all is what 502'd live search; this is the default one. */
const DEFAULT_AI_TIMEOUT_MS = 60_000;

/**
 * A 200 with nothing in it is a failure, and has to be reported as one.
 *
 * Returning `ok: true` with an empty string sends the emptiness downstream to
 * whatever parses the response, where it becomes an unexplained null. Naming it
 * here does two things: the other provider gets tried, and the log says which
 * model returned nothing and why it stopped.
 */
function emptyCompletion(
  model: string,
  finishReason: string | null,
): { ok: false; error: string; status?: number } {
  const why =
    finishReason && /length|max_tokens/i.test(finishReason)
      ? `it stopped at the output limit (${finishReason}) — the reasoning budget consumed the whole allowance`
      : `it stopped with finish reason "${finishReason ?? "unknown"}"`;
  return { ok: false, error: `${model} returned an empty completion: ${why}` };
}

// ---------------------------------------------------------------------------
// Classification — decided before the first call, from size and type alone
// ---------------------------------------------------------------------------

export type BriefLane = "light" | "standard" | "heavy";

/** Short, plain documents (most executive orders and bills) ride the free tier. */
const LIGHT_MAX_CHARS = 60_000;
/** Past this, a bill is dense enough that the final write-up earns the flagship. */
const HEAVY_MIN_CHARS = 1_000_000;

export interface BriefJobPlan {
  lane: BriefLane;
  /** Model for the reading passes that pull facts out of the official text. */
  readModel: string;
  /** Model for the pass that produces the brief the user actually reads. */
  writeModel: string;
  /** Model that checks the finished brief against the official text. */
  factCheckModel: string;
  /** Text slice per pass — sized for readModel, which is never the larger one. */
  chunkChars: number;
}

/**
 * Route a brief job to the right model before any call is made.
 *
 *   light    — short, plain documents            → free Gemini Flash
 *   standard — ordinary bills                    → gpt-5.4-mini
 *   heavy    — SCOTUS opinions, giant bills      → mini reads, flagship writes
 *
 * The heavy split is the point: reading passes are mechanical fact-pulling that
 * mini does well, so only the single final write-up pays flagship prices.
 */
export function classifyBriefJob(input: { referenceType: string; textChars: number }): BriefJobPlan {
  const { referenceType, textChars } = input;
  const heavy = referenceType === "scotus_case" || textChars > HEAVY_MIN_CHARS;

  if (heavy) {
    const readModel = "gpt-5.4-mini";
    return {
      lane: "heavy",
      readModel,
      writeModel: "gpt-5.2",
      factCheckModel: readModel,
      chunkChars: safeInputChars(readModel),
    };
  }

  if (textChars <= LIGHT_MAX_CHARS) {
    return {
      lane: "light",
      readModel: DEFAULT_GEMINI_MODEL,
      writeModel: DEFAULT_GEMINI_MODEL,
      factCheckModel: DEFAULT_GEMINI_MODEL,
      chunkChars: safeInputChars(DEFAULT_GEMINI_MODEL),
    };
  }

  const readModel = DEFAULT_OPENAI_MODEL;
  return {
    lane: "standard",
    readModel,
    writeModel: readModel,
    factCheckModel: readModel,
    chunkChars: safeInputChars(readModel),
  };
}

async function generateWithGemini(
  apiKey: string,
  model: string,
  { system, prompt, maxCompletionTokens, temperature, jsonMode, timeoutMs, reasoningHeadroom }: AIGenerateParams
): Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: temperature ?? 0.7,
          maxOutputTokens: requestBudget(maxCompletionTokens, reasoningHeadroom),
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", errorText);
    return { ok: false, error: errorText, status: response.status };
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const candidate = data.candidates?.[0];
  // Gemini splits a long answer across parts; joining them is not optional.
  const content = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) return emptyCompletion(model, candidate?.finishReason ?? null);
  return { ok: true, content };
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  { system, prompt, maxCompletionTokens, temperature, jsonMode, timeoutMs, reasoningHeadroom }: AIGenerateParams,
  omitTemperature = false
): Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
      max_completion_tokens: requestBudget(maxCompletionTokens, reasoningHeadroom),
      ...(omitTemperature ? {} : { temperature: temperature ?? 0.7 }),
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI API error:", errorText);
    // Some models accept only the default temperature. Drop the knob and retry
    // once rather than failing — this keeps new models drop-in compatible.
    if (!omitTemperature && /temperature/i.test(errorText) && /support/i.test(errorText)) {
      console.warn(`[AI] ${model} rejected temperature — retrying without it`);
      return generateWithOpenAI(
        apiKey,
        model,
        { system, prompt, maxCompletionTokens, jsonMode, timeoutMs, reasoningHeadroom },
        true,
      );
    }
    return { ok: false, error: errorText, status: response.status };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const content = (choice?.message?.content ?? "").trim();
  if (!content) return emptyCompletion(model, choice?.finish_reason ?? null);
  return { ok: true, content };
}

/**
 * Rate limits (429) are transient — the provider tells us how long to wait
 * ("Please try again in 3.008s"). Waiting and retrying is the difference
 * between a verified brief and an unverified one on big back-to-back calls.
 */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_MAX_WAIT_MS = 90_000;

function retryDelayMs(errorText: string): number {
  const seconds = errorText.match(/(?:try again|retry) in ([\d.]+)\s*s/i)?.[1];
  const delay = seconds ? Math.ceil(Number(seconds) * 1000) + 500 : 15_000;
  return Math.min(delay, RATE_LIMIT_MAX_WAIT_MS);
}

/**
 * A per-minute limit clears on its own; an exhausted daily allowance (or a plan
 * with no allowance at all — "limit: 0") does not. Waiting on those just adds
 * dead time to every job, so hand off to the other provider immediately.
 */
function isExhaustedQuota(errorText: string): boolean {
  return /limit:\s*0\b/i.test(errorText) || /PerDay/i.test(errorText);
}

/** One provider, retried through its own rate limit before anything else is tried. */
async function runProvider(
  provider: AIProvider,
  key: string,
  model: string,
  params: AIGenerateParams
  // THE STATUS COMES OUT WITH THE ERROR. Without it the caller cannot tell
  // "this model does not exist" from "this model is busy" — and those need
  // opposite responses: strike the first off, wait out the second.
): Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }> {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    const result =
      provider === "gemini"
        ? await generateWithGemini(key, model, params)
        : await generateWithOpenAI(key, model, params);
    if (result.ok) return result;
    if (result.status !== 429 || attempt === RATE_LIMIT_RETRIES) {
      return { ok: false, error: result.error, status: result.status };
    }
    if (isExhaustedQuota(result.error)) {
      console.warn(`[AI] ${model} quota exhausted (not a per-minute limit) — handing off immediately`);
      return { ok: false, error: result.error };
    }
    const delay = retryDelayMs(result.error);
    console.warn(
      `[AI] ${model} rate limited — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${RATE_LIMIT_RETRIES})`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return { ok: false, error: "Exhausted rate-limit retries" };
}

/**
 * Send the job to its classified model. The other provider is a safety net for a
 * hard failure only — it is never tried speculatively, so a normal job costs
 * exactly one model's time.
 *
 * Callers that pass no provider/model (the client proxy route) keep the original
 * free-tier-first order.
 */
export async function generateAI(params: AIGenerateParams): Promise<AIGenerateResult> {
  const keys: Record<AIProvider, string | undefined> = {
    gemini: env.GEMINI_API_KEY,
    openai: env.OPENAI_API_KEY,
  };

  if (!keys.gemini && !keys.openai) {
    return { ok: false, error: "No AI API key configured on server", status: 503 };
  }

  let lastError: string | null = null;
  const target = params.provider ?? (params.model ? providerFor(params.model) : undefined);
  const order: AIProvider[] = target
    ? [target, target === "gemini" ? "openai" : "gemini"]
    : ["gemini", "openai"];

  /**
   * The models to try for this provider, best first.
   *
   * An explicitly requested model goes first ON ITS OWN PROVIDER, then the rest
   * of that provider's chain. Anything the provider has already told us it will
   * not serve is skipped without paying for the round trip.
   */
  const chainFor = (provider: AIProvider): string[] => {
    const chain = MODEL_CHAINS[provider];
    const preferred =
      params.model && providerFor(params.model) === provider ? [params.model] : [];
    return [...new Set([...preferred, ...chain])].filter((model) => !isStruckOff(model));
  };

  /** The first model in this provider's chain — what SHOULD have answered. */
  const primaryOf = (provider: AIProvider): string => MODEL_CHAINS[provider][0]!;

  try {
    for (const provider of order) {
      const key = keys[provider];
      if (!key) continue;

      const chain = chainFor(provider);
      if (chain.length === 0) continue;

      for (const model of chain) {
        const result = await runProvider(provider, key, model, params);

        if (result.ok) {
          // IT WORKED — BUT SAY SO IF IT WAS NOT THE ONE WE WANTED.
          //
          // "the initial method fails, its reported to the admin and falls back
          // on the redundancy til I've had time to address the initial
          // failure." Serving from the safety net silently is how this went
          // unnoticed three times; the reader gets their brief AND the failure
          // is on the record.
          const primary = primaryOf(provider);
          if (model !== primary && lastError) {
            void reportIncident({
              kind: INCIDENT_AI_MODEL,
              subject: primary,
              fallback: model,
              detail: lastError,
            });
          }
          return { ok: true, content: result.content, provider, model };
        }

        lastError = `${model}: ${result.error.slice(0, 300)}`;
        console.warn(`[AI] ${model} failed on ${provider}: ${result.error.slice(0, 300)}`);

        // A NAME THE PROVIDER WILL NOT SERVE is struck off, so the next brief
        // does not re-learn it. A rate limit or a 500 is NOT that: those say
        // nothing about the name, and striking a good model off for a busy
        // minute would make the platform permanently worse after any bad hour.
        if (modelIsUnusable(result.status, result.error)) {
          struckOff.set(model, Date.now());
          console.warn(`[AI] ${model} struck off for an hour — the provider will not serve it`);
          void reportIncident({
            kind: INCIDENT_AI_MODEL,
            subject: model,
            fallback: null,
            detail: result.error.slice(0, 500),
          });
          continue;
        }

        // Anything else: try the next model in the chain anyway. A model that
        // is rate limited or having a bad minute is not a reason to give the
        // reader nothing when another one is sitting there.
      }
    }

    // NOTHING ANSWERED. This is the state the owner met three times, and it is
    // now recorded rather than only logged.
    void reportIncident({
      kind: INCIDENT_AI_ALL_FAILED,
      subject: "every configured model",
      fallback: null,
      detail: lastError ?? "no provider key is configured",
    });

    // Carry the provider's own words out of here. "Failed to generate content"
    // is the sentence that hid an empty-completion bug behind a message about
    // unpublished laws; whatever actually went wrong belongs in the log and in
    // the reason the caller reports.
    return { ok: false, error: lastError ?? "No usable AI provider configured", status: 502 };
  } catch (error) {
    console.error("AI generation error:", error);
    return { ok: false, error: "Network error generating content", status: 502 };
  }
}

/** Pull the first JSON object out of a model response, tolerating prose or code fences. */
export function parseJsonObject<T>(content: string): T | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
