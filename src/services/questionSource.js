// TEMPORARY: real integration with backend's core question table isn't
// wired up yet — that needs either an internal backend read endpoint or a
// read-only DB user against the core schema (see the "Data access note"
// under Sprint 2 in docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md,
// a decision that still needs to be made). This fixture exists only to
// prove the batch/cursor/resumability mechanism in dictionaryBatchRunner.js
// before wiring it to real content. Swap the implementation, keep the
// fetchQuestionBatch({ afterId, limit }) signature.
const FIXTURE_QUESTIONS = [
  { id: 1, question: "Which organelle is known as the powerhouse of the mitochondria containing cristae?", optionA: "Ribosome", optionB: "Mitochondria", optionC: "Nucleus", optionD: "Lysosome" },
  { id: 2, question: "The process of photosynthesis occurs mainly in the chloroplast of plant cells.", optionA: "Chloroplast", optionB: "Mitochondria", optionC: "Vacuole", optionD: "Golgi" },
  { id: 3, question: "Which structure regulates entry and exit of substances across the cell membrane?", optionA: "Cell membrane", optionB: "Cell wall", optionC: "Cytoplasm", optionD: "Nucleolus" },
];

const fetchQuestionBatch = async ({ afterId, limit }) => {
  return FIXTURE_QUESTIONS.filter((q) => q.id > afterId).slice(0, limit);
};

module.exports = { fetchQuestionBatch };
