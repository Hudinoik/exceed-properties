# Deploying to Render

Render is the simplest fit for this stack: long-running Node process,
persistent disk for the DB file, free HTTPS, free PR previews.

## One-time setup

1. **Push the repo to GitHub.** Render builds from a Git source.

2. **Create a "Web Service"** at https://dashboard.render.com.

   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Runtime:** Node 22 or 24 (auto-detected from `package.json` if you
     add an `"engines"` field; otherwise leave on default).

3. **Attach a persistent disk.** Render → your service → "Disks" → Add.
   - **Mount path:** `/var/data`
   - **Size:** 1 GB is plenty for the JSON DB + audit log

4. **Set environment variables** (Render → Environment → Add):

   ```
   PORT             10000                          (Render sets this automatically)
   NODE_ENV         production
   DATABASE_PATH    /var/data/app.json
   CLIENT_ORIGIN    https://exceed-properties.onrender.com    (your real URL, no trailing slash)
   SESSION_SECRET   <run: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">
   ENCRYPTION_KEY   <run: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
   SEED_ADMIN_EMAIL      w.marks@exceedproperties.co.za
   SEED_ADMIN_PASSWORD   <a one-time random value you'll share with Wayne>
   SEED_ADMIN_FIRST_NAME Wayne
   SEED_ADMIN_LAST_NAME  Marks
   SEED_ADMIN_ROLE       director
   ```

   **Save the `ENCRYPTION_KEY` value in your password manager NOW.**
   Losing it makes every stored API credential unrecoverable.

5. **Deploy.** Render builds and starts the service. On first start, the
   server creates `/var/data/app.json` and seeds the admin user.

6. **Sign in once at your URL** with the seeded email + temporary
   password. The app forces you to change the password immediately.

7. **Remove `SEED_ADMIN_PASSWORD` from the env** in Render's dashboard.
   It's only read when the users table is empty; leaving it around is
   harmless but unnecessary.

## Generating secrets

Run these locally and paste the output into Render's env vars:

```bash
# 48-byte session secret
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# 32-byte encryption key (PROTECT THIS)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Local development

```bash
cp server/.env.example server/.env
# Edit server/.env — fill in SESSION_SECRET, ENCRYPTION_KEY (generate locally)
npm install
npm run dev
```

This runs Vite on `:5173` and Express on `:4000` simultaneously
(via `concurrently`). Vite proxies `/api/*` to Express. Open
http://localhost:5173 in the browser.

## Adding more users

Right now only the seeded admin exists. The Users & Roles page exists in
the UI but currently writes employee records to local state — adding
real DB-backed user creation is the next priority. For now, to add a
user manually you can:

1. Run `npm run seed` while the DB is empty to seed a fresh admin.
2. Or use a shell on the server: `node -e "import('./server/db.js').then(...)"`
   — not pleasant, but works as a stopgap.

I'll wire the Users page to the backend in a follow-up.

## Backups

Add a Render cron job (separate worker service or a third-party like
`https://cron-job.org`) that runs once a day:

```bash
curl -X POST -H "X-CSRF-Token: …" -H "Cookie: ep.sid=…" https://your-url/api/admin/backup
```

The `/api/admin/backup` endpoint is not yet implemented — for an MVP,
Render's automatic disk snapshots are sufficient (they snapshot the
disk every 24h and retain for 30 days on the paid plan).

## Rotating the encryption key

If you ever need to rotate `ENCRYPTION_KEY` (suspected leak, key
escrow change, etc.), you need to:

1. Take the service into maintenance mode (no new writes).
2. Run a re-encryption script that reads every row in `secrets`,
   decrypts with the OLD key, encrypts with the NEW key, writes back.
3. Swap the env var.
4. Restart.

That script is not yet written — open a ticket and I'll write it.

## Rotating `SESSION_SECRET`

Safe to change at any time. All active sessions become invalid, so
every user has to log in again. No data loss.
