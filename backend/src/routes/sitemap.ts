/**
 * THE LIST OF PAGES WE ARE ASKING GOOGLE TO INDEX.
 *
 * Served live rather than written to a file at build time, so a record that
 * earns its listing at three in the morning — because somebody asked for its
 * brief, or fifty people voted on it — is in the sitemap at three in the
 * morning, with nobody deciding anything and nothing to redeploy.
 *
 * WHAT IS IN IT is decided by services/findable.ts, one rule, evaluated fresh
 * on every request. Read that file for why most records are not in here yet.
 *
 * It is one small query answered a handful of times a day, so it costs
 * essentially nothing and needs no cache beyond the header below.
 */
import { Hono } from "hono";

import { prisma } from "../prisma";
import { isFindable } from "../services/findable";
import { attributionFor } from "../services/reference-attribution";

export const sitemapRouter = new Hono();

/** The public site, taken from the origins already configured for CORS. */
function siteOrigin(): string {
  const first = (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    // www is a redirect target, not the canonical host.
    .filter((o) => !o.includes("://www."))[0];
  return (first ?? "https://ayeandnay.com").replace(/\/+$/, "");
}

/** Where a record lives, by branch. Mirrors the web app's routes. */
function pathFor(referenceType: string, slug: string): string {
  if (referenceType === "executive_order") return `/executive-order/${slug}`;
  if (referenceType === "scotus_case") return `/scotus/${slug}`;
  return `/bill/${slug}`;
}

/** The pages that exist regardless of what is in the database. */
const STATIC_PATHS = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/library", priority: "0.8", changefreq: "daily" },
  { path: "/discover", priority: "0.8", changefreq: "daily" },
  { path: "/government", priority: "0.7", changefreq: "weekly" },
  { path: "/constitution", priority: "0.6", changefreq: "yearly" },
  { path: "/bill-of-rights", priority: "0.6", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

sitemapRouter.get("/", async (c) => {
  const origin = siteOrigin();

  // Only records that could possibly qualify are read: a slug is the one hard
  // requirement, and a merged record is not a page of its own.
  const rows = await prisma.governmentReference.findMany({
    where: { slug: { not: null }, mergedIntoId: null },
    select: {
      slug: true,
      referenceType: true,
      citizenBrief: true,
      description: true,
      supportVotes: true,
      opposeVotes: true,
      updatedAt: true,
      lawChangedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const records = rows.filter((row) => isFindable(row));

  const urls = [
    ...STATIC_PATHS.map(
      (entry) =>
        `  <url>\n    <loc>${xmlEscape(origin + entry.path)}</loc>\n` +
        `    <changefreq>${entry.changefreq}</changefreq>\n` +
        `    <priority>${entry.priority}</priority>\n  </url>`,
    ),
    ...records.map((row) => {
      const loc = xmlEscape(origin + pathFor(row.referenceType, row.slug!));
      // When the law itself last moved, falling back to when we last touched
      // the row. Claiming a page changed today when it did not is the kind of
      // thing a sitemap is trusted not to do.
      const changed = (row.lawChangedAt ?? row.updatedAt).toISOString().slice(0, 10);
      return (
        `  <url>\n    <loc>${loc}</loc>\n` +
        `    <lastmod>${changed}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.7</priority>\n  </url>`
      );
    }),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls.join("\n")}\n</urlset>\n`;

  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

/**
 * The same set as JSON, for the build's prerender step and for anybody
 * checking why a record is or is not listed.
 */
sitemapRouter.get("/records", async (c) => {
  const rows = await prisma.governmentReference.findMany({
    where: { slug: { not: null }, mergedIntoId: null },
    select: {
      id: true,
      slug: true,
      referenceType: true,
      title: true,
      shortTitle: true,
      description: true,
      citizenBrief: true,
      supportVotes: true,
      opposeVotes: true,
      signedDate: true,
      decidedDate: true,
      introducedDate: true,
      updatedAt: true,
      // Who is behind the record. The share card draws them, and it must name
      // the same person the page names — so it is computed by the same function
      // the detail endpoint uses rather than assembled a second time here.
      sponsorName: true,
      sponsorBioguideId: true,
      sponsorPhotoUrl: true,
      sponsorParty: true,
      sponsorState: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return c.json({
    records: rows
      .filter((row) => isFindable(row))
      .map((row) => ({
        ...row,
        path: pathFor(row.referenceType, row.slug!),
        attribution: attributionFor(row),
      })),
  });
});
