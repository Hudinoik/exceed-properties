# Jibble Backend Proxy — Quick Setup

This file solves the CORS problem that prevents the browser from calling Jibble directly. You deploy a small backend that holds your credentials and forwards requests; the frontend talks to your backend instead.

---

## Why this is needed

Jibble's API (`identity.prod.jibble.io` and `workspace.prod.jibble.io`) does not send the `Access-Control-Allow-Origin` headers required to allow browser-based JavaScript to call it directly. This is normal — most business APIs work this way for security reasons.

The frontend code in `ExceedProperties.jsx` is already structured correctly. All you need to do is:
1. Deploy a tiny backend (any of the options below)
2. Change the **API Base URL** field in Settings → Integrations → Jibble to point at your backend
3. The same code now works

---

## Option 1: Node.js / Express (Vercel, Railway, Render, Fly.io)

Easiest to deploy. About 60 lines of code. Free tier on Vercel/Railway covers this comfortably.

### `server.js`

```js
import express from 'express';
import cors from 'cors';

const app = express();
app.use(express.json());

// Allow your frontend origin. Lock this down to your deployed domain in production.
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
}));

const JIBBLE_IDENTITY = 'https://identity.prod.jibble.io/connect/token';
const JIBBLE_API = 'https://workspace.prod.jibble.io/v1';

// In-memory token cache (one per server instance — fine for small teams)
let cachedToken = null;
let cachedExpiry = 0;

async function getAccessToken() {
  // Reuse cached token if still valid (refresh 60s before expiry)
  if (cachedToken && Date.now() < cachedExpiry - 60_000) {
    return cachedToken;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.JIBBLE_CLIENT_ID,
    client_secret: process.env.JIBBLE_CLIENT_SECRET,
  });
  const res = await fetch(JIBBLE_IDENTITY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  cachedExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

// Generic passthrough: GET /api/jibble/People?$top=50  →  Jibble /v1/People?$top=50
app.get('/api/jibble/*', async (req, res) => {
  try {
    const token = await getAccessToken();
    const path = req.path.replace('/api/jibble/', '/');
    const qs = new URLSearchParams(req.query).toString();
    const url = `${JIBBLE_API}${path}${qs ? '?' + qs : ''}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Jibble proxy on :${port}`));
```

### `package.json`

```json
{
  "name": "jibble-proxy",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5"
  }
}
```

### Environment variables to set

| Name | Value |
|---|---|
| `JIBBLE_CLIENT_ID` | Your Jibble API Key ID (from Org Settings → API Keys) |
| `JIBBLE_CLIENT_SECRET` | Your Jibble API Key Secret |
| `ALLOWED_ORIGIN` | Your frontend domain, e.g. `https://exceed-properties.vercel.app` |

### Deploy to Vercel (quickest)

```bash
npm install -g vercel
vercel
# follow prompts, set env vars in dashboard
```

### Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
# set env vars in Railway dashboard
```

---

## Option 2: Cloudflare Workers (lightest)

If you don't want to manage a Node server. ~30 lines, runs on Cloudflare's edge.

### `worker.js`

```js
const JIBBLE_IDENTITY = 'https://identity.prod.jibble.io/connect/token';
const JIBBLE_API = 'https://workspace.prod.jibble.io/v1';

let cachedToken = null;
let cachedExpiry = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < cachedExpiry - 60_000) return cachedToken;
  const res = await fetch(JIBBLE_IDENTITY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.JIBBLE_CLIENT_ID,
      client_secret: env.JIBBLE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    try {
      const token = await getAccessToken(env);
      const path = url.pathname.replace('/api/jibble', '');
      const target = `${JIBBLE_API}${path}${url.search}`;
      const r = await fetch(target, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await r.text();
      return new Response(data, {
        status: r.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
```

Deploy with `wrangler deploy`. Set secrets with `wrangler secret put JIBBLE_CLIENT_ID` etc.

---

## Option 3: Supabase Edge Function

If you're already using Supabase for your backend.

### `supabase/functions/jibble/index.ts`

```ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const JIBBLE_IDENTITY = 'https://identity.prod.jibble.io/connect/token';
const JIBBLE_API = 'https://workspace.prod.jibble.io/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

let cachedToken: string | null = null;
let cachedExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExpiry - 60_000) return cachedToken;
  const res = await fetch(JIBBLE_IDENTITY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: Deno.env.get('JIBBLE_CLIENT_ID')!,
      client_secret: Deno.env.get('JIBBLE_CLIENT_SECRET')!,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken!;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/jibble', '');
    const token = await getAccessToken();
    const r = await fetch(`${JIBBLE_API}${path}${url.search}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return new Response(await r.text(), {
      status: r.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

Deploy with `supabase functions deploy jibble`. Set secrets with `supabase secrets set JIBBLE_CLIENT_ID=...`.

---

## Configuring the frontend

Once your proxy is deployed:

1. Open the Exceed Properties app → **Settings → Integrations → Jibble**
2. Change **API Base URL** to:
   - Vercel/Railway: `https://your-proxy.vercel.app/api/jibble`
   - Cloudflare: `https://jibble-proxy.your-subdomain.workers.dev/api/jibble`
   - Supabase: `https://your-project.supabase.co/functions/v1/jibble`
3. The **API Key ID** and **Secret** fields can be left blank (the proxy holds them server-side)
4. Click **Test Connection** — it should succeed

The frontend client (`jibbleAPI` in `ExceedProperties.jsx`) does NOT need to change. It uses standard OAuth + REST, and the proxy is invisible to it.

---

## Security notes

- Never commit `JIBBLE_CLIENT_SECRET` to git — use environment variables
- Restrict `ALLOWED_ORIGIN` to your real frontend domain in production, not `*`
- Add an auth layer on top of the proxy (e.g. require your own JWT) so only logged-in Exceed users can call it
- Consider rate-limiting the proxy to prevent abuse (e.g. Express `express-rate-limit`)
- Store the cached `access_token` in Redis if you scale beyond one instance — in-memory cache won't work across replicas
