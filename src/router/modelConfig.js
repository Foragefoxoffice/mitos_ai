// Model IDs are read from env so they can be updated without a code change.
// Each task is an ORDERED LIST of attempts — aiRouter.js walks it and only
// fails once every entry has failed, so a task genuinely erroring out to a
// user requires every single model in its chain to be down at once.
//
// Live-verified 2026-08-19, real API calls against real keys:
//   - gemini-3.6-flash: works (fast, cheap — used for straightforward asks).
//   - gemini-pro-latest (resolves to gemini-3.1-pro-preview): works, gives
//     noticeably more thorough/careful answers — used for complex asks.
//   - gemini-flash-latest: 503 "experiencing high demand" right now — the
//     "-latest" alias isn't a stable escape from Google's model churn, so
//     pinned versions are used instead everywhere below.
//   - gemini-2.0-flash / gemini-1.5-flash: fully retired, 404. Google's own
//     404 for 2.0-flash names gemini-3.6-flash as the replacement.
//   - OpenAI (gpt-5-mini/gpt-5): key is present but the account is over
//     quota (429) — kept as a later fallback attempt for when billing is
//     fixed, but it will NOT rescue a request today.
//   - Claude: no ANTHROPIC_API_KEY set at all — same story, kept as a
//     fallback for when a key is added, not currently functional.
// Net effect: Gemini is the only provider actually carrying traffic right
// now, so every task below tries a second, different Gemini model before
// falling through to the other providers — real resilience against one
// specific Gemini model being overloaded, not just paper resilience against
// providers that can't currently serve a request anyway.
//
// AI_LOCAL_ONLY=true routes every task to a local Ollama model only, with
// no third-party provider anywhere in the chain — for local dev machines
// that don't have (and shouldn't need) real
// OPENAI_API_KEY/GEMINI_API_KEY/ANTHROPIC_API_KEY set. Deliberately not
// inferred from NODE_ENV — this needs to be an explicit opt-in per
// machine, not something that flips silently. Leave unset in production;
// ecosystem.config.js's env block doesn't set it, so a deployed instance
// always uses the real provider config below regardless of this file.
const LOCAL_ONLY = process.env.AI_LOCAL_ONLY === "true";

// Same idea as AI_LOCAL_ONLY, for isolating a real cost/speed measurement of
// OpenAI alone (2026-08-21) — no Gemini fallback muddying the numbers.
// Temporary/manual toggle for benchmarking a real batch, not meant to be
// left on for production routing.
const OPENAI_ONLY = process.env.AI_OPENAI_ONLY === "true";

// Same idea, for isolating a real cost/speed/quality measurement of
// DeepSeek alone (2026-08-22).
const DEEPSEEK_ONLY = process.env.AI_DEEPSEEK_ONLY === "true";

if (LOCAL_ONLY) {
  const localRoute = [{ provider: "ollama", model: process.env.OLLAMA_MODEL || "qwen2.5:14b" }];

  module.exports = {
    keywordExtraction: localRoute,
    wordExplain: localRoute,
    explainAndChat: { simple: localRoute, complex: localRoute },
    performanceAnalysis: localRoute,
    studyPlan: localRoute,
  };
} else if (OPENAI_ONLY) {
  const openaiRoute = [{ provider: "openai", model: process.env.MODEL_OPENAI_FALLBACK || "gpt-5-mini" }];

  module.exports = {
    keywordExtraction: openaiRoute,
    wordExplain: openaiRoute,
    explainAndChat: { simple: openaiRoute, complex: openaiRoute },
    performanceAnalysis: openaiRoute,
    studyPlan: openaiRoute,
  };
} else if (DEEPSEEK_ONLY) {
  const deepseekRoute = [{ provider: "deepseek", model: process.env.MODEL_DEEPSEEK || "deepseek-v4-flash" }];

  module.exports = {
    keywordExtraction: deepseekRoute,
    wordExplain: deepseekRoute,
    explainAndChat: { simple: deepseekRoute, complex: deepseekRoute },
    performanceAnalysis: deepseekRoute,
    studyPlan: deepseekRoute,
  };
} else {
  const geminiFlash = { provider: "gemini", model: process.env.MODEL_GEMINI_FLASH || "gemini-3.6-flash" };
  const geminiPro = { provider: "gemini", model: process.env.MODEL_GEMINI_PRO || "gemini-pro-latest" };
  const openaiMini = { provider: "openai", model: process.env.MODEL_OPENAI_FALLBACK || "gpt-5-mini" };
  const claudeFallback = { provider: "claude", model: process.env.MODEL_CLAUDE_FALLBACK || "claude-sonnet-5" };
  const deepseekFlash = { provider: "deepseek", model: process.env.MODEL_DEEPSEEK || "deepseek-v4-flash" };

  module.exports = {
    // DeepSeek leads for these two tasks specifically (2026-08-22) —
    // validated at real scale (150+ real questions across all three
    // subjects, plus a dedicated 150-question quality audit spanning
    // physics/chemistry/biology) as cheaper and comparably clean to
    // gpt-5-mini after prompt/filter hardening. Falls through to the
    // previously-proven Gemini/mini chain if DeepSeek has an outage or
    // hits a limit — a multi-hour bulk run needs that safety net; the
    // AI_DEEPSEEK_ONLY=true toggle (no fallback at all) is for isolated
    // benchmarking only, never for the real run. Other tasks below
    // (chat, performance analysis, study plan) haven't been validated on
    // DeepSeek at all, so they keep the existing Gemini-led chain.
    keywordExtraction: [deepseekFlash, geminiFlash, geminiPro, openaiMini],
    wordExplain: [deepseekFlash, geminiFlash, geminiPro, openaiMini],
    // Chat picks its tier by question complexity — see chatService.js's
    // classifyComplexity. "simple" leads with the fast/cheap model and
    // only reaches for the heavier one if that fails; "complex" is the
    // reverse, since a shallow answer on a question that asked for real
    // depth (e.g. "explain each option and why the others are wrong") is
    // itself a quality failure even when it technically "succeeds".
    explainAndChat: {
      simple: [geminiFlash, geminiPro, openaiMini],
      complex: [geminiPro, geminiFlash, openaiMini],
    },
    performanceAnalysis: [geminiPro, geminiFlash, claudeFallback, openaiMini],
    studyPlan: [geminiPro, geminiFlash, openaiMini, claudeFallback],
  };
}
