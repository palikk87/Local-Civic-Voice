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
          },
        },
      ],
      "@babel/plugin-proposal-export-namespace-from",
      "react-native-reanimated/plugin",
    ],
  };
};
