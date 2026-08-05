// App configuration.
// For the hackathon MVP this points at the local mock backend.
// Later, set API_BASE to your deployed Azure Function URL.
window.APP_CONFIG = {
  // When served from the same origin as the backend, leave empty ("").
  // When running the PWA separately, set to e.g. "http://192.168.1.20:7071".
  API_BASE: "",

  // ---- Real Microsoft (Entra) sign-in via MSAL ----
  // Fill CLIENT_ID after creating an Entra app registration (see docs/AUTH-SETUP.md).
  // While CLIENT_ID is empty, the app uses a demo sign-in so it still runs with
  // zero setup. When set, a real Microsoft sign-in prompt is shown.
  AUTH: {
    CLIENT_ID: "",          // <-- paste your Entra app (client) ID here
    TENANT: "common",        // "common" = any work/school account (incl. external/guest)
    SCOPES: ["User.Read"],   // proves identity in the client
    // Azure DevOps resource scope — lets the app call ADO AS THE USER.
    ADO_SCOPES: ["499b84ac-1321-427f-aa17-267ca6975798/.default"],
  },
};
