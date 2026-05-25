# DocuSign Integration

The Exceed Props app uses a **single DocuSign service account** (JWT Grant)
to send all envelopes. There is no per-user OAuth: every property
manager's "send lease" action goes through the same DocuSign account.

Code layout:

| Path                              | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `server/docusign/auth.js`         | JWT auth + in-memory token cache       |
| `server/docusign/envelopes.js`    | `sendLeaseForSignature`, `sendLeaseFromTemplate`, `getEnvelopeStatus`, `downloadSignedDocument`, `listEnvelopes` |
| `server/docusign/webhook.js`      | HMAC-SHA256 signature verification     |
| `server/routes/docusign.js`       | Auth-gated Express routes (`/api/docusign/*`) |
| `server/routes/webhooks.js`       | Public `/api/webhooks/docusign` receiver + admin event log |
| `scripts/test-docusign-auth.js`   | Standalone JWT smoke test              |
| `src/lib/api.js`                  | SPA client helpers (`docusignSendLease`, …) |

## Environment variables

Set these in `server/.env` for local dev and in the **Render dashboard →
Environment** for production.

There is **one set of env-var names** but their values change between
demo and production. The two cells in each row below show the
demo value vs. the production value.

| Variable                     | Required | Demo value                                | Production value                                 |
| ---------------------------- | -------- | ----------------------------------------- | ------------------------------------------------ |
| `DOCUSIGN_INTEGRATION_KEY`   | yes      | from demo Apps & Keys (a GUID)            | from prod Apps & Keys — usually **same GUID** as demo, but verify per integration |
| `DOCUSIGN_USER_ID`           | yes      | demo API user **API Username** (GUID)     | prod API user **API Username** (GUID) — **DIFFERS** from demo (different user record) |
| `DOCUSIGN_ACCOUNT_ID`        | yes      | demo Account ID (GUID)                    | prod Account ID (GUID) — **DIFFERS** from demo |
| `DOCUSIGN_OAUTH_HOST`        | no (defaulted) | `account-d.docusign.com`             | `account.docusign.com` (no `-d`) |
| `DOCUSIGN_BASE_PATH`         | **no — auto-discovered** | `https://demo.docusign.net/restapi` (fallback) | leave blank or any value; **base path is auto-discovered per request via /oauth/userinfo** |
| `DOCUSIGN_PRIVATE_KEY`       | yes      | demo RSA private key (PEM)                | prod RSA private key (PEM) — **generate a new keypair, do not reuse demo's** |
| `DOCUSIGN_WEBHOOK_SECRET`    | yes (for Connect) | demo Connect HMAC secret           | prod Connect HMAC secret — set when you create the prod Connect config (Phase E in the go-live checklist) |

### Base path auto-discovery

Since the production switchover, `DOCUSIGN_BASE_PATH` is no longer
authoritative. After minting a JWT, the auth module calls
`https://{OAUTH_HOST}/oauth/userinfo`, finds the account that matches
`DOCUSIGN_ACCOUNT_ID`, and uses **that** account's `base_uri` for the
session. This means:

- **Demo**: the discovered URI will always be `https://demo.docusign.net/restapi`
  for every account.
- **Production**: it could be `https://na1.docusign.net`, `na2`,
  `na3`, `na4`, `eu`, or `au` depending on where DocuSign provisions
  the account. You no longer have to know which one in advance.

If `/oauth/userinfo` fails (network blip, account ID typo), the server
logs a warning and falls back to whatever `DOCUSIGN_BASE_PATH` is set
to. So leaving the env var in place as a safety net is fine.

### Switching environments — exactly what changes

When promoting demo → production, **five env vars must change**:

1. `DOCUSIGN_INTEGRATION_KEY` (usually same value, but verify)
2. `DOCUSIGN_USER_ID`
3. `DOCUSIGN_ACCOUNT_ID`
4. `DOCUSIGN_OAUTH_HOST` (`account-d.docusign.com` → `account.docusign.com`)
5. `DOCUSIGN_PRIVATE_KEY`

`DOCUSIGN_BASE_PATH` does not change (auto-discovered).

`DOCUSIGN_WEBHOOK_SECRET` may or may not change depending on whether
you generate a fresh secret when configuring the production Connect
listener. If you re-use the demo secret, leave it alone.

The full operational walkthrough (consent, Connect config, Render
deployment order) lives in
[`docusign-go-live-checklist.md`](./docusign-go-live-checklist.md).

### Private-key handling

The code in `server/docusign/auth.js` accepts either:

- A real multi-line PEM, e.g.

  ```env
  DOCUSIGN_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
  MIIE...
  -----END RSA PRIVATE KEY-----"
  ```

- A single-line PEM with literal `\n` sequences (Render dashboard input):

  ```env
  DOCUSIGN_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----
  ```

Both are normalised before being passed to the SDK.

## One-time consent

DocuSign requires the impersonated user (`DOCUSIGN_USER_ID`) to grant
consent **once** for the integration's RSA-signed JWT. If you ever see
`consent_required` from `getAccessToken()`, open the URL the error
message contains while logged in as that user and click **Accept**.

Generating the consent URL by hand:

```
https://{OAUTH_HOST}/oauth/auth?response_type=code
  &scope=signature%20impersonation
  &client_id={INTEGRATION_KEY}
  &redirect_uri=https://www.docusign.com
```

Replace `{OAUTH_HOST}` with `account-d.docusign.com` (demo) or
`account.docusign.com` (prod). Any registered redirect URI works — we
only need the user to land on the Accept screen; the redirect code
itself is never exchanged.

## Connect webhook configuration

In DocuSign Admin: **Settings → Integrations → Connect → Add
Configuration → Custom**.

