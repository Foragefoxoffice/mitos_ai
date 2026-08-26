const prisma = require("../utils/prismaClient");
const { runTask } = require("../router/aiRouter");
const { buildChatPrompt } = require("../prompts/chatPrompt");

// Flat cap, not a real credit system — a proper Wallet/credits module
// (premium-bundled packages, gated top-ups, configurable daily rates) is
// planned as a separate, later module. This is just a cap so nothing runs
// away unbounded in the meantime.
//
// Two different cap shapes on purpose: a paying Premium user gets a cap
// that resets every day (dailyCap), but a trial user gets one fixed
// allowance for their WHOLE trial (trialCap, never resets) — otherwise a
// multi-day trial would hand out the daily cap every single day for free,
// which isn't the intended trial value. backend determines trial vs
// premium (it owns user.status/trialEndsAt/premiumExpiry; this service
// doesn't have that data) and passes isTrial through, along with the two
// cap values themselves — backend owns them as admin-editable AppSettings
// (`aiChatDailyCapPremium` / `aiChatTrialCapTotal`) so an admin change
// takes effect on the very next message, no restart here. These env vars
// are only the fallback if backend ever fails to send a value.
const DEFAULT_DAILY_MESSAGE_CAP = Number(process.env.CHAT_DAILY_MESSAGE_CAP) || 100;
const DEFAULT_TRIAL_MESSAGE_CAP = Number(process.env.CHAT_TRIAL_MESSAGE_CAP) || 10;

class ChatCapExceededError extends Error {}

// Deterministic (no extra AI call, so no added latency/cost/failure surface)
// — mirrors the app's own prompt-chip vocabulary (AiChatScreen.jsx's
// PROMPTS_AFTER_ANSWER has "Explain each option", "Why are the other
// options wrong?", "Explain this question step by step"), which are
// exactly the asks that read shallow from a fast model and warrant the
// stronger one. A long free-typed question is treated the same way even
// without matching a fixed phrase.
const COMPLEX_MESSAGE_PATTERNS = [
  /step.?by.?step/i,
  /explain (each|all|every) option/i,
  /why (are|is|were).{0,20}(wrong|correct|right|incorrect)/i,
  /in detail/i,
  /\bcompare\b/i,
  /difference between/i,
  /\bderive\b/i,
  /\bprove\b/i,
  /pros and cons/i,
];
const COMPLEX_WORD_COUNT_THRESHOLD = 25;

const classifyComplexity = (message) => {
  if (!message) return "simple";
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > COMPLEX_WORD_COUNT_THRESHOLD) return "complex";
  return COMPLEX_MESSAGE_PATTERNS.some((re) => re.test(message)) ? "complex" : "simple";
};

const countTodayMessages = async (userId) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return prisma.ai_chat_message.count({
    where: {
      role: "user",
      createdAt: { gte: startOfToday },
      session: { userId },
    },
  });
};

// No date filter — every message this user has ever sent, for the trial's
// one-time lifetime cap.
const countAllMessages = async (userId) =>
  prisma.ai_chat_message.count({
    where: { role: "user", session: { userId } },
  });

const getOrCreateSession = (userId, questionId) =>
  prisma.ai_chat_session.upsert({
    where: { userId_questionId: { userId, questionId } },
    update: {},
    create: { userId, questionId },
  });

// General (non-question) chats — reached from the Home screen, with no
// specific question in view — share one persistent session per user, keyed
// by this sentinel. Safe against collision with real question sessions
// since `question.id` is an autoincrement PK starting at 1.
const GENERAL_CHAT_QUESTION_ID = 0;

// `ai_chat_session.questionId` is a single int column, but backend has TWO
// separate question tables with their own independent autoincrement PKs —
// the main `question` bank ("mock") and `testseriesquestionbank` ("test-series")
// — so the same numeric id can point at two completely unrelated questions.
// Without namespacing, a Test Series question and a mock question that
// happen to share an id would silently share one session AND its history,
// which is exactly how a student reviewing a Biology Test Series question
// once got an answer about an unrelated Physics mock question (confirmed
// live 2026-08-19). Real ids are always positive, so negating test-series
// ids keeps them in a disjoint range from mock ids and from the `0`
// GENERAL_CHAT_QUESTION_ID sentinel, with no schema migration needed.
const resolveEffectiveQuestionId = (questionId, source) => {
  if (!questionId) return GENERAL_CHAT_QUESTION_ID;
  return source === "test-series" ? -Number(questionId) : Number(questionId);
};

const sendMessage = async ({ userId, questionId, message, questionContext, userContext, isTrial, source, dailyCap, trialCap }) => {
  const effectiveDailyCap = dailyCap ?? DEFAULT_DAILY_MESSAGE_CAP;
  const effectiveTrialCap = trialCap ?? DEFAULT_TRIAL_MESSAGE_CAP;
  const effectiveQuestionId = resolveEffectiveQuestionId(questionId, source);

  if (isTrial) {
    const totalCount = await countAllMessages(userId);
    if (totalCount >= effectiveTrialCap) {
      throw new ChatCapExceededError(
        `Trial chat limit (${effectiveTrialCap} messages total) reached — upgrade to Premium for daily access.`
      );
    }
  } else {
    const todayCount = await countTodayMessages(userId);
    if (todayCount >= effectiveDailyCap) {
      throw new ChatCapExceededError(`Daily chat limit (${effectiveDailyCap}) reached`);
    }
  }

  const session = await getOrCreateSession(userId, effectiveQuestionId);

  const priorMessages = await prisma.ai_chat_message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.ai_chat_message.create({
    data: { sessionId: session.id, role: "user", content: message },
  });

  const { system, prompt } = buildChatPrompt({
    questionContext,
    userContext,
    historyMessages: priorMessages,
    newMessage: message,
  });

  // 800 was truncating mid-sentence on requests that reasonably need more
  // room (e.g. "explain each option" covering 4 options) — verified live
  // against a real conversation, same class of bug as Dictionary
  // generation's earlier 700-token truncation.
  const complexity = classifyComplexity(message);
  const result = await runTask("explainAndChat", { system, prompt, maxTokens: 1500, complexity });

  const assistantMessage = await prisma.ai_chat_message.create({
    data: {
      sessionId: session.id,
      role: "assistant",
      content: result.text,
      generatedByProvider: result.provider,
      generatedByModel: result.model,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
    },
  });

  return { reply: assistantMessage.content, sessionId: session.id };
};

// Read-only lookup for the app to show "X left today" / "X of N used"
// without needing to send a message — reuses the exact same counting
// functions sendMessage's cap check uses, so this can never drift out of
// sync with what actually gets enforced.
const getQuota = async ({ userId, isTrial, dailyCap, trialCap }) => {
  const limit = isTrial ? (trialCap ?? DEFAULT_TRIAL_MESSAGE_CAP) : (dailyCap ?? DEFAULT_DAILY_MESSAGE_CAP);
  const used = isTrial ? await countAllMessages(userId) : await countTodayMessages(userId);

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resets: isTrial ? "never" : "daily",
  };
};

const getHistory = async (userId, questionId, source) => {
  const effectiveQuestionId = resolveEffectiveQuestionId(questionId, source);
  const session = await prisma.ai_chat_session.findUnique({
    where: { userId_questionId: { userId, questionId: effectiveQuestionId } },
  });
  if (!session) return { messages: [] };

  const messages = await prisma.ai_chat_message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  return { messages };
};

module.exports = { sendMessage, getHistory, getQuota, ChatCapExceededError };
