"use strict";

const AnthropicModule = require("@anthropic-ai/sdk");
const { UserError } = require("../core/errors");

const Anthropic = AnthropicModule.default || AnthropicModule;

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const MAX_INPUT_CHARS = 4000;

/**
 * Claude via the official Anthropic SDK. Returns null when ANTHROPIC_API_KEY is not set,
 * which disables the AI commands and the chatbot.
 */
function createAi(config, log) {
  if (!config.ai.apiKey) return null;
  const client = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 2, timeout: 60000 });

  /**
   * @param {string} prompt
   * @param {{ system?: string, history?: Array<{role:'user'|'assistant', content:string}> }} [opts]
   * @returns {Promise<string>}
   */
  async function ask(prompt, { system = config.ai.persona, history = [] } = {}) {
    const text = String(prompt || "").slice(0, MAX_INPUT_CHARS);
    const params = {
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      system,
      output_config: { effort: config.ai.effort },
      messages: [...history, { role: "user", content: text }],
    };
    let response;
    try {
      if (FALLBACK_MODELS.has(config.ai.model)) {
        response = await client.beta.messages.create({
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
      } else {
        response = await client.messages.create(params);
      }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        log.error("Claude rejected ANTHROPIC_API_KEY; check the key in .env");
        throw new UserError("The AI service is not configured correctly. Tell the bot owner.");
      }
      if (err instanceof Anthropic.RateLimitError) throw new UserError("The AI is busy right now. Try again in a minute.");
      if (err instanceof Anthropic.BadRequestError) {
        log.error({ err: err.message }, "Claude rejected the request");
        throw new UserError("The AI could not process that request.");
      }
      if (err instanceof Anthropic.APIConnectionError) throw new UserError("Could not reach the AI service. Try again later.");
      throw err;
    }
    if (response.stop_reason === "refusal") throw new UserError("The AI declined to answer that.");
    const answer = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!answer) throw new UserError("The AI returned an empty answer. Try rephrasing.");
    return answer;
  }

  return { ask };
}

module.exports = { createAi };
