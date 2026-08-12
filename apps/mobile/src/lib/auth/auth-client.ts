import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { emailOTPClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

const baseURL = (process.env.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL) || "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      scheme: "vibecode",
      storagePrefix: "civic",
      storage: SecureStore,
    }),
    emailOTPClient(),
  ],
});
