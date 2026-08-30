import { createAuthClient } from "better-auth/react";
import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import { BACKEND_URL } from "@/lib/config";

// Web-only auth client.
// Metro automatically picks this `.web.ts` file over `auth-client.ts` when
// bundling for the browser. The Expo client plugin (@better-auth/expo/client)
// is mobile-only — it relies on expo-secure-store and a deep-link scheme — so
// we omit it here. In the browser, Better Auth stores the session in an
// HTTP cookie that the browser sends automatically on every request that uses
// `credentials: "include"`.

// Same profile fields the native client declares, for the same reason: the
// server sends them on every session and neither client used to say so, which
// made reading `username` off a session a type error. Metro picks one of these
// two files per platform, so they have to agree.
const sessionProfileFields = {
  user: {
    username: { type: "string", required: false },
    displayUsername: { type: "string", required: false },
    bio: { type: "string", required: false },
    location: { type: "string", required: false },
    role: { type: "string", required: false },
  },
} as const;

const client = createAuthClient({
  baseURL: BACKEND_URL,
  plugins: [emailOTPClient(), inferAdditionalFields(sessionProfileFields)],
});

// The Expo plugin adds `getCookie()` so native code can inject the stored
// session token as a header. On web there is no stored token (the browser
// owns the cookie), so we expose a no-op that keeps shared code — notably
// src/lib/api/api.ts — working identically across platforms.
export const authClient = Object.assign(client, {
  getCookie: () => "",
});
