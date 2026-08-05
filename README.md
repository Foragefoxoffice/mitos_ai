# mitos_ai — AI Service

Standalone AI platform service for MITOS Learning — dictionary, chat, wallet, and model routing. Deliberately separate from `backend/`: own process, own database (`mitos_ai` MySQL), own Redis, own deploy. See `../mitos/docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md` (in the main `mitos` project) for the full architecture and sprint plan.

Only the core `backend` calls this service, via a shared internal key — it is never called directly by client apps.

## Setup

```bash
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, INTERNAL_SERVICE_KEY, provider keys
npm install
npx prisma generate
npm run dev
```

## Core DB read access

The dictionary generator reads real questions from the core backend's
database (`maindb`) — a separate database this service does not own and
must never write to. That connection uses a MySQL user granted `SELECT`
only, on exactly the `question` table, nothing else:

```sql
CREATE USER 'mitos_ai_reader'@'%' IDENTIFIED BY 'CHOOSE_A_STRONG_PASSWORD';
GRANT SELECT ON maindb.question TO 'mitos_ai_reader'@'%';
FLUSH PRIVILEGES;
```

Run via phpMyAdmin's SQL tab (or equivalent) — not the panel's "Add DB"
button, which tends to grant full read/write access. Expand the grant to
more tables only when a specific feature actually needs it (e.g.
`subject`/`chapter`/`topic` once Chat's context builder is built) —
least privilege, not a blanket grant up front.

`src/services/questionSource.js` also verifies this at runtime: before any
query, it checks `SHOW GRANTS FOR CURRENT_USER()` and refuses to proceed if
the connected user has any write privilege at all. That check never
attempts a write to verify — it only reads privilege metadata — so a
misconfigured grant fails loudly on first use instead of silently being
capable of mutating or deleting real production content.

## Structure

```
src/
  controllers/
  routes/
  services/
  providers/     # OpenAI / Gemini / Claude adapters
  router/         # task -> model routing, with fallback chain
  prompts/         # versioned
  jobs/             # batch generation, retries
  middlewares/       # internal service-key auth
  cache/               # Redis helpers
  utils/
prisma/                 # mitos_ai schema + client
```
# mitos_ai
