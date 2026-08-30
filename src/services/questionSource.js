const mysql = require("mysql2/promise");
const logger = require("../utils/logger");

// Read-only connection to the CORE backend's database (a completely
// separate database from mitos_ai — see docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md).
// CORE_DB_READONLY_URL must point to a MySQL user that has been granted
// SELECT only, on exactly the `question` table — nothing else, no writes.
// See ai-service/README.md for how that user gets created.
let pool;
const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({ uri: process.env.CORE_DB_READONLY_URL, connectionLimit: 3 });
  }
  return pool;
};

// Belt-and-braces on top of the DB grant itself: before ever issuing a
// query, confirm the connected user genuinely has no write privileges.
// This never attempts a write to check — SHOW GRANTS is a read — so a
// misconfigured user (e.g. accidentally given INSERT/UPDATE/DELETE) fails
// loudly here instead of silently being capable of mutating or deleting
// real production content. Checked once per process, not per call.
const DANGEROUS_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "ALL PRIVILEGES"];
let readOnlyVerified = false;

const assertReadOnly = async () => {
  if (readOnlyVerified) return;

  const [rows] = await getPool().query("SHOW GRANTS FOR CURRENT_USER()");
  const grants = rows.map((row) => Object.values(row)[0]).join(" | ");

  const hasDangerousGrant = DANGEROUS_PRIVILEGES.some((priv) => grants.toUpperCase().includes(priv));
  if (hasDangerousGrant) {
    throw new Error(
      `CORE_DB_READONLY_URL user has write privileges on the core database — refusing to use it. Grants: ${grants}`
    );
  }

  logger.info("[questionSource] confirmed read-only grants on core DB connection");
  readOnlyVerified = true;
};

const fetchQuestionBatch = async ({ afterId, limit }) => {
  await assertReadOnly();

  // question + hint + subjectId — options are deliberately excluded (see
  // dictionaryBatchRunner.js), so there's no reason to read or hold that
  // data here either. subjectId feeds subjectMap.js so dictionary entries
  // can be scoped per subject (a term like "cell" or "horn" means
  // something different in Biology than in Physics/Chemistry).
  const [rows] = await getPool().query(
    "SELECT id, question, hint, subjectId FROM question WHERE id > ? ORDER BY id ASC LIMIT ?",
    [afterId, limit]
  );

  return rows;
};

// Regional Language Translation needs the options too (a student reading a
// translated question needs translated options, not just translated
// prose) — fetchQuestionBatch above deliberately excludes them for
// keyword extraction's narrower needs, so this is a separate function
// rather than widening that one and risking an unrelated regression.
// Reuses the same pool/connection (getPool/assertReadOnly) — confirmed
// live (2026-08-30) the mitos_ai_reader user already has full table-level
// SELECT on `question` (not column-restricted), so this needed no new DB
// grant, just a wider query.
const fetchQuestionBatchForTranslation = async ({ afterId, limit }) => {
  await assertReadOnly();

  const [rows] = await getPool().query(
    "SELECT id, question, optionA, optionB, optionC, optionD, hint, subjectId FROM question WHERE id > ? ORDER BY id ASC LIMIT ?",
    [afterId, limit]
  );

  return rows;
};

module.exports = { fetchQuestionBatch, fetchQuestionBatchForTranslation };
