# Setup & Run — PR Copilot for Leads

This is the hackathon MVP: a **mobile-first PWA** + a **mock Node.js backend**.
It runs **with no Azure subscription and no ADO access** — using built-in mock data —
so all three of us can build and demo it immediately. We wire real Azure DevOps +
Azure OpenAI in later (see "Going live" below).

---

## Prerequisites (one-time)

- **Node.js 18+** — https://nodejs.org (LTS). Check: `node -v`
- That's it. No other installs, no accounts.

---

## Run it (laptop)

```powershell
cd api
npm start
```

Then open **http://localhost:3000** in your browser. You'll see the PR inbox with
mock data — tap a PR, view the AI summary, the clean diff, and approve/reject/comment.

> The backend serves the PWA too, so there's only **one thing to run**.

---

## Open it on your phone (iPhone or Android)

1. Make sure your phone and laptop are on the **same Wi-Fi**.
2. Find your laptop's IP:
   ```powershell
   (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' }).IPAddress
   ```
3. On your phone's browser, go to `http://<that-ip>:3000`.
4. **Install it (looks like a native app):**
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** menu → **Install app / Add to Home screen**.

Now it launches full-screen with its own icon — a real app experience, no App Store.

---

## Project structure

```
pr-copilot-for-leads/
├─ app/                 PWA front-end (mobile-first, vanilla HTML/CSS/JS)
│  ├─ index.html        inbox · detail · diff · actions
│  ├─ styles.css
│  ├─ app.js            calls the backend
│  ├─ config.js         API base URL
│  ├─ manifest.json     makes it installable
│  ├─ sw.js             service worker (offline shell)
│  └─ icons/            app icons
├─ api/                 Node.js backend
│  ├─ server.js         serves the PWA + JSON API
│  ├─ mock-data.js      fake PRs + AI responses (runs offline)
│  ├─ adoClient.js      STUB: real Azure DevOps REST calls
│  ├─ aiClient.js       STUB: real Azure OpenAI calls
│  └─ .env.example      config template for going live
└─ docs/SETUP.md        this file
```

---

## Who builds what (3 devs)

| Dev | Owns | Files |
|-----|------|-------|
| **Vinod** | Backend + Azure DevOps integration | `api/server.js`, `api/adoClient.js` |
| **Dev 2** | Mobile UI / UX polish | `app/*` (screens, styles, interactions) |
| **Dev 3** | AI layer + prechecks | `api/aiClient.js`, precheck logic in `server.js` |

Everyone can work at once against the mock — the API shape won't change.

---

## API shape (stable contract)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/prs` | list active PRs (inbox) |
| GET | `/api/prs/:id` | full PR detail (summary, checks, diff) |
| GET | `/api/prs/:id/summary` | AI summary + risk |
| GET | `/api/prs/:id/comment-draft` | AI-drafted comment |
| POST | `/api/prs/:id/approve` | approve |
| POST | `/api/prs/:id/reject` | request changes |
| POST | `/api/prs/:id/comment` | send comment `{ text }` |
| GET | `/api/health` | health check |

---

## Going live (post-mock)

1. **Azure DevOps:** copy `api/.env.example` → `api/.env`, set `ADO_ORG`, `ADO_PROJECT`,
   and a dev `ADO_PAT` (Code + Pull Request read/write). Wire `adoClient.js` into
   `server.js` (replace `listPRs()` / `getPR()`).
2. **Azure OpenAI:** set `AZURE_OPENAI_*` in `.env`, call `aiClient.analyzeDiff()` to
   replace the canned `summary` / `risk` / `commentDraft`.
3. **Auth (production):** replace the dev PAT with **Entra ID sign-in** (MSAL.js in the
   PWA) — the same pattern as the D365 Warehouse Management app: user signs in → token →
   backend calls ADO on their behalf. No secrets on the phone.

> Security: the `.env` and any PAT/keys stay **server-side only** and are git-ignored.
> Start against a **test ADO project**, read-only, before enabling writes.
