import { createAuthClient } from "better-auth/react";
import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import { AUTH_BASE_URL } from "./config";

/**
 * Civic Speak's auth client.
 *
 * emailOTPClient is what makes password reset reachable from the browser. The
 * backend has always implemented the flow (auth.ts, emailOTP) and the mobile app
 * has always used it, but this client omitted the plugin — so web had no reset
 * path at all, and the same account could recover its password on a phone and
 * not in a browser.
 */
/**
 * THE PROFILE FIELDS THE SERVER ALREADY SENDS.
 *
 * backend/src/auth.ts declares these under `user.additionalFields`, so every
 * session response carries them. Neither client told Better Auth that, so the
 * inferred session user had only Better Auth's built-ins on it — `username`
 * typechecked as an error even though the value was right there in the payload.
 *
 * The cost was not theoretical: the account-closing screen asks a person to type
 * their own username to confirm, reads it from the session to show them which
 * one, and would not compile. Declared once here and shared by both clients so
 * the two cannot drift, which is the same reason the fields live on the server
 * in the first place.
 */
export const sessionProfileFields = {
  user: {
    username: { type: "string", required: false },
    displayUsername: { type: "string", required: false },
    bio: { type: "string", required: false },
    location: { type: "string", required: false },
    role: { type: "string", required: false },
  },
} as const;

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  plugins: [emailOTPClient(), inferAdditionalFields(sessionProfileFields)],
});

export const { useSession, signOut } = authClient;
