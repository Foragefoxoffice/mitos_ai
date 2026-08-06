const prisma = require("../utils/prismaClient");
const { runTask } = require("../router/aiRouter");
const { buildChatPrompt } = require("../prompts/chatPrompt");

// Temporary safety net, not a real credit system — a proper Wallet/credits
// module (premium-bundled packages, gated top-ups, configurable daily
// rates) is planned as a separate, later module. This is just a flat cap
// so nothing runs away unbounded in the meantime.
const DAILY_MESSAGE_CAP = Number(process.env.CHAT_DAILY_MESSAGE_CAP) || 30;

class ChatCapExceededError extends Error {}

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

const getOrCreateSession = (userId, questionId) =>
  prisma.ai_chat_session.upsert({
    where: { userId_questionId: { userId, questionId } },
    update: {},
    create: { userId, questionId },
  });

const sendMessage = async ({ userId, questionId, message, questionContext }) => {
  const todayCount = await countTodayMessages(userId);
  if (todayCount >= DAILY_MESSAGE_CAP) {
    throw new ChatCapExceededError(`Daily chat limit (${DAILY_MESSAGE_CAP}) reached`);
  }

  const session = await getOrCreateSession(userId, questionId);

  const priorMessages = await prisma.ai_chat_message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.ai_chat_message.create({
    data: { sessionId: session.id, role: "user", content: message },
  });

  const { system, prompt } = buildChatPrompt({
    questionContext,
    historyMessages: priorMessages,
    newMessage: message,
  });

  // 800 was truncating mid-sentence on requests that reasonably need more
  // room (e.g. "explain each option" covering 4 options) — verified live
  // against a real conversation, same class of bug as Dictionary
  // generation's earlier 700-token truncation.
  const result = await runTask("explainAndChat", { system, prompt, maxTokens: 1500 });

  const assistantMessage = await prisma.ai_chat_message.create({
    data: {
      sessionId: session.id,
      role: "assistant",
      content: result.text,
      generatedByProvider: result.provider,
      generatedByModel: result.model,
    },
  });

  return { reply: assistantMessage.content, sessionId: session.id };
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

module.exports = { sendMessage, getHistory, ChatCapExceededError, DAILY_MESSAGE_CAP };
