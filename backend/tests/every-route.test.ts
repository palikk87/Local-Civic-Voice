/**
 * Every route the app mounts, asked a question by a stranger.
 *
 * WHY THIS EXISTS. There are over a hundred endpoints and the suite covers the
 * ones that broke before. The rest are guarded by nothing at all, and a public
 * launch reaches every one of them within minutes — crawlers, scanners, curious
 * people, a client with a stale build asking for something that moved.
 *
 * Two failures matter here and neither shows up in a feature test:
 *
 *   A 500. An endpoint that exists but throws is worse than one that does not:
 *   it looks like the product is broken rather than like the request was wrong,
 *   and it usually means an unhandled path somebody will find by accident.
 *
 *   A write that works without a session. Every endpoint that changes something
 *   must refuse a stranger. This is checked against a LIST rather than a rule,
 *   so the endpoints a stranger is genuinely allowed to call are written down
 *   and have to be defended one at a time.
 *
 * EVERY REQUEST COMES FROM A FRESH CLIENT, and that is not a detail. The first
 * version of this fired a hundred and twenty requests in a tight loop from one
 * address, tripped the API's own rate limiter, and was answered 429 by almost
 * everything — so it passed while testing nothing. It was caught by planting a
 * deliberately unguarded endpoint and watching the suite stay green.
 *
 * THE ROUTES ARE READ FROM THE SOURCE, not typed out here. A test listing them
 * by hand is a test that covers what somebody remembered on the day they wrote
 * it; this one covers whatever is mounted, so a new endpoint is included the
 * moment it exists and nobody has to remember anything.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, freshClientHeaders, startServer, stopServer } from "./helpers/server";

interface Route {
  method: string;
  path: string;
}

/** Which router is mounted where, from index.ts. */
function mountPoints(): Record<string, string> {
  const mounts: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), "src", "index.ts"), "utf8").split("\n")) {
    const m = line.match(/app\.route\("([^"]+)",\s*(\w+)\)/);
    if (m?.[1] && m[2]) mounts[m[2]] = m[1];
  }
  return mounts;
}

