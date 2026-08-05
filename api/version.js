// Single source of truth for the app version.
// Bump this on every release; the PWA shows an "update available" banner when the
// served version differs from what the client last cached, and the service worker
// cache key is derived from it so clients auto-refresh to the new build.
module.exports = { VERSION: "0.3.0" };
