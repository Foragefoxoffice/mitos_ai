// Maps the core database's `question.subjectId` to a plain subject name.
// There is no read access to a `subject` lookup table (the read-only DB
// user is deliberately scoped to SELECT on `question` only — see
// questionSource.js), so this mapping was derived by sampling real
// question content per subjectId (2026-08-22): each subject appears to
// have two subjectIds in this bank (likely a class-11/class-12 split),
// confirmed by reading a few real questions per id —
//   26, 30 -> Physics (vernier calipers, electrostatics)
//   27, 31 -> Chemistry (Rasratnakar/drug formulation, colligative properties)
//   34, 35 -> Biology (Aristotle/Linnaeus classification, floral structure)
// A subjectId not in this map (a new subject added to the bank later, or
// one this sample never hit) falls back to "general" rather than crashing
// — dictionary entries for those terms just won't get subject-specific
// disambiguation until this map is extended.
const SUBJECT_BY_ID = {
  26: "physics",
  30: "physics",
  27: "chemistry",
  31: "chemistry",
  34: "biology",
  35: "biology",
};

const subjectForId = (subjectId) => SUBJECT_BY_ID[subjectId] || "general";

module.exports = { subjectForId, SUBJECT_BY_ID };
