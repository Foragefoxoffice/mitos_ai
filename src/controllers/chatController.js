const { sendMessage, getHistory, getQuota, ChatCapExceededError } = require("../services/chatService");
const { getUsageAnalytics } = require("../services/chatUsageService");

// questionId is optional — omitted (or 0) means the "general" Home-screen
// chat mode with no specific question in view; see chatService's
// GENERAL_CHAT_QUESTION_ID sentinel.
const postMessage = async (req, res) => {
  const { userId, questionId, message, questionContext, userContext, isTrial } = req.body || {};

  if (!userId || !message) {
    return res.status(400).json({ message: "userId and message are required" });
  }

  try {
    const result = await sendMessage({
      userId: Number(userId),
      questionId: questionId ? Number(questionId) : 0,
      message,
      questionContext: questionContext || {},
      userContext: userContext || {},
      isTrial: !!isTrial,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof ChatCapExceededError) {
      return res.status(429).json({ message: error.message });
    }
    // error.message here can be a raw provider error (e.g. OpenAI's "You
    // didn't provide an API key" 401, or a network/timeout message) —
    // never send that straight to a student. Log the real cause server-side
    // and return a generic message instead.
    console.error("[chatController] postMessage failed:", error);
    res.status(500).json({ message: "Mitos AI is temporarily unavailable. Please try again in a moment." });
  }
};

const getHistoryHandler = async (req, res) => {
  const questionId = Number(req.params.questionId);
  const userId = Number(req.query.userId);

  if (!Number.isInteger(questionId) || !Number.isInteger(userId)) {
    return res.status(400).json({ message: "Invalid questionId or userId" });
  }

  const result = await getHistory(userId, questionId);
  res.json(result);
};

const getUsage = async (req, res) => {
  try {
    const result = await getUsageAnalytics();
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getQuotaHandler = async (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: "Invalid userId" });
  }

  try {
    const result = await getQuota({ userId, isTrial: req.query.isTrial === "true" });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { postMessage, getHistoryHandler, getUsage, getQuotaHandler };
