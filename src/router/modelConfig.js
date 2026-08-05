// Model IDs are read from env so they can be updated without a code change.
// Verify these against each provider's current model list before relying on
// them in production — naming/availability changes over time. Defaults below
// are best-guess placeholders for the task mapping described in
// docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md.
module.exports = {
  wordExplain: {
    primary: { provider: "gemini", model: process.env.MODEL_WORD_PRIMARY || "gemini-2.5-flash" },
    fallback: { provider: "openai", model: process.env.MODEL_WORD_FALLBACK || "gpt-5-mini" },
  },
  explainAndChat: {
    primary: { provider: "openai", model: process.env.MODEL_CHAT_PRIMARY || "gpt-5-mini" },
    fallback: { provider: "gemini", model: process.env.MODEL_CHAT_FALLBACK || "gemini-2.5-flash" },
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
