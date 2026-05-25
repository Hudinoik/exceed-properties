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

| Variable                     | Required | Default                                  | Notes |
| ---------------------------- | -------- | ---------------------------------------- | ----- |
| `DOCUSIGN_INTEGRATION_KEY`   | yes      | —                                        | a.k.a. Client ID; from Apps & Keys. |
| `DOCUSIGN_USER_ID`           | yes      | —                                        | API user GUID (Users → User → API Username). |
| `DOCUSIGN_ACCOUNT_ID`        | yes      | —                                        | Account ID (Apps & Keys). |
| `DOCUSIGN_OAUTH_HOST`        | no       | `account-d.docusign.com`                 | `account.docusign.com` for prod. |
| `DOCUSIGN_BASE_PATH`         | no       | `https://demo.docusign.net/restapi`      | For prod, use the per-account base URI from `/oauth/userinfo`. |
| `DOCUSIGN_PRIVATE_KEY`       | yes      | —                                        | RSA PEM. Multi-line in `.env` (wrap in `"…"`), or single-line with `\n` for Render. |
| `DOCUSIGN_WEBHOOK_SECRET`    | yes (for Connect) | —                                | Shared secret used by DocuSign Connect HMAC. |

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

1. **Re-grant consent** against production:

   ```
   https://account.docusign.com/oauth/auth?response_type=code
     &scope=signature%20impersonation
     &client_id={PROD_INTEGRATION_KEY}
     &redirect_uri=https://www.docusign.com
   ```

2. **Submit Go-Live review** in DocuSign Admin (Apps & Keys → your
   integration → Actions → Start Promotion). Anthropic-side, this is
   gated on at least 20 successful demo API calls in the last 30 days.

3. **Flip env vars**:

   ```env
   DOCUSIGN_OAUTH_HOST=account.docusign.com
   # Discover the prod base URI by calling https://account.docusign.com/oauth/userinfo
   # with a prod access token; use the matching `base_uri/restapi` value.
   DOCUSIGN_BASE_PATH=https://na2.docusign.net/restapi   # example
   DOCUSIGN_INTEGRATION_KEY=<prod key — usually same as demo>
   DOCUSIGN_USER_ID=<prod user GUID>
   DOCUSIGN_ACCOUNT_ID=<prod account ID>
   DOCUSIGN_PRIVATE_KEY=<prod RSA private key>
   ```

4. **Update the Connect listener URL** in the prod DocuSign Admin to
   point at `https://exceed-properties.onrender.com/api/webhooks/docusign`.

5. **Run `scripts/test-docusign-auth.js`** against the new env vars
   before anything tries to send envelopes.

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
