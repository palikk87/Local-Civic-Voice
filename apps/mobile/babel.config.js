const path = require("path");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind", unstable_transformImportMeta: true }],
      "nativewind/babel",
    ],
    plugins: [
      [
        "module-resolver",
        {
          // Only "@". The three better-auth aliases that used to live here
          // pointed at .cjs files none of those packages ship, and were
          // rescued by a .cjs->.mjs rewrite in metro.config.js — which then
          // failed for @better-auth/expo, whose dist is client.js. Both halves
          // are gone; the packages' own "exports" maps resolve correctly.
          //
          // "@/shared" was also declared here, before "@" could never match it:
          // module-resolver tries "@" first, so "@/shared/x" became
          // "./src/shared/x" and metro's handler never ran. Nothing imports it.
          alias: {
            "@": "./src",
            // Shared with apps/web. Absolute, because module-resolver resolves
            // relative aliases against the importing file, which would send
            // every nested import somewhere different.
            //
            // Declared AFTER "@" is fine — these prefixes do not overlap. The
            // old "@/shared" alias did overlap, which is why it never fired.
            "@civic/core": path.resolve(__dirname, "../../packages/civic-core/src"),
          },
        },
      ],
      "@babel/plugin-proposal-export-namespace-from",
      "react-native-reanimated/plugin",
    ],
  };
};
