# DocuSign Go-Live Checklist

Everything that has to happen **outside the codebase** to move the
integration from demo to production. Work down the list — order matters.

This document complements `docs/docusign-integration.md` (which covers
env-var setup and code-level concepts). Cross-reference whenever a step
mentions code paths or env names.

---

## Phase A — Generate the required demo API traffic

DocuSign requires at least **20 successful API calls across at least 5
different method types** in your demo account before approving Go-Live.
The traffic generator script produces 30 calls across 6 method types in
one pass.

- [ ] Confirm the `.env` on your local machine is still pointed at
      demo:
      ```sh
      grep DOCUSIGN_OAUTH_HOST server/.env
      # expected: DOCUSIGN_OAUTH_HOST=account-d.docusign.com
      ```
- [ ] Confirm `node scripts/test-docusign-auth.js` still prints
      `✅ JWT auth succeeded.` (this also verifies the new
      `/oauth/userinfo` base-path discovery).
- [ ] Pick an email you actually control for receiving 5 test envelopes
      and either filter or auto-delete on receipt. Avoid an inbox
      anyone else monitors.
- [ ] Run the traffic generator:
      ```sh
      TEST_RECIPIENT_EMAIL=you@yourdomain.com \
        node scripts/docusign-generate-golive-traffic.js
      ```
- [ ] Confirm the final line reads `5/5 runs succeeded` and `Total
      successful calls: 30 across 6 method types.`
- [ ] Open the demo DocuSign Admin → **API and Keys** → click the
      integration → scroll to the **API Activity** / **API Request Logging**
      panel. You should see ≥30 successful 2xx calls across createEnvelope,
      getEnvelope, listRecipients, listDocuments, listStatusChanges, and
      getDocument. If not, re-run the generator.

## Phase B — Submit the Go-Live review

- [ ] DocuSign Admin (demo) → **Apps and Keys** → your integration →
      **Actions** menu → **Start Promotion**.
- [ ] Confirm the integration shows ≥20 successful API calls across ≥5
      method types in the last 30 days. If the page still says you're
      below, run Phase A again — DocuSign re-reads the metric on each
      Promotion attempt.
- [ ] Pick the production account you're promoting **into**. (If you
      have only one prod account, there's no choice.)
- [ ] Submit. DocuSign emails the integration owner within a few hours
      (sometimes minutes); a human reviews it.

**Wait for the approval email before continuing to Phase C.**

## Phase C — Create production credentials

After the email arrives:

- [ ] Log in to **production DocuSign** at
      <https://account.docusign.com>.
- [ ] Switch to the **organisation/account you promoted into**. (The
      account ID is visible in the top-right user menu.)
- [ ] Admin → **Apps and Keys** → your integration should now show
      "Production" alongside "Demo". Note these values:
   - [ ] **Integration Key** — usually the same GUID as demo, but verify.
   - [ ] **Account ID** — the production account's GUID (DIFFERS from demo).
- [ ] **Generate a new RSA keypair for production**. Click "Add Secret
      Key" → "RSA Keypair" → download the private key. Do not reuse the
      demo private key — even though DocuSign won't reject it, key
      hygiene says one keypair per environment.
- [ ] In **Users**, find or create the API user the integration will
      impersonate in prod. Copy their **API Username** GUID — this is
      your prod `DOCUSIGN_USER_ID` (DIFFERS from demo).
- [ ] Confirm that user has **Send Envelope** permission in their
      permission profile (Permission Profiles → click the profile →
      Sending settings).

## Phase D — Grant production consent

JWT impersonation requires the API user to have granted consent in the
production environment. This is separate from demo consent.

- [ ] Build the production consent URL (substitute `{PROD_KEY}` with
      the production Integration Key):
      ```
      https://account.docusign.com/oauth/auth?response_type=code
        &scope=signature%20impersonation
        &client_id={PROD_KEY}
        &redirect_uri=https://www.docusign.com
      ```
- [ ] Log in to production DocuSign **as the API user from Phase C**,
      then open the URL above.
- [ ] Click **Accept**. You'll be redirected somewhere (the
      `redirect_uri` you used). Ignore it — the click was the whole
      point.

If you don't do this, the first prod API call will return
`consent_required`.

## Phase E — Create production Connect webhook

- [ ] Production DocuSign Admin → **Settings → Integrations → Connect →
      Add Configuration → Custom**.
