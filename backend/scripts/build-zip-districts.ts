/**
 * Rebuild the bundled ZIP -> district map from the Census Bureau.
 *
 *   bun run scripts/build-zip-districts.ts
 *
 * WHEN TO RUN THIS. Only when districts are redrawn and the Census Bureau
 * publishes a new relationship file — which is to say, after a census or a
 * court-ordered redistricting. The map does not drift between those events, so
 * fetching nine megabytes on a server boot would buy nothing and could fail.
 *
 * WHAT IT WRITES. src/data/zip-districts.ts: every ZIP Code Tabulation Area,
 * against the districts it overlaps, ordered by how much of the ZIP each one
 * covers. Nothing is interpreted and nothing is filled in — the ordering is the
 * file's own AREALAND_PART column, and a ZIP the file does not list simply is
 * not there.
 *
 * POINT IT AT A NEW FILE by passing the URL as the first argument, and update
 * BOUNDARY_VINTAGE in services/zip-districts.ts to match what you fetched. The
 * vintage is shown to people on the screen, so it has to be the truth about
 * this file rather than the truth about when the script was run.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRelationshipFile, CENSUS_SOURCE } from "../src/services/zip-districts";

const source = process.argv[2] ?? CENSUS_SOURCE;

const response = await fetch(source, { signal: AbortSignal.timeout(300_000) });
if (!response.ok) throw new Error(`census.gov answered ${response.status} for ${source}`);

const map = parseRelationshipFile(await response.text());
if (map.size < 30_000) {
  // The real file carries about thirty-four thousand ZIPs. Anything much
  // smaller is a truncated download or an error page, and writing half a map
  // would tell a lot of people their home is in no district at all.
  throw new Error(`that parsed to only ${map.size} ZIPs — refusing to write a half map`);
}

const table: Record<string, string[]> = {};
for (const zip of [...map.keys()].sort()) {
  table[zip] = map.get(zip)!.map((overlap) => overlap.districtId);
}

const file = `/**
 * ZIP Code Tabulation Area -> congressional district, from the Census Bureau.
 *
 * GENERATED. Do not edit by hand — run scripts/build-zip-districts.ts.
 *
 * Source: ${source}
 * Fetched: ${new Date().toISOString().slice(0, 10)}
 * ${map.size} ZIPs.
 *
 * Districts are listed with the one covering most of the ZIP first. A ZIP that
 * spans several is normal — about seventeen in every hundred do — which is why
 * this offers them all and the person picks.
 *
 * BUNDLED RATHER THAN FETCHED because it changes only when districts are
 * redrawn. Nothing here is offered to anybody without first being confirmed
 * against the live congress.gov roster; see services/zip-districts.ts.
 */

export const ZIP_TO_DISTRICTS: Record<string, string[]> = ${JSON.stringify(table, null, 0)};
`;

const out = join(import.meta.dir, "..", "src", "data", "zip-districts.ts");
writeFileSync(out, file);
console.log(`wrote ${map.size} ZIPs to ${out}`);
