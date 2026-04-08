# pinboard-api

Cloudflare Worker (TypeScript, [Hono](https://hono.dev/)) backing the Pinboard tool: **D1** for graph data, **R2** for file objects, **Anthropic** (Claude Haiku) for loading bay, explore-next, and tutor scan.

## Prerequisites

1. **D1 database** named `pinboard-db` (or update `database_name` / `database_id` in `wrangler.toml`).

   ```bash
   wrangler d1 create pinboard-db
   ```

   Copy the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`.

2. **R2 bucket** `pinboard-files` (must match `bucket_name` in `wrangler.toml`).

   ```bash
   wrangler r2 bucket create pinboard-files
   ```

3. **Secrets** (Workers dashboard or CLI):

   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put R2_ACCESS_KEY_ID
   wrangler secret put R2_SECRET_ACCESS_KEY
   ```

   Presigned upload URLs use the [R2 S3-compatible API](https://developers.cloudflare.com/r2/api/s3/tokens/). Set plain variable **`R2_ACCOUNT_ID`** in `wrangler.toml` or the dashboard (same value as in the R2 endpoint URL).

4. **R2 CORS** (for browser `PUT` to a presigned URL): in the dashboard, configure CORS on `pinboard-files` for your UI origins (for example `https://pinboard-ui.pages.dev` and `https://gladesystems.uk`), allowing `PUT` and needed headers.

## CORS

- **Production:** `ALLOWED_ORIGINS` in `wrangler.toml` lists allowed `Origin` values (comma-separated). Only matching origins get `Access-Control-Allow-Origin`.
- **Local development:** set `ENVIRONMENT=development` (for example in `.dev.vars`) to allow `Access-Control-Allow-Origin: *`.

## Database migrations

`loading_bay.status` is constrained to `pending`, `processing`, `proposed`, `approved`, `flagged`, `dismissed`. If you already applied an older `0001_init.sql` without that `CHECK`, recreate the database or migrate the table manually before relying on the constraint.

### “No migrations to apply”

That message means Wrangler has **already applied** every file under `migrations/` and recorded them in the local (or remote) `d1_migrations` table. It does **not** mean migrations are missing.

Check that tables exist locally:

```bash
wrangler d1 execute pinboard-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

You should see `nodes`, `connections`, `attachments`, `loading_bay`, `tutor_scans`, etc.

If the API still errors with **no such table** but migrations say “nothing to apply”, local state may be out of sync. From `pinboard-api/`, remove the local D1 state and re-apply:

```bash
# Windows (PowerShell): remove folder .wrangler\state\v3\d1 under pinboard-api if needed
wrangler d1 migrations apply pinboard-db --local
```

### Code checks (no `uuid` package)

This Worker uses **`crypto.randomUUID()`** only. The D1 binding in code is **`env.PINBOARD_DB`** and matches `binding = "PINBOARD_DB"` in `wrangler.toml`.

Apply migrations to the remote D1 database:

```bash
wrangler d1 migrations apply pinboard-db --remote
```

For local development:

```bash
wrangler d1 migrations apply pinboard-db --local
```

(`pinboard-db` is the `database_name` from `wrangler.toml`.)

## Deploy

```bash
wrangler deploy
```

## Develop locally

```bash
npm run dev
```

Ensure local D1/R2 bindings exist or use Wrangler’s local persistence as documented for your Wrangler version.

For `pinboard-ui` pointing at this worker, set `ENVIRONMENT=development` in `.dev.vars` (or allow your dev origin in `ALLOWED_ORIGINS`) so CORS permits the Vite dev server.

**Attachment downloads:** `GET /api/attachments/:id/download` redirects to a presigned R2 GET URL (same credentials as presigned PUT).