- [ ] Fill in:
   - Name: `Exceed Props — Lease events (prod)`
   - URL to publish to: `https://exceed-properties.onrender.com/api/webhooks/docusign`
   - **Sign Message Data**: pick **HMAC**, click **Add Secret**, copy
     the generated secret. **Save this — you'll set it as
     `DOCUSIGN_WEBHOOK_SECRET` in Phase F.** It can be the same value
     as demo if you want (no security benefit either way; the demo
     secret cannot validate prod traffic regardless).
   - **Data Format**: REST v2.1 (JSON)
   - **Envelope Events**: Sent, Completed, Declined, Voided
   - **Recipient Events**: Completed
- [ ] Save the configuration.
- [ ] **Leave the demo Connect configuration in place** — you can
      keep both, and the demo one won't fire after the env vars switch
      since you'll no longer be sending demo envelopes.

## Phase F — Switch Render env vars to production

Do this **all in one go**. The dyno restarts on any env change, so a
partial switch leaves the server in a broken state for a few minutes
between saves. Render lets you edit multiple vars and apply once.

Open Render → exceed-properties service → **Environment** tab. Edit
these five vars (in any order, then save once):

- [ ] `DOCUSIGN_INTEGRATION_KEY` → production Integration Key
- [ ] `DOCUSIGN_USER_ID` → production API user GUID
- [ ] `DOCUSIGN_ACCOUNT_ID` → production Account ID GUID
- [ ] `DOCUSIGN_OAUTH_HOST` → **`account.docusign.com`** (no `-d`)
- [ ] `DOCUSIGN_PRIVATE_KEY` → production RSA PEM (single-line with
      `\n` between PEM lines)

You **do not** need to touch:
- [ ] `DOCUSIGN_BASE_PATH` — auto-discovered now via `/oauth/userinfo`.
      Leave the old demo value in place as a harmless fallback, or
      blank it out.

You **may** need to update:
- [ ] `DOCUSIGN_WEBHOOK_SECRET` → only if you chose a new HMAC secret
      in Phase E. Otherwise keep the demo value.

Click **Save Changes**. Render redeploys (~2–3 minutes).

## Phase G — Verify production

- [ ] Open Render → exceed-properties → **Logs** tab. After redeploy,
      look for:
      ```
      [docusign] environment: PRODUCTION (oauth host=account.docusign.com, base path auto-discovered)
      ```
      If you see `DEMO` instead, the env var save didn't take —
      retry Phase F.
- [ ] Open `https://exceed-properties.onrender.com/api/health` —
      should return `{"ok":true}`.
- [ ] Production smoke test from your local machine (still has your
      old demo `.env`, so a remote test is safer than overwriting
      local creds):
   - [ ] Log in to the live SPA as yourself.
   - [ ] DevTools → Console:
         ```js
         const r = await (await fetch('/api/docusign/envelopes', {
           credentials: 'include',
           headers: { 'X-CSRF-Token': document.cookie.split('ep.csrf=')[1].split(';')[0] },
         })).json();
         console.log(r);
         ```
         Should return `{ results: { ... } }` with the prod
         account's envelope list (probably empty initially).
- [ ] Send one real production envelope to yourself via the SPA. Sign
      it. Confirm:
   - [ ] The email comes from your DocuSign production account (not
         demo — check the sender domain).
   - [ ] After signing, the webhook fires. In Render Logs:
         `[webhook] DocuSign recipient-completed envelope=...` and
         `envelope-completed` shortly after.
- [ ] Optional: visit `/api/webhooks/docusign/events` while logged in
      to confirm the event was recorded.

## Phase H — Cleanup

- [ ] If your `server/.env` (local) still has demo creds, decide
      whether to:
      - [ ] Leave as-is for local dev (safest — you can do dry runs
            without touching prod).
      - [ ] Switch to prod creds locally (more realistic but risky —
            an accidental smoke test would send real envelopes).
- [ ] Update any incident-response runbook or onboarding doc that
      still says "demo".
- [ ] Make sure the production Connect webhook URL matches the live
      Render host. Re-check after any DNS or platform change.

---

## Rollback (if something is broken after Phase F)

If production behaviour is wrong and you need to get back to demo
quickly:

- [ ] Render → Environment → set `DOCUSIGN_OAUTH_HOST` back to
      `account-d.docusign.com` and restore the four other vars to
      their demo values. (Keep them in a password-manager note.)
- [ ] Confirm the Render Logs banner reverts to `DOCUSIGN: DEMO`
      after redeploy.

Cache implication: the in-memory token cache in `server/docusign/auth.js`
holds the previous token + base path for up to 55 minutes. A redeploy
resets it. If you somehow change env vars **without** redeploying, the
next request will refresh the token and re-discover the base path on
its own — but the safe path is "always redeploy after a DocuSign env
change."
