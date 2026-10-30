# CoreCheck — Milestone 1 Technical Design

Covers the decisions FRD §25.1 requires before build approval, the NFR-004
targets, and how each Milestone 1 acceptance criterion is evidenced.

## 1. Architecture

| Part                                 | Technology                                                       | Hosting                          |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------- |
| API (`apps/api`)                     | NestJS 12, TypeORM 1.x, Node 24                                  | Render (web service)             |
| Database                             | PostgreSQL 17 with row-level security                            | Supabase                         |
| Files                                | Local disk in M1 PoC; Supabase Storage (private buckets) from M2 | Supabase                         |
| Customer web (`apps/web`)            | Next.js 16, Mantine 9, Redux Toolkit Query                       | Vercel                           |
| Internal admin portal (`apps/admin`) | Next.js 16, Mantine 9                                            | Vercel (separate project/domain) |
| Mobile (`apps/mobile`)               | React Native 0.88 (bare CLI), SQLite (op-sqlite)                 | App Store / Google Play          |
| Shared rules (`packages/shared`)     | Permissions, statuses, zod validation, API types                 | —                                |

Browsers call `/api/*` on their own origin; Next rewrites it to the API, so
session cookies are first-party, `httpOnly`, `SameSite=Strict` (no CSRF), and
the API needs no CORS.

Environments: **development** (local Postgres via `npm run db:local`),
**staging** and **production** (one Supabase project, one Render service and
two Vercel projects each). Migrations run with `npm run db:migrate:prod`
before each API deploy.

## 2. Tenant isolation (TEN-001..004, NFR-001)

Three database privilege levels:

1. **Customer requests** run in one transaction as role `corecheck_app` with
   `corecheck.org_id` / `corecheck.user_id` set. Every customer table has an
   RLS policy `org_id = current_org_id()`; child rows reference parents by
   `(id, org_id)` composite keys, so cross-organisation links are impossible.
2. **Internal staff** run as `corecheck_platform`, which has no privileges on
   customer tables at all (IAD-011, IAD-AC-04). Staff see only organisations,
   user counts and Organisation Admin identities through two narrow
   `SECURITY DEFINER` functions.
3. **System** (table owner) is used only for sign-in, session checks and
   provisioning.

Tested by `test/tenant-isolation.int-spec.ts` (API and raw-SQL RLS probes).

## 3. Permissions and scope (FRD 3.2, 4, Appendix C)

- 64 permission codes = Appendix C rows + organisation settings; the five
  standard roles are seeded per organisation and locked; Admins build custom
  roles (e.g. read-only Viewer) from the same catalogue.
- Effective access = permission **and** record scope (sites, teams,
  disciplines). Managers act only on non-privileged users inside their sites;
  Supervisors see their teams; Admin is organisation-wide.
- Permissions and scope are read from the database on every request, so
  changes apply immediately (ROL-AC-03, MOB-AC-03).

## 4. Authentication, PINs and sessions (FRD 16)

| Rule          | Decision                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Username      | first + last name + 2–3 digits, unique platform-wide                                                                                                                               |
| PIN           | 6 digits; weak patterns (111111, 123456, 121212…) refused                                                                                                                          |
| PIN storage   | HMAC-SHA256 with server pepper, then scrypt (N=2^15, r=8) + salt                                                                                                                   |
| Temporary PIN | random, shown once, valid 7 days, must be replaced before any access                                                                                                               |
| Lockout       | 5 consecutive failures → Locked; only an authorised reset/unlock lifts it                                                                                                          |
| Sessions      | opaque 256-bit tokens, SHA-256 stored; one live session per user (DB unique index); new sign-in ends the old one                                                                   |
| Timeouts      | web 30 min idle / 12 h max; mobile 30 days; staff 30 min / 8 h                                                                                                                     |
| Staff         | email + password (≥12 chars), lockout after 5 failures; TOTP MFA available behind `STAFF_MFA_REQUIRED` (off by default — not required by the FRD or ITDR; confirm with the client) |
| Rate limit    | 10 sign-in attempts / minute / IP, plus account lockout                                                                                                                            |
| Org state     | Suspended/Archived → no sign-in, sessions ended; before start date → no sign-in; after expiry → read-only                                                                          |

