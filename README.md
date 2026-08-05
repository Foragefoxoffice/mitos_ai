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
