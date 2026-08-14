import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { emailOTPClient } from "better-auth/client/plugins";
import type { BetterAuthClientPlugin } from "better-auth/client";
import * as SecureStore from "expo-secure-store";
import { BACKEND_URL } from "@/lib/config";

/**
 * `@better-auth/expo`'s client plugin declares
 *
 *     getActions($fetch, $store)
 *
 * while better-auth 1.6's `BetterAuthClientPlugin` expects
 *
 *     getActions($fetch, $store, options)
 *
 * The arity mismatch is a type-level regression in the 1.6 line — present in
 * both 1.6.24 and 1.6.27 — and it is harmless at runtime, because an extra
 * argument to a JS function is simply ignored.
 *
 * It has to be cast rather than ignored, though: `plugins` is a heterogeneous
 * tuple, so one element failing to satisfy the constraint collapses inference
 * for the whole client. That is what previously erased `emailOtp` and
 * `getCookie` from `authClient`, three errors away from their actual cause.
 *
 * Casting only this plugin keeps `emailOTPClient()`'s actions inferred normally.
 * Revisit when the upstream signature is fixed.
 */
const expoPlugin = expoClient({
  // Must stay in lockstep with `expo.scheme` in app.json and with APP_SCHEMES on
  // the backend, which feeds Better Auth's trustedOrigins. If those three ever
  // disagree the deep-link auth callback fails silently in new builds — no
  // error, the app simply never completes sign-in.
  scheme: "civicvoice",
  storagePrefix: "civic",
  storage: SecureStore,
}) as unknown as BetterAuthClientPlugin;

const client = createAuthClient({
  baseURL: BACKEND_URL,
  plugins: [expoPlugin, emailOTPClient()],
});

/**
 * `getCookie` is contributed by the expo plugin's actions, which the cast above
 * hides. It is re-declared here so `lib/api/api.ts` keeps a typed call. The web
 * build supplies its own no-op in `auth-client.web.ts`.
 */
export const authClient = client as typeof client & { getCookie: () => string };
