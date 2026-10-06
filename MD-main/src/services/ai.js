"use strict";

const AnthropicModule = require("@anthropic-ai/sdk");
const { UserError } = require("../core/errors");
const { request, HttpError } = require("../core/http");

const Anthropic = AnthropicModule.default || AnthropicModule;

/**
 * The AI behind .ai, .summarize and the group chatbot. One interface, three providers:
 *   claude  – Anthropic, official SDK                     (ANTHROPIC_API_KEY)
 *   gemini  – Google Gemini API, REST generateContent     (GEMINI_API_KEY)
 *   openai  – any OpenAI-compatible Chat Completions API  (OPENAI_API_KEY, OPENAI_BASE_URL)
 * createAi() returns null when the selected provider has no key, which disables the AI commands.
 */

const LABELS = { claude: "Claude (Anthropic)", gemini: "Gemini (Google)", openai: "OpenAI-compatible" };
// Models that accept Anthropic's server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const MAX_INPUT_CHARS = 4000;
const MAX_IMAGES = 4;
const IMAGE_SIDE = 1568;
// Gemini and OpenAI reasoning models count their thinking in the output budget, so a small
// limit can leave no room for the answer. The persona keeps answers short anyway.
const MIN_REASONING_BUDGET = 4096;

/** Normalises any image sharp can read (JPEG, PNG, WebP stickers …) to base64 JPEG. */
async function toJpegBase64(buffer) {
  const sharp = require("sharp");
  const jpeg = await sharp(buffer, { animated: false, limitInputPixels: 64e6 })
    .rotate()
    .resize({ width: IMAGE_SIDE, height: IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return jpeg.toString("base64");
}

/** Provider error text can contain (masked) keys; strip anything key-like before logging. */
const scrub = (s) => String(s || "").replace(/(sk-[\w-]{4,}|AIza[\w-]{6,}|Bearer\s+\S+)/g, "[key]").slice(0, 300);

function httpFailure(log, provider, status, message) {
  log.warn({ provider, status, err: scrub(message) }, "AI request failed");
  if (status === 401 || status === 403 || /api key|api_key|unauthori[sz]ed|permission/i.test(message)) {
    return new UserError("The AI provider rejected the API key. The owner can set a new one with .setai.");
  }
  if (status === 404 || /model.*(not found|does not exist|not supported)/i.test(message)) {
    return new UserError("The AI model was not found. The owner can pick another one with .aimodel.");
  }
  if (status === 429) return new UserError("The AI is busy or the quota is used up. Try again later.");
  if (status >= 500) return new HttpError(`AI provider HTTP ${status}`, { status });
  return new UserError("The AI could not process that request.");
}

/** JSON over the SSRF-safe client; returns parsed JSON or throws a friendly error. */
async function callJson(log, provider, url, { method = "GET", headers = {}, body } = {}) {
  const res = await request(url, {
    method,
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 90000,
    maxBytes: 8 * 1024 * 1024,
    throwOnStatus: false,
  });
  let json = null;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    /* not JSON */
  }
  if (res.status < 200 || res.status >= 300) {
    const message = json?.error?.message || json?.error?.status || json?.message || res.body.toString("utf8").slice(0, 200);
    throw httpFailure(log, provider, res.status, message);
  }
  if (!json) throw new HttpError(`Invalid JSON from ${provider}`, { code: "BAD_JSON" });
  return json;
}

// ---- Claude -----------------------------------------------------------------------

function claudeProvider(config, log) {
  const client = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 2, timeout: 60000 });
  const model = config.ai.model;

  async function ask({ system, history, text, images }) {
    const content = images.length
      ? [...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })), { type: "text", text }]
      : text;
    const params = {
      model,
      max_tokens: config.ai.maxTokens,
      system,
      output_config: { effort: config.ai.effort },
      messages: [...history, { role: "user", content }],
    };
    let response;
    try {
      response = FALLBACK_MODELS.has(model)
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) throw new UserError("Could not reach the AI service. Try again later.");
      if (err instanceof Anthropic.APIError) throw httpFailure(log, "claude", err.status, err.message);
      throw err;
    }
    if (response.stop_reason === "refusal") throw new UserError("The AI declined to answer that.");
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  async function listModels() {
    try {
      const page = await client.models.list({ limit: 100 });
      return page.data.map((m) => m.id);
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw httpFailure(log, "claude", err.status, err.message);
      throw err;
    }
  }

  return { ask, listModels };
}

