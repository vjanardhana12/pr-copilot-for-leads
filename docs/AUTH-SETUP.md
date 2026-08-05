# Real sign-in + app-store install — setup guide

This covers the two things that make PR Copilot feel like a "real" app:
**(A) real Microsoft sign-in** and **(B) installing it like a store app**.

---

## A. Real Microsoft (Entra) sign-in

The app already has the sign-in code (MSAL). It uses a **demo identity** until you
give it an Entra **app registration** (client ID). Once configured, tapping
"Sign in with Microsoft" shows a **real Microsoft prompt** (with MFA, account picker,
and support for external/guest accounts like Carlsberg).

### One-time: create the app registration

**Portal (easiest):**
1. Go to <https://entra.microsoft.com> → **Applications → App registrations → New registration**.
2. Name: `PR Copilot for Leads`.
3. Supported account types: **Accounts in any organizational directory (multitenant)**
   — this lets you sign in with your Microsoft *and* Carlsberg guest account.
4. **Redirect URI** → platform **Single-page application (SPA)** → your app URL, e.g.
   - Local test: `http://localhost:3000/index.html`
   - Tunnel/deployed: `https://<your-host>/index.html`
5. **Register**. Copy the **Application (client) ID**.
6. **Authentication** → ensure the SPA redirect URIs above are listed. Enable
   **Access tokens** and **ID tokens** (implicit/hybrid) if prompted.
7. **API permissions** → Microsoft Graph → **User.Read** (delegated) is enough for
   identity. (Azure DevOps calls are made server-side, not from the phone.)

**CLI alternative:**
```powershell
az ad app create --display-name "PR Copilot for Leads" \
  --sign-in-audience AzureADMultipleOrgs \
  --web-redirect-uris "https://<your-host>/index.html"
# note the returned appId
```

### Configure the app
Open [app/config.js](../app/config.js) and set:
```js
AUTH: {
  CLIENT_ID: "<the Application (client) ID>",
  TENANT: "common",         // any work/school account (incl. Carlsberg guest)
  SCOPES: ["User.Read"],
}
```
Reload. "Sign in with Microsoft" now shows a real prompt.

> **Which account to pick:** for Carlsberg ADO, sign in with your **guest/partner
> account** (e.g. `HQKUMVIN@carlsberggroup.com`) — that's the identity ADO knows.
> The account picker (`prompt: select_account`) lets you choose.

> **Redirect URI must match the URL you open.** If you change host (tunnel → Azure),
> add that URL to the app registration's SPA redirect URIs.

---

## B. Installing it like a store app

There are two honest options.

### Option 1 — Install as a PWA (recommended, $0, works today)
This is how most modern web apps ship to phones without the store friction:
- **iPhone (Safari):** open the URL → **Share → Add to Home Screen**.
- **Android (Chrome):** open the URL → menu → **Install app**.

It gets its own icon, launches full-screen, works offline, and updates automatically.
Share it internally via the QR on `/install.html`. **For an internal Microsoft tool,
this is the right distribution model.**

### Option 2 — Publish to the actual App Store / Play Store
A PWA can't go into the stores directly — it must be wrapped in a thin native
shell. The standard, free tool for this is **PWABuilder** (a Microsoft project):

1. Deploy the app to a public HTTPS URL (see the Azure deploy step).
2. Go to <https://www.pwabuilder.com> and enter that URL.
3. It validates the PWA and generates store packages:
   - **Android** → a signed `.aab`/APK (Trusted Web Activity) for **Google Play**
     (needs a Google Play Developer account, ~$25 one-time).
   - **iOS** → an Xcode project for the **App Store**
     (needs an Apple Developer account, ~$99/yr, and a Mac to build/submit).
   - **Windows** → an MSIX for the Microsoft Store.

> **Reality check for an internal tool:** stores mean accounts, review, and ongoing
> maintenance. For Microsoft-internal distribution, the proper channel is
> **Intune / Company Portal**, not the public stores. Use PWABuilder only if this
> becomes an official external product.

**Recommendation:** ship as a **PWA** (Option 1) for the hackathon and internal use;
keep PWABuilder (Option 2) as the documented path if it graduates to a product.

---

## Order of operations to go fully "real"
1. **Deploy to Azure** → stable HTTPS URL (no tunnel warning).
2. Create the **Entra app registration** with that URL as the redirect.
3. Put the **client ID** in `config.js`.
4. Share the URL/QR → users **Add to Home Screen**.
5. (Optional) Run the URL through **PWABuilder** for store packages.
