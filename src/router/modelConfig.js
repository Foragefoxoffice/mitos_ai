// Model IDs are read from env so they can be updated without a code change.
// "gemini-flash-latest" is verified working (2026-08-05, live call against
// gemini-2.5-flash directly 404'd for new API keys — the "-latest" alias
// avoids hardcoding a version Google can deprecate under us). GPT-5/GPT-5-mini
// and Claude Sonnet entries are unverified — no OpenAI/Anthropic key added
// yet — confirm against provider docs once those keys are in .env.
module.exports = {
  wordExplain: {
    primary: { provider: "gemini", model: process.env.MODEL_WORD_PRIMARY || "gemini-flash-latest" },
    fallback: { provider: "openai", model: process.env.MODEL_WORD_FALLBACK || "gpt-5-mini" },
  },
  explainAndChat: {
    primary: { provider: "openai", model: process.env.MODEL_CHAT_PRIMARY || "gpt-5-mini" },
    fallback: { provider: "gemini", model: process.env.MODEL_CHAT_FALLBACK || "gemini-flash-latest" },
  },
  performanceAnalysis: {
    primary: { provider: "claude", model: process.env.MODEL_ANALYSIS_PRIMARY || "claude-sonnet-5" },
    fallback: { provider: "openai", model: process.env.MODEL_ANALYSIS_FALLBACK || "gpt-5-mini" },
  },
  studyPlan: {
    primary: { provider: "openai", model: process.env.MODEL_STUDYPLAN_PRIMARY || "gpt-5" },
    fallback: { provider: "claude", model: process.env.MODEL_STUDYPLAN_FALLBACK || "claude-sonnet-5" },
  },
};
