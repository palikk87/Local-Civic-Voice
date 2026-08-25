/**
 * Record real congress.gov responses so the matchmaker can be tested against
 * them forever, without a key and without the network.
 *
 * The matchmaker's whole job is deciding which government relationships are
 * strong enough to merge two records without a person looking. That decision is
 * worth testing, and testing it against invented JSON proves only that the code
 * agrees with my idea of what congress.gov returns. So this fetches the real
 * thing once, and the tests replay it.
 *
 * The recorded files contain no credential — the key rides in the query string
 * of the request, never in the response — and this script strips the URL before
 * writing, so nothing sensitive lands in the repository.
 *
 *   CONGRESS_API_KEY=... bun scripts/record-lineage-fixtures.ts
 *
 * Re-run it when congress.gov changes its response shape, or to add a bill.
 * Committing the output is deliberate: a test that reaches the network is a
 * test that fails when the network does, and rate-limits CI against a key
 * search depends on.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../src/env";

const FIXTURE_DIR = join(import.meta.dir, "..", "tests", "fixtures", "congress");

/**
 * The bills recorded, and why each one is here.
 *
 * Every case the matchmaker has to get right needs a real example, including
 * the ones where the right answer is "do nothing".
 */
const SUBJECTS: Array<{ id: string; congress: number; type: string; number: string; why: string }> = [
  {
    id: "hr-3194-119",
    congress: 119,
    type: "hr",
    number: "3194",
    why: "LOCOMOTIVES Act. CRS records s-1779-119 as an Identical bill from both directions — the one relationship strong enough to merge without a person.",
  },
  {
    id: "s-1779-119",
    congress: 119,
    type: "s",
    number: "1779",
    why: "The Senate half of the same pair, so the auto-merge can be proven symmetric.",
  },
  {
    id: "hr-7744-119",
    congress: 119,
    type: "hr",
    number: "7744",
    why: "DHS appropriations. Many published relationships, none of them Identical — the case that must go to the queue rather than merge.",
  },
  {
    id: "hr-1-119",
    congress: 119,
    type: "hr",
    number: "1",
    why: "A high-traffic bill with a long relationship list, including Related bills that must never become candidates.",
  },
];

async function main(): Promise<void> {
  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) {
    console.error(
      "CONGRESS_API_KEY is not set. Get one free at https://api.congress.gov/sign-up/ and\n" +
        "run: CONGRESS_API_KEY=... bun scripts/record-lineage-fixtures.ts",
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(FIXTURE_DIR, { recursive: true });

  for (const subject of SUBJECTS) {
    const url =
      `https://api.congress.gov/v3/bill/${subject.congress}/${subject.type}/${subject.number}` +
      `/relatedbills?format=json&limit=250&api_key=${apiKey}`;

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      console.error(`  ${subject.id}: HTTP ${response.status} — skipped`);
      continue;
    }

    const body = (await response.json()) as { request?: unknown; relatedBills?: unknown[] };

    // congress.gov echoes the request back, including the key it was called
    // with. Drop it before anything is written to disk.
    delete body.request;

    const path = join(FIXTURE_DIR, `relatedbills-${subject.id}.json`);
    await writeFile(
      path,
      JSON.stringify({ recordedFor: subject.id, why: subject.why, body }, null, 2) + "\n",
    );

    console.log(`  ${subject.id}: ${(body.relatedBills ?? []).length} related bill(s) -> ${path}`);

    // congress.gov allows 1,000 requests an hour on a signed key. Four requests
    // is nothing, but pacing them keeps this honest if the list grows.
    await Bun.sleep(400);
  }

  console.log("\nDone. Commit the fixtures — the tests replay them offline.");
}

await main();
