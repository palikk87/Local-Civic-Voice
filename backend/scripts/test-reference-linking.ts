/**
 * Integration checks for canonical reference linking on post creation.
 *
 *   bun scripts/test-reference-linking.ts
 *
 * Exercises the real HTTP endpoint against the running dev server so the Zod
 * schema, resolver, and database write are all covered. Test posts are removed
 * afterwards.
 */

import { prisma } from "../src/prisma";
import { resolveReferenceId, selectReferenceInput } from "../src/services/reference-resolver";

const BASE = process.env.BACKEND_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
const createdPostIds: string[] = [];
const createdRefIds: string[] = [];
const createdUserEmails: string[] = [];
const createdMediaIds: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Register a throwaway user and return its session cookie.
 *
 * Signing up avoids depending on any seeded account's password. The user is
 * deleted in the cleanup step.
 */
async function signUp(): Promise<string | null> {
  const email = `ref-linking-test-${process.pid}@example.com`;

  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "TestPassword123!",
      name: "Reference Linking Test",
    }),
  });

  if (!res.ok) {
    console.log(`  sign-up failed: ${res.status} ${await res.text().catch(() => "")}`);
    return null;
  }

  createdUserEmails.push(email);

  const cookie = res.headers.get("set-cookie");
  return cookie ? (cookie.split(";")[0] ?? null) : null;
}

async function createPost(cookie: string, body: unknown) {
  const res = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { post?: { id: string; governmentReferenceId?: string | null } } | null;
  if (json?.post?.id) createdPostIds.push(json.post.id);
  return { status: res.status, json };
}

