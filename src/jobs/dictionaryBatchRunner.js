const { createDictionaryBatchJob } = require("./createDictionaryBatchJob");
const { fetchQuestionBatch } = require("../services/questionSource");

// The original (practice-question) dictionary generation job — reads from
// the main `question` table. See createDictionaryBatchJob.js for the shared
// implementation; see testSeriesDictionaryBatchRunner.js for the sibling
// instance that reads from `testseriesquestionbank` instead.
module.exports = createDictionaryBatchJob({
  jobType: "dictionary_generation",
  fetchQuestionBatch,
  mappingSource: "practice",
});
