import { createAuthClient } from "better-auth/react";

// Civic Voice uses email + password (matches the mobile app). No email codes / OTP.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BACKEND_URL || undefined,
});

export const { useSession, signOut } = authClient;
