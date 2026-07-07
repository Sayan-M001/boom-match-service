# Boom Match Service

Standalone temporary Boom Match API for client testing without changing the main staging database.

## Why this exists

The staging `boom-backend` database is shared by other developers, so Boom Match tables and migrations should not be pushed there for temporary client testing. This service owns a separate Postgres database and verifies existing Boom access tokens by calling the normal backend.

```text
temporary dashboard
  -> staging boom-backend for normal app APIs/auth
  -> boom-match-service for /v1/quiz and /v1/admin/quiz
       -> separate Boom Match database
       -> verifies bearer token with BOOM_BACKEND_URL/v1/auth/verify
```

## Environment

```bash
PORT=4005
DATABASE_URL="postgresql://user:password@host:5432/boom_match_test?sslmode=require"
BOOM_BACKEND_URL="https://api.freeboomshare.com"
BOOM_MATCH_ADMIN_EMAILS="sayan@email.com"
CORS_ALLOWED_ORIGINS="http://localhost:3000,https://your-temp-dashboard.example.com"
GEMINI_API_KEY=""
```

`BOOM_MATCH_ADMIN_EMAILS` protects the temporary admin tournament APIs. No staging backend role change is required.

## Local Development

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Health check:

```bash
curl http://localhost:4005/health
```

## API Surface

User routes:

```text
/v1/quiz/profile
/v1/quiz/rewards/claim
/v1/quiz/daily/start
/v1/quiz/competitions
/v1/quiz/competitions/:competitionId/eligibility
/v1/quiz/competitions/:competitionId/entries
/v1/quiz/competitions/:competitionId/entries/me
/v1/quiz/competitions/:competitionId/entries/:entryId/complete
/v1/quiz/leaderboard
/v1/quiz/worlds/:worldId/unlock
/v1/quiz/worlds/:worldId/equip
/v1/quiz/history
/v1/quiz/history/:matchId
/v1/quiz/duels
/v1/quiz/duels/:duelId
/v1/quiz/duels/:duelId/respond
/v1/quiz/duels/:duelId/cancel
/v1/quiz/duels/:duelId/selection
/v1/quiz/duels/:duelId/lock-stake
/v1/quiz/duels/:duelId/join
/v1/quiz/duels/:duelId/complete
```

Admin routes:

```text
/v1/admin/quiz/tournaments
/v1/admin/quiz/tournaments/:competitionId/close
```

## Render

Recommended settings:

```text
Build command: npm install && npx prisma generate && npm run build
Start command: npx prisma migrate deploy && npm start
```

Dashboard env for the temporary frontend:

```bash
NEXT_PUBLIC_API_ENDPOINT="https://staging-api.freeboomshare.com/v1"
NEXT_PUBLIC_BOOM_MATCH_API_URL="https://boom-match-service.onrender.com/v1"
```

## Notes

- Users are mirrored locally from `/v1/auth/verify` by id/email/name.
- Boom Match coins are local to this service and do not affect staging wallet coins.
- Tournament close queues local pending coin rewards and does not send push notifications yet.
- Auto Capture segments are modeled locally. For meaningful generated daily/tournament questions, seed or sync readable segments into this service database.
