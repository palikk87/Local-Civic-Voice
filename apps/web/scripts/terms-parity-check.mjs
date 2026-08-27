/**
 * The web and mobile Terms of Use say exactly the same thing.
 *
 * The two apps share no package, so the terms content is a copy in each:
 *   apps/web/src/lib/legal/terms.ts
 *   apps/mobile/src/lib/terms.ts
 * A copy drifts. This fails the build the moment they differ in anything that
 * reaches a reader — the version, the effective date, or a single word of any
 * section — so "mirror" is enforced rather than hoped for.
 *
 *   bun run terms-parity-check
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const webPath = join(root, "apps/web/src/lib/legal/terms.ts");
const mobilePath = join(root, "apps/mobile/src/lib/terms.ts");

/**
 * The content that reaches a reader, isolated from the comments and paths that
 * legitimately differ between the two files.
 *
 * Everything from the first `export const TERMS_VERSION` onward is the data:
 * the version, the date, the jurisdiction/contact constants, and the sections.
 * The header comment above it is where the two are allowed to differ (one says
 * "page", the other "screen"), so it is excluded.
 */
function content(path) {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("export const TERMS_VERSION");
  if (start < 0) throw new Error(`${path} has no TERMS_VERSION`);
  return text.slice(start).trim();
}

const web = content(webPath);
const mobile = content(mobilePath);

if (web === mobile) {
  console.log("ok  the web and mobile Terms of Use are identical");
  process.exit(0);
}

// Show the first line that differs, so a drift is obvious rather than a wall.
const w = web.split("\n");
const m = mobile.split("\n");
const max = Math.max(w.length, m.length);
let firstDiff = -1;
for (let i = 0; i < max; i += 1) {
  if (w[i] !== m[i]) {
    firstDiff = i;
    break;
  }
}

console.error("FAIL the web and mobile Terms of Use have drifted apart.");
if (firstDiff >= 0) {
  console.error(`  first difference around line ${firstDiff + 1} of the content:`);
  console.error(`    web:    ${JSON.stringify((w[firstDiff] ?? "(missing)").trim()).slice(0, 160)}`);
  console.error(`    mobile: ${JSON.stringify((m[firstDiff] ?? "(missing)").trim()).slice(0, 160)}`);
}
process.exit(1);
