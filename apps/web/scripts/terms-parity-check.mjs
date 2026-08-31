/**
 * The web and mobile legal notices say exactly the same thing.
 *
 * The two apps share no package, so each notice is a copy in each app:
 *   apps/web/src/lib/legal/terms.ts    apps/mobile/src/lib/terms.ts
 *   apps/web/src/lib/legal/privacy.ts  apps/mobile/src/lib/privacy.ts
 * A copy drifts. This fails the build the moment they differ in anything that
 * reaches a reader — the version, the effective date, or a single word of any
 * section — so "mirror" is enforced rather than hoped for.
 *
 * The Privacy Policy is checked the same way and for the same reason: it was
 * on the web and entirely absent from the phone, which is a worse drift than
 * any wording could be.
 *
 *   bun run terms-parity-check
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const NOTICES = [
  {
    what: "Terms of Use",
    marker: "export const TERMS_VERSION",
    web: join(root, "apps/web/src/lib/legal/terms.ts"),
    mobile: join(root, "apps/mobile/src/lib/terms.ts"),
  },
  {
    what: "Privacy Policy",
    marker: "export const PRIVACY_VERSION",
    web: join(root, "apps/web/src/lib/legal/privacy.ts"),
    mobile: join(root, "apps/mobile/src/lib/privacy.ts"),
  },
];

/**
 * The content that reaches a reader, isolated from the comments and paths that
 * legitimately differ between the two files.
 *
 * Everything from the first version constant onward is the data: the version,
 * the date, the jurisdiction/contact constants, and the sections. The header
 * comment above it is where the two are allowed to differ (one says "page",
 * the other "screen"), so it is excluded.
 */
function content(path, marker) {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`${path} has no ${marker}`);
  return text.slice(start).trim();
}

let failed = false;

for (const notice of NOTICES) {
  const web = content(notice.web, notice.marker);
  const mobile = content(notice.mobile, notice.marker);

  if (web === mobile) {
    console.log(`ok  the web and mobile ${notice.what} are identical`);
    continue;
  }

  failed = true;

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

  console.error(`FAIL the web and mobile ${notice.what} have drifted apart.`);
  if (firstDiff >= 0) {
    console.error(`  first difference around line ${firstDiff + 1} of the content:`);
    console.error(`    web:    ${JSON.stringify((w[firstDiff] ?? "(missing)").trim()).slice(0, 160)}`);
    console.error(`    mobile: ${JSON.stringify((m[firstDiff] ?? "(missing)").trim()).slice(0, 160)}`);
  }
}

process.exit(failed ? 1 : 0);
