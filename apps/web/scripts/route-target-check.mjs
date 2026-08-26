/**
 * Every place the app sends somebody must be a place the app mounts.
 *
 *   bun run route-target-check
 *
 * WHY THIS EXISTS. Three times in one week a working feature looked broken
 * because the redirect after it pointed at a path that is not a route:
 *
 *   - the compose dialog sent a message successfully, then navigated to
 *     /messages/<id> when the thread route is /conversation/:id. React Router
 *     fell through to the catch-all and rendered Not Found, so the sender saw a
 *     404 and reasonably concluded messaging was broken. The message had
 *     already been delivered.
 *   - a profile's Positions count linked to /record?user=<id> after /record had
 *     become a redirect back to that same profile.
 *
 * A WRONG REDIRECT AFTER A SUCCESSFUL WRITE IS WORSE THAN A FAILED WRITE,
 * because the person retries something that already happened.
 *
 * Nothing else catches this. It is not a type error — every one of these is a
 * perfectly good string. It is not a render error — the page that renders is
 * NotFound, which renders fine. It is not caught by every-page-check, which
 * visits the routes that EXIST rather than the ones the code aims at. The only
 * way to see it is to compare the two lists, which is all this does.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const SRC = "src";

/** The routes the app actually mounts, from the one place they are declared. */
async function mountedRoutes() {
  const app = await readFile(join(SRC, "App.tsx"), "utf8");
  return [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");
}

/**
 * Does this destination match this route, segment by segment?
 *
 * Two kinds of unknown, and both are permissive on purpose:
 *
 *   - a ROUTE segment starting with ":" is a parameter and matches anything;
 *   - a DESTINATION segment of "\u0000" is a template hole — `${id}`, or a
 *     computed branch like `${BRANCH_OF[type].route}` — and we cannot know what
 *     it will be, so it matches anything too.
 *
 * That second rule is why this reports nothing for the digest cards, whose
 * first segment is computed to "bill" | "executive-order" | "scotus". Guessing
 * would mean inventing a fact about a value the compiler has and this script
 * does not, and a check that cries wolf gets switched off.
 *
 * It still catches the bug it was written for: "/messages/${id}" has a LITERAL
 * first segment, and no mounted route begins with "messages" followed by a
 * parameter, so it fails.
 */
const HOLE = "\u0000";

function matches(destination, route) {
  const d = destination.split("/");
  const r = route.split("/");
  if (d.length !== r.length) return false;
  return d.every((segment, i) => {
    const routeSegment = r[i];
    if (routeSegment.startsWith(":")) return true;
    if (segment === HOLE) return true;
    return segment === routeSegment;
  });
}

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(path);
  }
  return found;
}

/**
 * Every internal destination the code names.
 *
 * Both spellings that actually move somebody: navigate("/x") and to="/x" /
 * to={`/x/${id}`}. Template holes become a single segment, because that is what
 * an id is. Anything that is not a literal starting with "/" is skipped rather
 * than guessed at — a computed path is not something a regex should have an
 * opinion about.
 */
const PATTERNS = [
  /\bnavigate\(\s*["'`](\/[^"'`]*)["'`]/g,
  /\bto=\{?\s*["'`](\/[^"'`]*)["'`]/g,
  /\bhref=["'`](\/[^"'`]*)["'`]/g,
];

function destinationsIn(source) {
  const found = [];
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      let path = match[1];
      // Drop query and hash: routing matches on the path.
      path = path.split("?")[0].split("#")[0];
      // A template hole is one segment we cannot know the value of.
      path = path.replace(/\$\{[^}]*\}/g, HOLE);
      if (!path.startsWith("/")) continue;
      // Trailing slash is the same route.
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      found.push({ path, raw: match[1] });
    }
  }
  return found;
}

const routes = await mountedRoutes();
const files = await sourceFiles(SRC);

const failures = [];
let checked = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const { path, raw } of destinationsIn(source)) {
    checked++;
    if (routes.some((route) => matches(path, route))) continue;
    failures.push({ file, raw, path });
  }
}

console.log(`${routes.length} routes mounted, ${checked} internal destinations checked.`);

if (failures.length > 0) {
  console.error(`\n${failures.length} destination(s) point at no route:\n`);
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(
      `    "${f.raw}"  ->  ${f.path.replaceAll(HOLE, "<value>")}  (falls through to NotFound)`,
    );
  }
  console.error(
    `\nEither add the route to App.tsx, or send people somewhere that exists.\n` +
      `Mounted routes:\n${routes.map((r) => `  ${r}`).join("\n")}`,
  );
  process.exit(1);
}

console.log("Every place the app sends somebody is a place the app mounts.");
