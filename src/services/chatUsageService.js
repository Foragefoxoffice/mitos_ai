const prisma = require("../utils/prismaClient");
const { estimateCostUsd, usdToInr } = require("../config/chatPricing");

// Aggregates over every assistant message (each one = one billable LLM
// call) in a single pass, in JS rather than SQL — a session's messages can
// each be produced by a different provider/model (fallback can kick in
// mid-conversation), so cost has to be computed per-row before summing;
// Prisma's groupBy can't express "sum(tokens * rate-depending-on-model)"
// directly. Fine at current volume (chat has daily/trial caps bounding
// growth) — if this table ever gets large, move the aggregation into SQL
// instead of loading every row.
const getUsageAnalytics = async () => {
  const rows = await prisma.ai_chat_message.findMany({
    where: { role: "assistant" },
    select: {
      generatedByProvider: true,
      generatedByModel: true,
      inputTokens: true,
      outputTokens: true,
      createdAt: true,
      session: { select: { userId: true } },
    },
  });

  const byUser = new Map();
  const byDay = new Map();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let costIsPartial = false;

  for (const row of rows) {
    const userId = row.session.userId;
    const inputTokens = row.inputTokens || 0;
    const outputTokens = row.outputTokens || 0;
    const cost = estimateCostUsd(row.generatedByProvider, row.generatedByModel, inputTokens, outputTokens);
    if (cost === null) costIsPartial = true;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCostUsd += cost || 0;

    const userEntry = byUser.get(userId) || {
      userId,
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      lastUsedAt: row.createdAt,
    };
    userEntry.messageCount += 1;
    userEntry.inputTokens += inputTokens;
    userEntry.outputTokens += outputTokens;
    userEntry.estimatedCostUsd += cost || 0;
    if (row.createdAt > userEntry.lastUsedAt) userEntry.lastUsedAt = row.createdAt;
    byUser.set(userId, userEntry);

    const dayKey = row.createdAt.toISOString().slice(0, 10);
    const dayEntry = byDay.get(dayKey) || { date: dayKey, messageCount: 0, estimatedCostUsd: 0 };
    dayEntry.messageCount += 1;
    dayEntry.estimatedCostUsd += cost || 0;
    byDay.set(dayKey, dayEntry);
  }

  // Cost is computed in USD (that's how providers actually bill) and
  // converted to INR once here, at the aggregate level, rather than
  // per-row — cheaper and avoids compounding rounding across thousands of
  // rows.
  return {
    overall: {
      totalUsers: byUser.size,
      totalMessages: rows.length,
      totalInputTokens,
      totalOutputTokens,
      estimatedCostUsd: totalCostUsd,
      estimatedCostInr: usdToInr(totalCostUsd),
      // true if any message used a provider/model with no entry in
      // chatPricing.js — the total above is a floor, not the real total,
      // when this is set.
      costIsPartial,
    },
    byUser: [...byUser.values()]
      .map((u) => ({ ...u, estimatedCostInr: usdToInr(u.estimatedCostUsd) }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byDay: [...byDay.values()]
      .map((d) => ({ ...d, estimatedCostInr: usdToInr(d.estimatedCostUsd) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
};

module.exports = { getUsageAnalytics };