Every sign-in, failure, lockout, PIN change, reset, role/scope change and
provisioning action is written to `audit_events`, which a trigger makes
immutable for every role including the owner (AUD-004).

## 5. Seat limits (IAD-005)

Enforced by a database trigger: Active and Locked users hold seats; an
advisory lock serialises concurrent activations (tested with 5 parallel
requests for 1 seat).

## 6. Offline synchronisation proof of concept (FRD 21)

- Device keeps an outbox of mutations with device-generated ids and device
  timestamps in SQLite; work survives restarts and sign-outs.
- Sync order: photos → queued answers/submissions → snapshot pull.
- Server: replays answered from a stored result (idempotent); newest answer
  by device time wins; submission is a conditional `open → submitted`
  update, so the **first valid submission wins** and later ones get a clear
  message naming who submitted (MOB-006/007).
- Pull returns only checks in current scope; the device deletes everything
  else (revoked access, MOB-AC-03).
- Photos: type checked by magic bytes; EXIF/GPS, IPTC, XMP and comments
  stripped server-side; picker requests no metadata (EVD-004).
- Evidence: `test/poc-sync.int-spec.ts` (7 tests) and mobile `model.test.ts`.
- M4 hardening: SQLCipher encryption with a Keychain-held key, background
  sync, conflict UI for drafts.

## 7. Measurable targets (NFR-004)

| Area         | Target                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| Availability | 99.5 % monthly                                                                 |
| API latency  | p95 < 500 ms reads, < 1 s writes                                               |
| Sync         | queued work synced ≤ 60 s after connectivity returns (excluding large uploads) |
| Uploads      | photos ≤ 10 MB (devices send ≤ 1600 px JPEG)                                   |
| Backup       | Supabase daily backups, 7 days (Pro); RPO 24 h, RTO 4 h                        |
| Monitoring   | Render/Vercel logs, request id on every error, health check `/health`          |

## 8. Providers (FRD 26)

Email: Brevo (M4). Push: Firebase Cloud Messaging + APNs (M4). Storage:
Supabase Storage. Error monitoring: Sentry (to be added with production).

## 9. Documented security exceptions (SEC-005)

- Antivirus scanning of uploads is not in M1; files are type-validated and
  metadata-stripped.
- Local mobile database is unencrypted in the PoC (encrypted in M4).
- IP rate limit trusts `X-Forwarded-For` behind the proxy; account lockout
  is the primary brute-force control.

## 10. Milestone 1 acceptance evidence

| ITDR acceptance criterion                                       | Evidence                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Staff create an isolated customer organisation                  | `platform.int-spec.ts`, browser test `e2e/milestone-1.spec.ts` |
| First Organisation Admin signs in and changes the temporary PIN | `auth.int-spec.ts`, browser test                               |
| Organisations cannot access one another's data                  | `tenant-isolation.int-spec.ts` (API + RLS)                     |
| Server-side permissions and site scope enforced                 | `access-control.int-spec.ts` (14 tests)                        |
| Seat limits prevent unauthorised activation                     | `seats.int-spec.ts` incl. concurrency                          |
| Internal staff cannot access customer records                   | `tenant-isolation.int-spec.ts`, `platform.int-spec.ts`         |
| Offline-sync PoC demonstrates viability                         | `poc-sync.int-spec.ts`, mobile app, `model.test.ts`            |
| Architecture, schema and security documentation                 | this document + migration `1760500000000-initial-schema.ts`    |

Run everything: `npm run check` (lint, typecheck, unit + integration tests,
build) and `npm run test:e2e` (browser journey; needs built apps).

## 11. Milestone 1 scope items not closed in code