// ---- Gemini -----------------------------------------------------------------------

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

function geminiProvider(config, log) {
  const headers = { "x-goog-api-key": config.ai.apiKey }; // header, never in the URL
  const model = config.ai.model;

  async function ask({ system, history, text, images }) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: String(h.content) }] })),
        { role: "user", parts: [...images.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } })), { text }] },
      ],
      generationConfig: { maxOutputTokens: Math.max(config.ai.maxTokens, MIN_REASONING_BUDGET) },
    };
    const json = await callJson(log, "gemini", `${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers, body });
    if (json.promptFeedback?.blockReason) throw new UserError("The AI declined to answer that.");
    const candidate = json.candidates?.[0];
    if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(candidate?.finishReason)) {
      throw new UserError("The AI declined to answer that.");
    }
    const answer = (candidate?.content?.parts || [])
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("");
    if (!answer.trim() && candidate?.finishReason === "MAX_TOKENS") {
      throw new UserError("The answer did not fit. The owner can raise AI_MAX_TOKENS with .setvar.");
    }
    return answer;
  }

  async function listModels() {
    const json = await callJson(log, "gemini", `${GEMINI}/models?pageSize=1000`, { headers });
    return (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, ""));
  }

  return { ask, listModels };
}

// ---- OpenAI-compatible -------------------------------------------------------------

function openaiProvider(config, log) {
  const base = config.ai.openaiBaseUrl;
  const headers = { authorization: `Bearer ${config.ai.apiKey}` };
  const model = config.ai.model;
  const isOpenAi = new URL(base).hostname === "api.openai.com";

  async function ask({ system, history, text, images }) {
    const content = images.length
      ? [{ type: "text", text }, ...images.map((data) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data}` } }))]
      : text;
    const body = {
      model,
      messages: [{ role: "system", content: system }, ...history, { role: "user", content }],
    };
    // OpenAI itself uses max_completion_tokens; most compatible services still use max_tokens.
    if (isOpenAi) body.max_completion_tokens = Math.max(config.ai.maxTokens, MIN_REASONING_BUDGET);
    else body.max_tokens = config.ai.maxTokens;
    const json = await callJson(log, "openai", `${base}/chat/completions`, { method: "POST", headers, body });
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new UserError("The AI declined to answer that.");
    const answer = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (!answer.trim() && choice?.finish_reason === "length") {
      throw new UserError("The answer did not fit. The owner can raise AI_MAX_TOKENS with .setvar.");
    }
    return answer;
  }

  async function listModels() {
    const json = await callJson(log, "openai", `${base}/models`, { headers });
    const ids = (json.data || []).map((m) => String(m.id));
    // api.openai.com also lists embedding, audio and image models; keep the chat ones.
    return isOpenAi ? ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !/(audio|realtime|image|tts|transcribe|search)/i.test(id)) : ids;
  }

  return { ask, listModels };
}

const PROVIDERS = { claude: claudeProvider, gemini: geminiProvider, openai: openaiProvider };

function createAi(config, log) {
  const { provider, apiKey, model } = config.ai;
  if (!apiKey || !PROVIDERS[provider]) return null;
  const impl = PROVIDERS[provider](config, log);

  /**
   * @param {string} prompt
   * @param {{ system?: string, history?: Array<{role:'user'|'assistant', content:string}>, images?: Buffer[] }} [opts]
   *   images: photos to show the AI (re-encoded to JPEG, max 1568 px, at most 4)
   *   maxChars: input limit (default 4000; .summarize passes more, capped at 100 000)
   * @returns {Promise<string>}
   */
  async function ask(prompt, { system = config.ai.persona, history = [], images = [], maxChars = MAX_INPUT_CHARS } = {}) {
    const text = String(prompt || "").slice(0, Math.min(maxChars, 100000));
    const jpegs = await Promise.all(images.slice(0, MAX_IMAGES).map(toJpegBase64));
    const answer = String((await impl.ask({ system, history, text, images: jpegs })) || "").trim();
    if (!answer) throw new UserError("The AI returned an empty answer. Try rephrasing.");
    return answer;
  }

  /** Model ids this key can use (sorted). Also used to check a key before saving it. */
  async function listModels() {
    return [...new Set(await impl.listModels())].sort();
  }

  return { provider, model, label: LABELS[provider], ask, listModels };
}

module.exports = { createAi, LABELS, scrub };
