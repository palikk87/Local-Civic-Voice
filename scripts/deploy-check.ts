/**
 * Is the code on main actually the code that is running?
 *
 *   bun scripts/deploy-check.ts
 *
 * THE FAILURE THIS EXISTS FOR. A fix gets written, reviewed, tested green and
 * pushed — to a branch nothing deploys. The repository is correct and the
 * product is unchanged, and from outside those two states look exactly the
 * same. The only thing that exposed it was using the feature by hand and seeing
 * the old behaviour, which works for a delete button and does not work for
 * anything on the server that nobody clicks. A migration that never ran, a
 * cache fix that never shipped, a matchmaker that never swept: all silent.
 *
 * So both deployed apps now say which commit they are, and this compares them
 * to what is on main. Three answers, and only one of them is good:
 *
 *   LIVE     — running exactly what is on main
 *   BEHIND   — a real commit, but an older one; a deploy is pending or failed
 *   UNKNOWN  — the build carried no stamp, so it cannot be trusted either way
 *
 * Reads the URLs from the environment so no address is hardcoded:
 *
 *   CHECK_API_URL   https://your-api.up.railway.app
 *   CHECK_WEB_URL   https://your-site.vercel.app
 *
 * Or pass them: bun scripts/deploy-check.ts <api-url> <web-url>
 */

import { execSync } from "node:child_process";

const API_URL = process.argv[2] ?? process.env.CHECK_API_URL ?? "";
const WEB_URL = process.argv[3] ?? process.env.CHECK_WEB_URL ?? "";

if (!API_URL && !WEB_URL) {
  console.error(
    "Nothing to check. Set CHECK_API_URL and CHECK_WEB_URL, or pass them as arguments:\n" +
      "  bun scripts/deploy-check.ts https://your-api.up.railway.app https://your-site.vercel.app\n\n" +
      "Both live in .env.example. They are addresses, not secrets.",
  );
  process.exit(1);
}

/** What main is, from the remote rather than the local checkout. */
function expectedCommit(): string {
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" });
  } catch {
    // Offline, or no remote. The local ref is still a useful comparison.
  }
  try {
    return execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();
  } catch {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`  request failed: HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error(`  request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const short = (sha: string) => (sha === "unknown" ? "unknown" : sha.slice(0, 8));

/** How far behind, in commits, and what is missing. */
function commitsMissing(deployed: string): string[] {
  try {
    return execSync(`git log --oneline ${deployed}..origin/main`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const expected = expectedCommit();
console.log(`main is at ${short(expected)}\n`);

let anyProblem = false;
let schemaProblem = false;

async function check(label: string, url: string, read: () => Promise<string | null>) {
  if (!url) {
    console.log(`${label.padEnd(4)}  not checked — no URL configured`);
    return;
  }

  console.log(`${label.padEnd(4)}  ${url}`);
  const deployed = await read();

  if (deployed === null) {
    console.log(`      UNREACHABLE — could not ask it what it is running\n`);
    anyProblem = true;
    return;
  }
  if (deployed === "unknown" || !deployed) {
    console.log(
      `      UNKNOWN — this build carries no commit stamp, so it cannot confirm what it is.\n` +
        `      Rebuild it; the stamp comes from the Dockerfile ARG (API) or the\n` +
        `      version-stamp plugin (web).\n`,
    );
    anyProblem = true;
    return;
  }
  if (deployed === expected) {
    console.log(`      LIVE — running ${short(deployed)}, which is main\n`);
    return;
  }

  const missing = commitsMissing(deployed);
  console.log(`      BEHIND — running ${short(deployed)}, main is ${short(expected)}`);
  if (missing.length > 0) {
    console.log(`      ${missing.length} commit(s) on main are not deployed:`);
    for (const line of missing.slice(0, 10)) console.log(`        ${line}`);
    if (missing.length > 10) console.log(`        ... and ${missing.length - 10} more`);
  }
  console.log("");
  anyProblem = true;
}

await check("API", API_URL, async () => {
  const body = await fetchJson(`${API_URL.replace(/\/$/, "")}/health`);
  if (!body) return null;

  // Reported alongside the commit because they fail independently: the right
  // code can be running against an older schema, and that combination looks
  // healthy from everywhere except the endpoint that touches the missing
  // column.
  const schema = body.schema as
    | { inSync?: boolean; applied?: number; expected?: number; pending?: string[]; failed?: string[] }
    | undefined;
  if (schema && schema.inSync === false) {
    console.log(`      SCHEMA BEHIND — ${schema.applied ?? "?"} of ${schema.expected ?? "?"} migrations applied`);
    for (const name of schema.pending ?? []) console.log(`        pending: ${name}`);
    for (const name of schema.failed ?? []) console.log(`        FAILED:  ${name}`);
    anyProblem = true;
    schemaProblem = true;
  }

  const version = body.version as { commit?: string } | undefined;
  return version?.commit ?? "unknown";
});

await check("WEB", WEB_URL, async () => {
  const body = await fetchJson(`${WEB_URL.replace(/\/$/, "")}/version.json`);
  if (!body) return null;
  return (body.commit as string | undefined) ?? "unknown";
});

if (anyProblem) {
  console.error(
    schemaProblem
      ? "The database does not match the code that is running against it. Re-run the\n" +
          "deploy so `prisma migrate deploy` runs, and check its log — a migration that\n" +
          "failed leaves the API up and serving the wrong shape."
      : "Not everything on main is live. Nothing you built is reaching users until it is.",
  );
  process.exit(1);
}
console.log("Both deployments are running exactly what is on main, against a matching schema.");
