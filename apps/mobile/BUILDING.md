# Building the Civic Voice app

Until now no binary could be produced from this repo at all — there was no
`eas.json`, and Expo's build service refuses to start without one. There is one
now, and this is how to use it.

Everything below runs against **Khalid's own Expo account**. Nothing here is tied
to any other account, and `eas.json` contains no project id, no bundle
credentials, and no hostnames.

## Verified

Both platforms bundle from this repo:

```
bunx expo export --platform ios       → 3,561 modules, 9.14 MB, exit 0
bunx expo export --platform android   → exit 0
```

That is worth stating because until now they did not — see the note at the
bottom of this file.

## One-time setup

1. Create an Expo account at [expo.dev](https://expo.dev) — free.
2. From `apps/mobile`:

   ```bash
   bunx eas-cli login
   bunx eas-cli init      # links this folder to a project on that account
   ```

   `init` writes `extra.eas.projectId` into `app.json`. That is an identifier for
   *his* account, so it is fine to commit — but it is also the one line to change
   if the project ever moves accounts.

## The API address

Expo inlines `EXPO_PUBLIC_*` into the JavaScript bundle **at build time**. A
build cannot be re-pointed at a different API afterwards, and a build made
without the variable throws at startup rather than sending requests to a
malformed URL.

It is deliberately not written into `eas.json`, because a hostname in the repo is
the thing that makes a codebase belong to one deployment. Set it as an EAS
environment variable instead — once per profile, stored on the Expo account:

```bash
bunx eas-cli env:create --name EXPO_PUBLIC_BACKEND_URL \
  --value https://your-api-host --environment preview
bunx eas-cli env:create --name EXPO_PUBLIC_BACKEND_URL \
  --value https://your-api-host --environment production
```

Or set them in the Expo dashboard under the project's **Environment variables**.

## Building

```bash
# A dev client you can run against a local server — install once, then `expo start`
bunx eas-cli build --profile development --platform ios

# An installable build for testers. Android produces a plain .apk you can sideload.
bunx eas-cli build --profile preview --platform android

# Store builds
bunx eas-cli build --profile production --platform all
```

`preview` on Android deliberately produces an `.apk` rather than an `.aab`,
because an `.apk` can be installed by downloading it and an `.aab` cannot.

## Before the first store submission

These are not needed for internal builds and will block a store review:

- **App icon and splash screen.** `app.json` declares neither, so Expo's default
  placeholder ships. Add `icon` (1024×1024, no transparency) and a `splash`
  config.
- **Privacy policy URL.** Both stores require one for an app with accounts.
- **Apple Developer Program** ($99/year) and **Google Play Console** ($25 once).
  Both must be Khalid's own accounts, enrolled under his own identity — store
  ownership is very hard to transfer later.
- **Deep links.** `app.json` sets `scheme: "civicvoice"`, so `civicvoice://…`
  already opens the app once installed. Universal links (an `https://` link
  opening the app instead of the browser) additionally need
  `ios.associatedDomains` and `android.intentFilters` here, plus
  `apple-app-site-association` and `assetlinks.json` served from the web app.

## The three identifiers that must agree

If these ever drift apart, sign-in on a real device fails silently — the app
never completes the callback, and nothing logs an error:

| Where | Value |
|---|---|
| `app.json` → `expo.scheme` | `civicvoice` |
| `src/lib/auth/auth-client.ts` → `expoClient({ scheme })` | `civicvoice` |
| Backend env → `APP_SCHEMES` | `civicvoice` |

---

## Why this could not build before

Bundling failed outright with:

```
Unable to resolve module ../../../node_modules/@better-auth/expo/dist/client.cjs
```

Two configs were fighting. `babel.config.js` aliased three better-auth imports
to explicit `.cjs` paths inside `node_modules`; `metro.config.js` then
intercepted anything containing "better-auth" that ended in `.cjs` and rewrote
it to `.mjs`.

Neither file existed for any of the three packages. It survived because
`better-auth` happens to ship `.mjs`, so the rewrite accidentally landed on a
real file. `@better-auth/expo` ships plain `client.js` — the alias pointed at a
file that does not exist, and the rewrite pointed at a different file that also
does not exist.

Both halves are deleted. Every one of those packages declares an `exports` map,
and Metro in SDK 54 honours it, so the plain specifier resolves correctly with
no help. If a future dependency bump appears to need an alias here, that is
almost always a stale lockfile rather than a genuine resolution problem —
check what the package actually ships in `dist/` before adding one back.
