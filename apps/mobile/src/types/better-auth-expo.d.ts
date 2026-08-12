// Ambient type declaration for the concrete Expo client file path.
//
// auth-client.ts imports "@better-auth/expo/dist/client.js" directly (see the
// note there: metro.config.js rewrites better-auth ".cjs" imports to ".mjs",
// which breaks the package's "@better-auth/expo/client" subpath). TypeScript
// resolves types through the package's "exports" map, which does not expose the
// "./dist/client.js" subpath, so we forward the types from the public subpath.
declare module "@better-auth/expo/dist/client.js" {
  export * from "@better-auth/expo/client";
}
