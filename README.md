# HouseDeck

A portable, modern house-points app for schools. This rebuild keeps the core Base44 functionality while moving the project into a standard Next.js codebase.

## Current Prototype

- Dashboard with house standings, top students, activity, and setup goals.
- Student roster with search, house filter, family IDs, and clear actions.
- Point-award workflow with presets, category, reason, and selected-student preview.
- Assignment page with family-safe balancing language and CSV/template controls.
- Public-style scoreboard.
- Reports and admin settings.
- Four locked house colors: Red, Blue, Yellow, Green.
- Mascot slots prepared for future artwork.
- Supabase database/auth wiring with local sample-data fallback.

## Run Locally

```bash
npm run dev
```

Then open:

```txt
http://127.0.0.1:3020
```

This project uses the webpack dev server by default because it is the more reliable browser-run path for this workspace.

## Checks

```bash
npm run lint
npm run build
npm run start
```

## Supabase Setup

The connected Supabase project is `Houses`:

```txt
Project ref: mxraukesrxnapffgiibs
URL: https://mxraukesrxnapffgiibs.supabase.co
```

The database tables and RLS policies have been applied to that project. A portable schema copy is saved at:

```txt
supabase/house-deck-schema.sql
```

Create `.env.local` from `.env.example` and add your Supabase anon or publishable key:

```bash
cp .env.example .env.local
```

Then set:

```txt
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Until `.env.local` is filled in, the app continues to run with sample data. Package installation for `@supabase/ssr` was blocked by network access in this environment, so the current implementation uses Supabase Auth and PostgREST through `fetch`.

## Next Build Phase

- Replace the REST helper with `@supabase/ssr` once npm registry access is available.
- Add admin-only role management and invitation delivery.
- Add CSV import preview and validation.
- Add term/semester archives.
- Split public scoreboard from admin/teacher tools.
- Finalize the app name and house mascot system.
