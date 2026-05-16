# Bek Market HR Bot

Bek Market xodimlari uchun korporativ Telegram AI yordamchi boti — kompaniya qoidalari, ichki nizomlar, HR moslashuvi va ish ko'rsatmalari bo'yicha o'zbek tilida javob beradi.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- AI: OpenAI via Replit AI Integrations (gpt-5-mini)
- Telegram: node-telegram-bot-api (polling mode)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/telegram.ts` — Telegram bot logic, polling, message handling
- `artifacts/api-server/src/knowledge-base.ts` — Company knowledge base (rules, HR policies, etc.)
- `lib/db/src/schema/telegram-sessions.ts` — DB schema for sessions and message history
- `lib/integrations-openai-ai-server/` — OpenAI client and utilities

## Architecture decisions

- Polling mode for Telegram (no webhook needed, works in development without a public URL)
- Conversation history (last 10 messages) stored in PostgreSQL for context
- System prompt includes full knowledge base — no vector DB needed at current scale
- Upsert pattern for sessions to handle server restarts gracefully
- gpt-5-mini used for cost efficiency (high message volume expected)

## Product

- Employees message the Telegram bot in Uzbek
- Bot answers questions about company rules, HR policies, work instructions, salary, leave, dress code, and more
- `/start` — welcome message, `/help` — command list, `/reset` — clear history
- All answers strictly grounded in the knowledge base; unknown questions are redirected to HR

## User preferences

- Bot language: Uzbek only
- No emojis in bot responses

## Gotchas

- Bot uses polling mode — only one instance should run at a time (no duplicate processes)
- `TELEGRAM_BOT_TOKEN` must be set in secrets
- `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` are auto-provisioned by Replit AI Integrations
- To update knowledge base: edit `artifacts/api-server/src/knowledge-base.ts` and restart the server

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
