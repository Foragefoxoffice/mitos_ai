const { createTranslationBatchJob } = require("./createTranslationBatchJob");
const { fetchTestSeriesQuestionBatchForTranslation } = require("../services/testSeriesQuestionSource");

// Sibling to translationBatchRunner.js — reads from testseriesquestionbank
// instead of question. See that file for the languageId/rollout comment.
module.exports = createTranslationBatchJob({
  jobType: "questionTranslation:hi:test_series",
  fetchQuestionBatch: fetchTestSeriesQuestionBatchForTranslation,
  source: "test_series",
  languageId: 1,
});
