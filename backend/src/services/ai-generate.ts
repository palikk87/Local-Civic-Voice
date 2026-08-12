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
}

export type AIGenerateResult =
  | { ok: true; content: string; provider: AIProvider; model: string }
  | { ok: false; error: string; status: 502 | 503 };

export function aiAvailability(): { gemini: boolean; openai: boolean } {
  return {
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
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
};

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
  { system, prompt, maxCompletionTokens, temperature, jsonMode }: AIGenerateParams
): Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: temperature ?? 0.7,
          maxOutputTokens: maxCompletionTokens ?? 800,
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
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { ok: true, content };
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  { system, prompt, maxCompletionTokens, temperature, jsonMode }: AIGenerateParams,
  omitTemperature = false
): Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
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
      max_completion_tokens: maxCompletionTokens ?? 800,
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
      return generateWithOpenAI(apiKey, model, { system, prompt, maxCompletionTokens, jsonMode }, true);
    }
    return { ok: false, error: errorText, status: response.status };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
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
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    const result =
      provider === "gemini"
        ? await generateWithGemini(key, model, params)
        : await generateWithOpenAI(key, model, params);
    if (result.ok) return result;
    if (result.status !== 429 || attempt === RATE_LIMIT_RETRIES) {
      return { ok: false, error: result.error };
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
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };

  if (!keys.gemini && !keys.openai) {
    return { ok: false, error: "No AI API key configured on server", status: 503 };
  }

  const target = params.provider ?? (params.model ? providerFor(params.model) : undefined);
  const order: AIProvider[] = target
    ? [target, target === "gemini" ? "openai" : "gemini"]
    : ["gemini", "openai"];

  try {
    for (const provider of order) {
      const key = keys[provider];
      if (!key) continue;

      // Honour an explicit model only on its own provider; the safety-net
      // provider uses its default.
      const model =
        params.model && providerFor(params.model) === provider
          ? params.model
          : provider === "gemini"
            ? DEFAULT_GEMINI_MODEL
            : DEFAULT_OPENAI_MODEL;

      const result = await runProvider(provider, key, model, params);
      if (result.ok) return { ok: true, content: result.content, provider, model };
      if (provider === order[0]) {
        console.warn(`[AI] ${model} failed — falling back off ${provider}: ${result.error.slice(0, 200)}`);
      }
    }

    return { ok: false, error: "Failed to generate content", status: 502 };
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