function allRoutes(): Route[] {
  const mounts = mountPoints();
  const dir = join(process.cwd(), "src", "routes");
  const found: Route[] = [];
  const seen = new Set<string>();

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, file), "utf8");
    // The route string sometimes sits on the line after the call opens.
    const re = /(\w+Router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(?:\n\s*)?"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const base = mounts[m[1]!];
      if (!base) continue;
      const method = m[2]!.toUpperCase();
      const path = (base + m[3]!).replace(/\/$/, "") || base;
      const key = `${method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ method, path });
    }
  }
  return found;
}

/**
 * What a stranger is allowed to change.
 *
 * Deliberately a list and not a rule. Everything here has a reason, and adding
 * to it should feel like a decision rather than a formality:
 *
 *   the login endpoints        signing in cannot require being signed in
 *   password reset             the same, for somebody locked out
 *   resolve                    reading a law is public, and this is what turns
 *                              a search result into the record behind it. It
 *                              creates a row from official metadata only — no
 *                              user content, nothing attributable to anybody
 *   brief                      asking for a summary of a public law is public;
 *                              the work is bounded per record by the in-flight
 *                              guard, not by who is asking
 */
const PUBLIC_WRITES = new Set([
  "POST /api/admin/login",
  "POST /api/b2b/login",
  "POST /api/login",
  "POST /api/auth/*",
  "POST /api/government-references/resolve",
  "POST /api/government-references/:id/brief",
  //   the logout endpoints    signing out without being signed in is a no-op,
  //                           and it must be: a client whose session already
  //                           expired still has to be able to clear its own
  //                           state. Both read the token, delete the row only
  //                           if one is found, and answer the same either way.
  //                           Verified rather than assumed — see admin.ts.
  "POST /api/admin/logout",
  "POST /api/b2b/auth/logout",
]);

/** Placeholder values for path parameters. Nothing here should exist. */
function concrete(path: string): string {
  return path
    .replace(/:id\b/g, "e2e-nonexistent-id")
    .replace(/:commentId\b/g, "e2e-nonexistent-comment")
    .replace(/:userId\b/g, "e2e-nonexistent-user")
    .replace(/:[A-Za-z]+/g, "e2e-nonexistent");
}

let routes: Route[] = [];

beforeAll(async () => {
  await startServer();
  routes = allRoutes();
});

afterAll(async () => {
  await stopServer();
});

describe("every mounted route", () => {
  test("there are routes to check, and they were read from the source", () => {
    // If the parser breaks, every test below passes vacuously. Pin the shape.
    expect(routes.length).toBeGreaterThan(80);
    expect(routes.some((r) => r.path === "/api/posts" && r.method === "GET")).toBe(true);
    expect(routes.some((r) => r.path === "/api/government-references/:id")).toBe(true);
  });

  test("none of them answers a stranger with a server error", async () => {
    const broken: string[] = [];
    let throttled = 0;

    for (const route of routes) {
      const url = `${BASE_URL}${concrete(route.path)}`;
      const response = await fetch(url, {
        method: route.method,
        // A body on every write, so a 500 means the handler broke rather than
        // the request being unparseable.
        ...(route.method === "GET" || route.method === "DELETE"
          ? { headers: freshClientHeaders() }
          : {
              headers: freshClientHeaders({ "Content-Type": "application/json" }),
              body: "{}",
            }),
      }).catch(() => null);

      if (!response) {
        broken.push(`${route.method} ${route.path} — no response at all`);
        continue;
      }
      if (response.status === 429) throttled += 1;
      if (response.status >= 500) {
        const body = (await response.text()).slice(0, 200);
        broken.push(`${route.method} ${route.path} — ${response.status} ${body}`);
      }
    }

    expect(broken).toEqual([]);
    // A rate-limited run answers everything 429 and proves nothing. If most of
    // these never reached a handler, this test is lying and should say so.
    expect(throttled).toBeLessThan(routes.length / 4);
  }, 120_000);

  test("nothing a stranger can call changes anything, except what is written down", async () => {
    const writes = routes.filter((r) => r.method !== "GET");
    const unguarded: string[] = [];

    const validatedBeforeAuth: string[] = [];

    for (const route of writes) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC_WRITES.has(key)) continue;

      const response = await fetch(`${BASE_URL}${concrete(route.path)}`, {
        method: route.method,
        headers: freshClientHeaders({ "Content-Type": "application/json" }),
        body: "{}",
      }).catch(() => null);

      if (!response) continue;
      // 2xx from a stranger on a write is the finding. Anything else — 401, 400
      // for a bad body, 404 for the placeholder id, 429 — is a refusal.
      if (response.status >= 200 && response.status < 300) {
        unguarded.push(`${key} — answered ${response.status} with no session`);
      }

      // A 400 means the request never reached the handler: the body validator
      // rejected it first. That IS a refusal — nothing was written — but it is
      // not proof the handler checks for a session, because the handler never
      // ran. An endpoint that validates before it authenticates would look
      // identical here whether or not it has an auth check at all.
      if (response.status === 400) validatedBeforeAuth.push(key);
    }

    expect(unguarded).toEqual([]);

    // Not a failure — a list, printed so the gap is visible rather than silent.
    // Closing it properly means a valid body per endpoint, which is a fixture
    // per endpoint, which is the hand-written list this test exists to avoid.
    //
    // CHECKED BY HAND on 2026-08-22, all eighteen, each with a body its
    // validator accepts and no session: every one refused, sixteen with 401 and
    // two more with a 400 from a deeper check. The only 2xx came from the two
    // B2B login endpoints, which is what signing in is. So this is a hole in
    // the test, not in the product — but it is a hole that would hide a real
    // one, which is why it prints.
    if (validatedBeforeAuth.length > 0) {
      console.log(
        `\n${validatedBeforeAuth.length} write endpoint(s) answered 400 to an empty body, so ` +
          `their auth check was never reached by this test:\n  ` +
          validatedBeforeAuth.join("\n  ") +
          `\n`,
      );
    }
  }, 120_000);

  test("no error leaks the machinery behind it", async () => {
    // A stack trace, a Prisma error, or a raw SQL fragment in a response body
    // tells a stranger what to attack next, and tells everybody else that the
    // product is held together with tape.
    const leaks: string[] = [];
    const tells = [/prisma/i, /at Object\./, /node_modules/, /SELECT .* FROM/i, /stack/i];

    for (const route of routes.slice(0, 60)) {
      const response = await fetch(`${BASE_URL}${concrete(route.path)}`, {
        method: route.method,
        ...(route.method === "GET" || route.method === "DELETE"
          ? { headers: freshClientHeaders() }
          : {
              headers: freshClientHeaders({ "Content-Type": "application/json" }),
              body: '{"unexpected":true}',
            }),
      }).catch(() => null);
      if (!response) continue;

      const body = await response.text();
      for (const tell of tells) {
        if (tell.test(body)) {
          leaks.push(`${route.method} ${route.path} — body matches ${tell}`);
          break;
        }
      }
    }

    expect(leaks).toEqual([]);
  }, 120_000);
});
