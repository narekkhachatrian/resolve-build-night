# Commands

Run from the `resolve-build-night/` directory.

```bash
npm install                       # deps (Dockerfile uses npm ci --ignore-scripts)
npm test                          # jest, 14 tests, in-memory SQLite, no Postgres needed
npx jest -t "rejects new"         # single test by name (or: npx jest tickets.service -t "...")
npm run test:watch
npx tsc --noEmit                  # typecheck (there is no lint script)
npm run build                     # tsc -> dist/
npm start                         # ts-node src/main.ts on :3000 (needs Postgres)
npm run start:prod                # node dist/main.js (after build)

docker compose up -d db           # Postgres 16 only, for local dev
docker compose up -d --build      # full stack (db + app) on APP_PORT (default 3000)
docker compose down -v            # wipe the pgdata volume
```

Config is env-driven: `PORT`, `DATABASE_URL` (defaults to `postgres://resolve:resolve@localhost:5432/resolve`). `.env` is only read by docker compose for variable substitution. Nothing loads it for `npm start` (no dotenv), so export vars in the shell for local runs.
