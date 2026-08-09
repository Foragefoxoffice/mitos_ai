const { sendMessage, getHistory, ChatCapExceededError } = require("../services/chatService");
const { getUsageAnalytics } = require("../services/chatUsageService");

const postMessage = async (req, res) => {
  const { userId, questionId, message, questionContext, isTrial } = req.body || {};

  if (!userId || !questionId || !message) {
    return res.status(400).json({ message: "userId, questionId, and message are required" });
  }

  try {
    const result = await sendMessage({
      userId: Number(userId),
      questionId: Number(questionId),
      message,
      questionContext: questionContext || {},
      isTrial: !!isTrial,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof ChatCapExceededError) {
      return res.status(429).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
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

module.exports = { postMessage, getHistoryHandler, getUsage };