| Setting               | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| Name                  | `Exceed Props — Lease events`                                         |
| URL to publish to     | `https://exceed-properties.onrender.com/api/webhooks/docusign`        |
| Sign Message Data     | **HMAC** (paste the same value as `DOCUSIGN_WEBHOOK_SECRET`)          |
| Data Format           | **REST v2.1** (JSON)                                                  |
| Include Documents     | optional (heavier payload)                                            |
| Envelope Events       | tick **Envelope sent**, **Envelope completed**, **Envelope declined**, **Envelope voided** |
| Recipient Events      | tick **Recipient completed** (and Sent/Declined if you want them too) |

The webhook receiver (`server/routes/webhooks.js`) verifies any
`X-DocuSign-Signature-N` header against `DOCUSIGN_WEBHOOK_SECRET` with
HMAC-SHA256 of the raw body. Invalid signatures → 401. Valid →
`200 {ok:true}` is returned **immediately**, and processing happens
out-of-band so a slow DB write can't trigger DocuSign retries.

Events handled today (logged + persisted to the `webhookEvents` table):

- `envelope-completed`
- `envelope-declined`
- `envelope-voided`
- `recipient-completed`

There's a `TODO(lease-pipeline)` block in `webhooks.js` showing where
lease-record updates should hook in.

## Anchor strings (free-form PDFs)

`sendLeaseForSignature` places tabs by **anchor string**, not by
absolute coordinates. The lease PDF must contain these two markers in
white size-1 text:

| Anchor   | What it places          |
| -------- | ----------------------- |
| `/sig1/` | Signature field         |
| `/date1/` | Date-signed field (auto-filled) |

Render them in the source template (Word, Google Docs, …) at the exact
positions you want DocuSign to place the field. White-on-white at 1pt
keeps them invisible in the final document but DocuSign still finds
them. Multiple instances are fine (each one becomes a separate tab).

When using `sendLeaseFromTemplate` you skip anchors entirely —
positioning is whatever you set up inside the DocuSign template.

## Demo → production switchover

Follow [`docusign-go-live-checklist.md`](./docusign-go-live-checklist.md)
end-to-end. It walks through generating the demo API traffic DocuSign
requires (≥20 calls / ≥5 method types), submitting the Go-Live review,
creating prod credentials, granting prod consent, configuring the prod
Connect webhook, switching the Render env vars, and verifying.

Two scripts support the API-traffic generation phase:

- `scripts/docusign-smoke-test.js` — one run, six API method types,
  <30 seconds. Sends one envelope to `TEST_RECIPIENT_EMAIL`.
- `scripts/docusign-generate-golive-traffic.js` — runs the smoke test
  five times in sequence. One full pass = 30 successful API calls
  across 6 method types, well over DocuSign's bar.

Both honour `TEST_RECIPIENT_EMAIL` and `TEST_RECIPIENT_NAME` env vars;
use an inbox you control. The base path discovery (above) means **the
same scripts work against demo or prod** — only the env vars decide
which account they hit.

## Troubleshooting

| Error                                          | Likely cause / fix |
| ---------------------------------------------- | ------------------ |
| `consent_required`                             | The user hasn't granted JWT consent yet. Open the consent URL in the error message and click Accept. One-time. |
| `invalid_grant`                                | Almost always one of: (1) `DOCUSIGN_USER_ID` doesn't match the API user GUID, (2) integration key / private key mismatch, (3) wrong `DOCUSIGN_OAUTH_HOST` for the env (demo creds against prod host or vice versa), (4) server clock skew > a couple of minutes. |
| `USER_LACKS_PERMISSIONS`                       | The impersonated user doesn't have envelope-send rights on the account. Fix in DocuSign Admin: Users → User → Permission profile. |
| `INVALID_TAB_POSITION` / `TAB_REFERENCES_MISSING_DOCUMENT` | Your PDF doesn't actually contain the anchor strings. Open it in a text-search-capable viewer and search for `/sig1/` literally. |
| `ENVELOPE_DOES_NOT_EXIST_IN_SYSTEM`            | You're calling production endpoints with a demo envelope ID (or vice versa). Check `DOCUSIGN_BASE_PATH`. |
| `Invalid signature` (401 from `/api/webhooks/docusign`) | `DOCUSIGN_WEBHOOK_SECRET` doesn't match the value pasted into Connect, or something in front of the server (proxy, body parser) is mutating the bytes before they reach `express.raw()`. Check that no other middleware runs before the route. |
| `req.body` undefined in webhook handler        | The webhook route is mounted **after** the global `express.json()`. Re-check `server/server.js` — `app.use('/api/webhooks', webhookPublicRouter)` must come BEFORE `app.use(express.json(...))`. |

## Smoke test

```sh
node scripts/test-docusign-auth.js
```

Prints a config summary (redacted) and either ✅ with the token tail or
❌ with the failure cause. Run this first when:

- Adding a new env var
- Rotating the private key
- Switching demo ↔ prod
- After a server clock issue

## A note on the legacy OAuth client UI

The SPA (`src/App.jsx`) still contains a "Connect DocuSign" integration
card from when this was per-user OAuth (`PropertyInspectIntegrationCard`'s
neighbour). With JWT it can either be:

1. **Removed** — there's nothing for the user to connect; the system
   account is configured via env vars.
2. **Repurposed** — show a read-only "DocuSign: configured ✓" status
   tile that pings `/api/docusign/envelopes/<known-id>` (or a new
   `/api/docusign/health`) to confirm auth is working.

Option 2 is friendlier. Either way, the old `proxy.docusignExchangeCode`
/ `docusignCreateEnvelope` / `docusignGetEnvelope` helpers have been
removed from `src/lib/api.js` — any reference to them in `App.jsx` will
fail at runtime and needs to be replaced with the new helpers
(`docusignSendLease` etc.) or deleted.
