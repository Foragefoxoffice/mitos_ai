const { createDictionaryBatchJob } = require("./createDictionaryBatchJob");
const { fetchTestSeriesQuestionBatch } = require("../services/testSeriesQuestionSource");

// Sibling to dictionaryBatchRunner.js — same generation pipeline, reading
// from `testseriesquestionbank` instead of the main `question` table.
// Shares the ai_dictionary term pool (a term means the same thing
// regardless of which question bank it came from); tags its
// ai_dictionary_mapping rows with source "test_series" so questionId can be
// told apart from a practice question with the same numeric id.
module.exports = createDictionaryBatchJob({
  jobType: "test_series_dictionary_generation",
  fetchQuestionBatch: fetchTestSeriesQuestionBatch,
  mappingSource: "test_series",
});
