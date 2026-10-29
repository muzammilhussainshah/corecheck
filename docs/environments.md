# Environments

| Environment | Git branch | Database                     | API (Render)            | Web / Admin                                         |
| ----------- | ---------- | ---------------------------- | ----------------------- | --------------------------------------------------- |
| Development | any        | local (`npm run db:local`)   | `localhost:4000`        | `localhost:3100` / `:3200`                          |
| Staging     | `staging`  | Supabase `corecheck-staging` | `corecheck-api-staging` | `corecheck-web-staging` / `corecheck-admin-staging` |
| Production  | `main`     | Supabase `corecheck`         | `corecheck-api`         | `corecheck-web` / `corecheck-admin`                 |

Work moves one way: development → `staging` (client testing) → `main`
(production). Render deploys each branch automatically on push, and the API
runs pending database migrations on start, so a migration reaches staging
before it reaches production.

Each environment has its own database and its own secrets. `PIN_PEPPER` and
`MFA_ENCRYPTION_KEY` must differ between staging and production; changing
either later invalidates every PIN or authenticator in that environment.

## Render services

All services: Root Directory empty (repository root), runtime Node, Health
Check Path `/health` for the API.

**API**

- Build: `npm ci --include=dev && npx turbo run build --filter=@corecheck/api`
- Start: `npm run db:migrate:prod -w @corecheck/api && npm run start:prod -w @corecheck/api`
- Environment: `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`,
  `DATABASE_URL`, `DATABASE_SSL=verify`, `DATABASE_CA_CERT`, `PIN_PEPPER`,
  `MFA_ENCRYPTION_KEY`, and `WEB_APP_URL` = that environment's web app address
  (plant QR codes point at `<WEB_APP_URL>/q/<token>`), `STORAGE_DRIVER=supabase`,
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings >
  API; plant documents go to the private `corecheck-files` bucket, created on
  first upload). See `apps/api/.env.example` for the rest. The API refuses to
  start in production without Supabase storage: a Render disk is wiped on
  every deploy.

**Web** (customer app) and **Admin** (internal portal)

- Build: `npm ci --include=dev && npx turbo run build --filter=@corecheck/web`
  (or `@corecheck/admin`)
- Start: `cd apps/web && npx next start -p $PORT` (or `apps/admin`)
- Environment: `BACKEND_URL` = that environment's API URL, e.g.
  `https://corecheck-api-staging.onrender.com`. The browser calls `/api/*` on
  the web origin and Next forwards it there, so the API needs no CORS setup.

## Running a command against staging from a laptop

Put the staging values in `apps/api/.env.staging` (ignored by git), then:

```sh
cd apps/api
# First staff owner for the staging admin portal
ENV_FILE=.env.staging npm run staff:create -- --email you@example.com --name "Your Name"
# Demo organisation and users (refused for any remote database unless named)
ENV_FILE=.env.staging DEMO_SEED_TARGET=postgres.<ref>@<host> npm run seed:demo
```

`seed:demo` refuses a remote database unless `DEMO_SEED_TARGET` names it, so a
`.env` that points at production cannot be seeded by mistake.

## Releasing

1. Merge or push the change to `staging`; wait for Render to deploy.
2. Test on the staging web and admin URLs.
3. Merge `staging` into `main`; Render deploys production.
4. Fixes found in production go to `staging` first, then `main`, so the two
   branches never drift apart.