async function main() {
  console.log("Reference linking checks\n");

  // ---------- Pure unit checks (no server needed) ----------
  console.log("Input selection:");
  const conflict = selectReferenceInput({ governmentReferenceId: "a", referenceId: "b" });
  check("conflicting new + legacy ids are rejected", !conflict.ok);

  const preferNew = selectReferenceInput({ governmentReferenceId: "a", referenceId: "a" });
  check("matching new + legacy ids are accepted", preferNew.ok && preferNew.value === "a");

  const legacyOnly = selectReferenceInput({ referenceId: "legacy-id" });
  check(
    "legacy-only id is accepted and flagged",
    legacyOnly.ok && legacyOnly.value === "legacy-id" && legacyOnly.usedLegacyField
  );

  console.log("\nResolver:");
  const mockValue = await resolveReferenceId("hr-82");
  check(
    'mock picker value "hr-82" is rejected as a database id',
    !mockValue.ok && mockValue.reason === "not_found"
  );

  const bogus = await resolveReferenceId("does-not-exist");
  check("nonexistent id is rejected", !bogus.ok && bogus.reason === "not_found");

  // Merge redirection: build a tombstone pointing at a live reference.
  const target = await prisma.governmentReference.findFirst({
    where: { referenceType: "bill", mergedIntoId: null },
    select: { id: true, masterReferenceId: true },
  });

  if (!target) {
    check("merge redirect fixture available", false, "no active bill reference to merge into");
  } else {
    const tombstone = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `test-tombstone-${target.masterReferenceId}`,
        referenceType: "bill",
        title: "Test tombstone",
        status: "introduced",
        mergedIntoId: target.id,
      },
      select: { id: true },
    });
    createdRefIds.push(tombstone.id);

    const redirected = await resolveReferenceId(tombstone.id);
    check(
      "merged source resolves to the active target",
      redirected.ok && redirected.reference.id === target.id
    );
  }

  // ---------- HTTP checks ----------
  const cookie = await signUp();

  if (!cookie) {
    console.log("\nHTTP checks: SKIPPED (could not create a test session)");
    failed++;
  } else {
    console.log("\nPost creation:");
    const ref = await prisma.governmentReference.findFirst({
      where: { referenceType: "bill", mergedIntoId: null },
      select: { id: true, referenceType: true, title: true },
    });

    if (!ref) {
      check("reference fixture available", false, "no active bill reference");
    } else {
      const ok = await createPost(cookie, {
        content: "Test post via governmentReferenceId",
        governmentReferenceId: ref.id,
      });
      check(
        "valid reference creates a linked post",
        ok.status === 201 && ok.json?.post?.governmentReferenceId === ref.id,
        `status ${ok.status}, link ${ok.json?.post?.governmentReferenceId ?? "null"}`
      );

      const legacy = await createPost(cookie, {
        content: "Test post via legacy referenceId",
        referenceType: ref.referenceType,
        referenceId: ref.id,
        referenceTitle: ref.title,
      });
      check(
        "legacy referenceId still links correctly",
        legacy.status === 201 && legacy.json?.post?.governmentReferenceId === ref.id,
        `status ${legacy.status}`
      );

      const mismatch = await createPost(cookie, {
        content: "Test post with conflicting ids",
        governmentReferenceId: ref.id,
        referenceId: "some-other-id",
      });
      check("conflicting ids are rejected with 400", mismatch.status === 400, `status ${mismatch.status}`);

      const fake = await createPost(cookie, {
        content: "Test post with a mock reference",
        referenceType: "bill",
        referenceId: "hr-82",
        referenceTitle: "Social Security Fairness Act",
      });
      check("mock reference value is rejected with 404", fake.status === 404, `status ${fake.status}`);

      const missing = await createPost(cookie, { content: "Test post with no reference" });
      check("missing reference is rejected with 400", missing.status === 400, `status ${missing.status}`);

      // The composers let a user post text OR media, so the schema must accept a
      // media-only post while still rejecting a post that is empty both ways.
      const empty = await createPost(cookie, {
        content: "   ",
        governmentReferenceId: ref.id,
      });
      check("post with no text and no media is rejected with 400", empty.status === 400, `status ${empty.status}`);

      const testUser = await prisma.user.findUnique({
        where: { email: createdUserEmails[0] ?? "" },
        select: { id: true },
      });

      if (!testUser) {
        check("media fixture available", false, "test user not found");
      } else {
        const media = await prisma.media.create({
          data: {
            userId: testUser.id,
            type: "image",
            url: "https://example.com/reference-linking-test.png",
            mimeType: "image/png",
            sizeBytes: 1024,
          },
          select: { id: true },
        });
        createdMediaIds.push(media.id);

        const mediaOnly = await createPost(cookie, {
          content: "",
          governmentReferenceId: ref.id,
          mediaIds: [media.id],
        });
        check(
          "media-only post is accepted and linked",
          mediaOnly.status === 201 && mediaOnly.json?.post?.governmentReferenceId === ref.id,
          `status ${mediaOnly.status}`
        );
      }

      // ---------- One pulse for many posts ----------
      console.log("\nShared pulse:");
      const before = await prisma.post.count({ where: { governmentReferenceId: ref.id } });

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createPost(cookie, {
            content: `Concurrent test post ${i + 1}`,
            governmentReferenceId: ref.id,
          })
        )
      );

      check(
        "five concurrent posts all succeed",
        results.every((r) => r.status === 201),
        results.map((r) => r.status).join(",")
      );
      check(
        "all five point at the same reference",
        results.every((r) => r.json?.post?.governmentReferenceId === ref.id)
      );

      const after = await prisma.post.count({ where: { governmentReferenceId: ref.id } });
      check("reference post count grew by exactly five", after === before + 5, `${before} -> ${after}`);

      const listed = await fetch(`${BASE}/api/government-references/${ref.id}/posts?limit=50`);
      const listedJson = (await listed.json()) as { posts?: unknown[] };
      check(
        "the reference's own posts endpoint returns them",
        (listedJson.posts?.length ?? 0) >= 5,
        `${listedJson.posts?.length ?? 0} post(s)`
      );
    }

    console.log("\nMerge guard:");
    const mergeRes = await fetch(`${BASE}/api/government-references/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ sourceId: "a", targetId: "b" }),
    });
    check(
      "non-admin cannot merge references",
      mergeRes.status === 403,
      `status ${mergeRes.status}`
    );
  }

  // ---------- No post left unlinked ----------
  console.log("\nData integrity:");
  const unlinked = await prisma.post.count({ where: { governmentReferenceId: null } });
  check("no post is missing its canonical reference", unlinked === 0, `${unlinked} unlinked`);

  const pointingAtTombstone = await prisma.post.count({
    where: { governmentReference: { mergedIntoId: { not: null } } },
  });
  check("no post points at a merged reference", pointingAtTombstone === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Test run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Media first: an upload that never got attached to a post would otherwise
    // survive the post cleanup.
    if (createdMediaIds.length > 0) {
      await prisma.media.deleteMany({ where: { id: { in: createdMediaIds } } });
    }
    if (createdPostIds.length > 0) {
      await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } });
    }
    if (createdRefIds.length > 0) {
      await prisma.governmentReference.deleteMany({ where: { id: { in: createdRefIds } } });
    }
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    console.log(
      `\nCleaned up ${createdPostIds.length} test post(s), ${createdRefIds.length} test reference(s), ` +
        `and ${createdUserEmails.length} test user(s).`
    );
    await prisma.$disconnect();
  });