| ITDR scope / FRD item                                    | Status                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial Figma design system and approved core user flows | The client Figma covers the sign-in screens, PIN entry, toasts and the header Quick actions; these are built to it. The other screens follow the CoreStock pattern in code (`packages/ui`: theme, tables, filter panel, forms, status badges, loader). Figma frames for those flows and client sign-off are still open. |
| Development, staging and production environments         | Development (local) and production (Render + Supabase) are running. Staging deploys from the `staging` branch to its own Supabase project and Render services; see `docs/environments.md`.                                                                                                                              |
| Seat-limit and expiry notifications (IAD-005, IAD-006)   | Shown in the app: Managers/Admins see "all seats in use" and an expiry warning 30 days ahead; the event is audited. Email delivery comes with the notifications milestone (Brevo).                                                                                                                                      |
| Plant usage in the internal portal (IAD-004)             | Closed in Milestone 2: the portal shows a plant total per organisation, a count only (`organisation_plant_counts()`).                                                                                                                                                                                                   |
| Web hosting on Vercel                                    | Needs a Vercel Pro team (the repository belongs to a private GitHub organisation); Render can host the two Next.js apps instead.                                                                                                                                                                                        |

## 12. Milestone 2 design (FRD 7, 9, 12, 14, 19)

- **Configuration and register.** Plant types, categories, companies, custom
  fields, meter types and document types are tenant tables under the usual
  `tenant_isolation` policy. System Asset IDs are unique per organisation;
  Plant and Serial Numbers only warn.
- **Lifecycle.** Status is one value (Pending Reception, Awaiting Approval,
  Approved/Online, Restricted/Offline). Restriction reasons sit beside it and
  archiving is a timestamp, so restoring returns the earlier status. Every
  change is audited against the plant, which feeds its History tab.
- **Documents.** Each upload is a version; earlier files and verification
  history are kept. Status is worked out by database views from the current
  version and today's date in the organisation's time zone, never stored.
  Files are read only through the API after a scope check.
- **Compliance.** A missing, expired or rejected mandatory document blocks
  approval and restricts approved plant, on change and on an hourly sweep. An
  override needs a reason and a review date.
- **Reception.** Published template versions are frozen in the database. A
  check pins the version it was assigned, and each submission is copied with
  its answers, evidence and who gave them.
- **Meters.** Corrections sit beside the reading, keeping the original value,
  reason, person and time.
- **Import.** An upload is stored as rows and creates nothing. Rows are checked
  against configuration and the register, corrected in the app without
  re-uploading, and created through the same path as a manual plant. New
  records only; existing plant is never merged.

## 13. Milestone 2 acceptance evidence

| ITDR acceptance criterion                                         | Evidence                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Operative creates Pending Reception plant and submits reception   | `reception.int-spec.ts`                                               |
| Plant lifecycle follows the FRD                                   | `plants.int-spec.ts`, `reception.int-spec.ts`                         |
| Duplicate System Asset ID blocked                                 | `plants.int-spec.ts`, `imports.int-spec.ts`                           |
| Plant Number and Serial Number only warn                          | `plants.int-spec.ts`, `imports.int-spec.ts`                           |
| Missing or expired mandatory document prevents approval           | `documents.int-spec.ts`, `reception.int-spec.ts`, browser test        |
| Successful reception goes Online; configured failure goes Offline | `reception.int-spec.ts`, browser test `e2e/tests/milestone-2.spec.ts` |
| Plant workflow actions audited                                    | `meters.int-spec.ts`, `reception.int-spec.ts`, browser test (History) |
| Import preview, validation, corrections and error report          | `imports.int-spec.ts`                                                 |
| Plant data and files isolated between organisations               | `plant-isolation.int-spec.ts`, `documents.int-spec.ts`                |

## 14. Milestone 2 items open

| Item               | Status                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging sign-off   | Not yet deployed. Needs `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `WEB_APP_URL` on Render, then `db:migrate`; see `docs/environments.md`. |
| Checks and Defects | Plant profile tabs are placeholders; a reception failure sets the plant Offline but raises no defect until the defects milestone.                                          |
