# @civic/core

Code that both clients share, held in one place instead of two.

## Why this exists

`apps/web/src/lib/mobile/` was 35 files, ~15,000 lines, hand-copied from
`apps/mobile/src/lib/`. Eleven of them were still byte-for-byte identical to
their originals; the rest had already drifted. Drift is the whole problem — a
cache policy fixed on one platform and not the other, a `getTimeAgo` that
appends " ago" in one copy, a category list defined four different ways.

Nine of those eleven live here now — 4,095 lines. Neither app owns them; both
import them.

## What is in here, and what is not

Everything here is **pure, with zero third-party imports**. No React, no DOM,
no React Native, no storage adapters, no npm dependencies at all.

That is the admission criterion, and it is enforced by circumstance rather than
taste. `seen-bills-store.ts` was moved here and then moved back out: it imports
`zustand`, and this package sits outside both apps, so Node resolution walks up
from `packages/civic-core/` and never reaches the `zustand` in
`apps/web/node_modules`. The web build failed with

    Rollup failed to resolve import "zustand" from
    packages/civic-core/src/seen-bills-store.ts

Aliasing around that was possible in both bundlers. Leaving 78 lines duplicated
was better: it keeps this package dependency-free, which means it has no
`package.json`, no lockfile, no install step, and no way for the two apps to
end up compiling it against different versions of anything.

**So: a file qualifies only if it is byte-identical across both apps AND imports
nothing but its own siblings.** Anything needing `AsyncStorage` on one side and
`localStorage` on the other stays in the apps until someone writes a storage
shim.

Two byte-identical files are deliberately **not** here:

- `government-data.ts` (1,868 lines) imports `mock-data.ts`, which has diverged
  between the apps (1,494 vs 1,505 lines). Moving it means either dragging a
  diverged file along or resolving that divergence first.
- `seen-bills-store.ts` (78 lines), for the `zustand` reason above.

## How it is wired

Deliberately *not* a Bun workspace. Making these packages workspace members would
move `backend/bun.lock` to the repository root, and `backend/Dockerfile` copies
that lockfile by path — the API deploy would break. This is plain source,
resolved by each bundler's own alias:

| App | Mechanism |
|---|---|
| `apps/web` | `resolve.alias` in `vite.config.ts` |
| `apps/mobile` | `module-resolver` alias in `babel.config.js`, plus `watchFolders` in `metro.config.js` so Metro looks outside its project root |

The apps' original file paths still exist as one-line re-export shims
(`export * from '@civic/core/types'`), so the hundreds of existing
`@/lib/types` and `@/lib/mobile/types` imports keep working unchanged. Deleting
those shims means updating every import site, which is a mechanical follow-up,
not a prerequisite.

None of the ten files has a default export, which is what makes `export *`
sufficient.

## Adding to it

1. Confirm the file is identical in both apps (`diff` them).
2. Confirm it imports nothing platform-specific.
3. Move it here, leave shims behind in both apps.
4. Verify **both** bundlers, not just the typechecker:

   ```bash
   cd apps/web    && bun run build
   cd apps/mobile && bunx expo export --platform ios --clear
   ```

   TypeScript resolves through `tsconfig` paths and will happily pass while
   Metro or Vite fails to resolve the same import at bundle time.
