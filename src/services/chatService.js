const prisma = require("../utils/prismaClient");
const { runTask } = require("../router/aiRouter");
const { buildChatPrompt } = require("../prompts/chatPrompt");

// Temporary safety net, not a real credit system — a proper Wallet/credits
// module (premium-bundled packages, gated top-ups, configurable daily
// rates) is planned as a separate, later module. This is just a flat cap
// so nothing runs away unbounded in the meantime.
//
// Two different cap shapes on purpose: a paying Premium user gets a cap
// that resets every day (DAILY_MESSAGE_CAP), but a trial user gets one
// fixed allowance for their WHOLE trial (TRIAL_MESSAGE_CAP, never resets)
// — otherwise a multi-day trial would hand out the daily cap every single
// day for free, which isn't the intended trial value. backend determines
// trial vs premium (it owns user.status/trialEndsAt/premiumExpiry; this
// service doesn't have that data) and passes isTrial through.
const DAILY_MESSAGE_CAP = Number(process.env.CHAT_DAILY_MESSAGE_CAP) || 20;
const TRIAL_MESSAGE_CAP = Number(process.env.CHAT_TRIAL_MESSAGE_CAP) || 10;

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

const sendMessage = async ({ userId, questionId, message, questionContext, userContext, isTrial }) => {
  const effectiveQuestionId = questionId || GENERAL_CHAT_QUESTION_ID;

  if (isTrial) {
    const totalCount = await countAllMessages(userId);
    if (totalCount >= TRIAL_MESSAGE_CAP) {
      throw new ChatCapExceededError(
        `Trial chat limit (${TRIAL_MESSAGE_CAP} messages total) reached — upgrade to Premium for daily access.`
      );
    }
  } else {
    const todayCount = await countTodayMessages(userId);
    if (todayCount >= DAILY_MESSAGE_CAP) {
      throw new ChatCapExceededError(`Daily chat limit (${DAILY_MESSAGE_CAP}) reached`);
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
const getQuota = async ({ userId, isTrial }) => {
  const limit = isTrial ? TRIAL_MESSAGE_CAP : DAILY_MESSAGE_CAP;
  const used = isTrial ? await countAllMessages(userId) : await countTodayMessages(userId);

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resets: isTrial ? "never" : "daily",
  };
};

const getHistory = async (userId, questionId) => {
  const session = await prisma.ai_chat_session.findUnique({
    where: { userId_questionId: { userId, questionId } },
  });
  if (!session) return { messages: [] };

  const messages = await prisma.ai_chat_message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  return { messages };
};

module.exports = { sendMessage, getHistory, getQuota, ChatCapExceededError, DAILY_MESSAGE_CAP, TRIAL_MESSAGE_CAP };
