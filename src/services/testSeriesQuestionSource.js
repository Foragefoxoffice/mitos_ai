const mysql = require("mysql2/promise");
const logger = require("../utils/logger");

// Read-only connection to the CORE backend's database, same physical MySQL
// server as questionSource.js's `question` table reads but a different
// table: `testseriesquestionbank` (see backend/prisma/schema.prisma).
// CORE_DB_READONLY_URL's user (mitos_ai_reader) must additionally be
// granted SELECT on this table — it was originally scoped to `question`
// only, so this requires a one-time manual GRANT (same story as when that
// user was first created; app-level DB users can't grant their own
// permissions). See ai-service/README.md.
let pool;
const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({ uri: process.env.CORE_DB_READONLY_URL, connectionLimit: 3 });
  }
  return pool;
};

const DANGEROUS_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "ALL PRIVILEGES"];
let readOnlyVerified = false;

// Same belt-and-braces check as questionSource.js — verified independently
// here rather than sharing state with that module, since this file has no
// other reason to depend on it and the check is cheap/idempotent either way.
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

  logger.info("[testSeriesQuestionSource] confirmed read-only grants on core DB connection");
  readOnlyVerified = true;
};

// question + hint + subjectId only — same fields, same reasoning as
// questionSource.js (options excluded, hint carries the real vocabulary).
const fetchTestSeriesQuestionBatch = async ({ afterId, limit }) => {
  await assertReadOnly();

  const [rows] = await getPool().query(
    "SELECT id, question, hint, subjectId FROM testseriesquestionbank WHERE id > ? ORDER BY id ASC LIMIT ?",
    [afterId, limit]
  );

  return rows;
};

module.exports = { fetchTestSeriesQuestionBatch };
