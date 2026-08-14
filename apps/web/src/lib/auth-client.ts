import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
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
export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  plugins: [emailOTPClient()],
});

export const { useSession, signOut } = authClient;
