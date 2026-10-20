# CoreCheck

Plant and equipment inspection and compliance platform. A sister product to
CoreStock, built on the same stack.

## Structure

```
apps/
  api/      NestJS + TypeORM backend                 http://localhost:4000
  web/      Next.js customer web app                 http://localhost:3100
  admin/    Next.js internal CoreCheck admin portal  http://localhost:3200
  mobile/   React Native (CLI) app for iOS and Android
packages/
  shared/   Constants, types and validation used by every app
docs/       Technical design, schema and security documentation
```

| App    | Stack                                                     |
| ------ | --------------------------------------------------------- |
| api    | NestJS 12, TypeORM, Postgres (Supabase), Supabase Storage |
| web    | Next.js 16 (App Router), Mantine 9, Tailwind CSS 4        |
| admin  | Next.js 16 (App Router), Mantine 9, Tailwind CSS 4        |
| mobile | React Native 0.88 (bare CLI, no Expo), Hermes, New Arch   |

All apps use React 19.3 and TypeScript 6.0.

## Getting started

Requires Node 24 (see `.nvmrc`) and npm 11. The mobile app also needs
JDK 17 and the Android SDK for Android, and a Mac with Xcode and CocoaPods
for iOS.

```bash
npm install                 # installs every workspace and builds packages/shared

# copy each app's env template and fill it in
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local

npm run dev                 # api + web + admin (+ shared in watch mode)

npm run dev:mobile          # Metro bundler, in its own terminal
npm run mobile:android      # build and launch on an Android device/emulator
npm run mobile:ios          # macOS only: cd apps/mobile/ios && pod install first
```

## Scripts

| Command                  | What it does                                |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | api, web and admin together                 |
| `npm run dev:web`        | web only (plus shared)                      |
| `npm run dev:admin`      | admin only (plus shared)                    |
| `npm run dev:api`        | api only (plus shared)                      |
| `npm run dev:mobile`     | Metro bundler for the mobile app            |
| `npm run mobile:android` | build and run the Android app               |
| `npm run mobile:ios`     | build and run the iOS app (macOS only)      |
| `npm run check`          | lint, typecheck, test and build everything  |
| `npm run lint`           | lint every workspace                        |
| `npm run typecheck`      | type-check every workspace                  |
| `npm run test`           | run unit tests                              |
| `npm run build`          | production build of shared, api, web, admin |
| `npm run format`         | format the repo with Prettier               |

Add a dependency to one app with `npm install <package> -w @corecheck/<app>`.

## Conventions

- **Monorepo:** npm workspaces + Turborepo. Workspace packages are named
  `@corecheck/<folder>`.
- **API calls from the browser:** web and admin call `/api/*`, which Next
  rewrites to `BACKEND_URL` (the same arrangement as CoreStock), so the API
  needs no CORS setup.
- **API is ESM:** relative imports end in `.js`
  (`import { X } from './x.js'`), and TypeORM relation properties use the
  `Relation<>` wrapper type to avoid circular-import errors.
- **Mantine + Tailwind:** Mantine's styles sit in a cascade layer between
  Tailwind's base and utilities (see `app/globals.css`), so Tailwind utility
  classes work on Mantine components.
- **Mobile in the monorepo:** React Native and its tooling are hoisted to the
  repo-root `node_modules`. `apps/mobile/metro.config.js` watches the whole
  repo, and the Android Gradle files (`settings.gradle`, `app/build.gradle`)
  point at the root `node_modules`. Keep one React and one React Native
  version across the repo; React Native pins the exact React version.
- **Shared package:** `packages/shared` is compiled to `dist/`. `npm run dev`
  rebuilds it on change; otherwise run `npm run build -w @corecheck/shared`.
- **Requirement traceability:** reference FRD requirement IDs (for example
  `USR-005`) in tickets, commits and tests.
