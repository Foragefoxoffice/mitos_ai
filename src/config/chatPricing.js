// Estimated USD cost per 1M tokens, keyed by "<provider>/<model>". These
// are ballpark rates for the two models explainAndChat actually routes to
// (see modelConfig.js) — NOT pulled live from any provider billing API, so
// treat "estimated cost" in usage analytics as an approximation to be spot
// -checked against your actual provider invoice, not an exact figure.
// Override per-model via env if real rates differ (e.g. after a provider
// price change) without needing a code deploy.
const PRICING = {
  "gemini/gemini-flash-latest": {
    inputPer1M: Number(process.env.PRICE_GEMINI_FLASH_INPUT_PER_1M) || 0.075,
    outputPer1M: Number(process.env.PRICE_GEMINI_FLASH_OUTPUT_PER_1M) || 0.3,
  },
  "openai/gpt-5-mini": {
    inputPer1M: Number(process.env.PRICE_GPT5_MINI_INPUT_PER_1M) || 0.15,
    outputPer1M: Number(process.env.PRICE_GPT5_MINI_OUTPUT_PER_1M) || 0.6,
  },
};

// Unknown provider/model combos (a new fallback added to modelConfig.js
// without a matching price entry here) return null rather than throwing or
// silently costing $0 — callers should treat null as "cost unknown", not
// "free".
const estimateCostUsd = (provider, model, inputTokens = 0, outputTokens = 0) => {
  const rates = PRICING[`${provider}/${model}`];
  if (!rates) return null;

  return (inputTokens / 1_000_000) * rates.inputPer1M + (outputTokens / 1_000_000) * rates.outputPer1M;
};

// Providers bill in USD, so pricing above stays USD — this is a display
// -only conversion for the admin usage page. Rate drifts over time; update
// via env rather than code when it does.
const USD_TO_INR_RATE = Number(process.env.USD_TO_INR_RATE) || 87;

const usdToInr = (usd) => (usd === null || usd === undefined ? null : usd * USD_TO_INR_RATE);

module.exports = { PRICING, estimateCostUsd, USD_TO_INR_RATE, usdToInr };
