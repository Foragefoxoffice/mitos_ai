const { createTranslationBatchJob } = require("./createTranslationBatchJob");
const { fetchQuestionBatchForTranslation } = require("../services/questionSource");

// Hindi only for now (ai_language id=1) — see the design doc's §9 rollout
// plan step 8: adding a second language means a second instance here
// (e.g. languageId: <tamil's id>, jobType: "questionTranslation:ta"),
// not a code change to createTranslationBatchJob.js itself. Same
// practice-vs-test_series split as dictionaryBatchRunner.js/
// testSeriesDictionaryBatchRunner.js, for the identical reason (see
// ai_question_translation.source's schema comment).
module.exports = createTranslationBatchJob({
  jobType: "questionTranslation:hi",
  fetchQuestionBatch: fetchQuestionBatchForTranslation,
  source: "practice",
  languageId: 1,
});
