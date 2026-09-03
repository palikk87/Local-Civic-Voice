/**
 * A face is collected once, from whichever source has one, and kept.
 *
 * WHY THIS EXISTS. Every card and page built a congress.gov URL itself and
 * trusted it. Measured against all 244 people who have sponsored something on
 * this platform, that source has no photograph for four of them, and for Ron
 * Johnson it answers with 65,536 bytes beginning "\x00nod" — labelled
 * image/jpeg — every single time. A share card that tried to draw that died,
 * and the record lost its whole card rather than just its face.
 *
 * So it is asked LAST now, and a caller who already knows a URL is asked first.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma, startServer, stopServer } from "./helpers/server";

let mod: typeof import("../src/services/member-portraits");
const realFetch = globalThis.fetch;

/** Real JPEG and PNG signatures, padded past the size floor. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2000, 7),
]);
/** What congress.gov actually sends for J000293: not an image, and 64KB of it. */
const THE_CORRUPT_ANSWER = Buffer.concat([Buffer.from("\x00nod"), Buffer.alloc(65_532, 0)]);

/** Every User-Agent a source was asked with during a test. */
let identifiedAs: Array<string | undefined> = [];

function answerWith(byUrl: (url: string) => { status: number; body?: Buffer } | null) {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    identifiedAs.push(
      new Headers(init?.headers ?? {}).get("user-agent") ?? undefined,
    );
    const answer = byUrl(url);
    if (!answer) return new Response("no", { status: 404 });
    return new Response(answer.body ?? null, {
      status: answer.status,
      headers: { "content-type": "image/jpeg" },
    });
  }) as typeof fetch;
}

const forget = (id: string) =>
  prisma.memberPortrait.deleteMany({ where: { bioguideId: id } }).catch(() => undefined);

beforeAll(async () => {
  await startServer();
  mod = await import("../src/services/member-portraits");
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await prisma.memberPortrait.deleteMany({ where: { bioguideId: { startsWith: "Z" } } });
  await prisma.memberPortrait.deleteMany({ where: { bioguideId: "official-test-post" } });
  await stopServer();
});

describe("collecting a member's face", () => {
  test("THE SOURCE MEASURED FAILING IS ASKED LAST, NOT FIRST", async () => {
    // It used to be first, because it is the official one. Being official did
    // not stop it having no photograph for four sponsors and rubbish for a
    // fifth, and every one of those was a face nobody saw.
    await forget("Z000001");
    const asked: string[] = [];
    answerWith((url) => {
      asked.push(url);
      return { status: 200, body: JPEG };
    });

    const got = await mod.memberPortrait("Z000001");
    expect(got?.contentType).toBe("image/jpeg");
    expect(asked[0]).toContain("unitedstates");
    expect(mod.portraitSourcesFor("Z000001").at(-1)).toContain("bioguide.congress.gov");
  });

  test("A URL THE CALLER ALREADY KNOWS IS ASKED BEFORE ALL OF THEM", async () => {
    // The roster carries the photograph Congress.gov's own API names, and for
    // Darline Graham that is the ONLY place her face exists — the mirror 404s
    // and bioguide has nothing. A hint is not a nicety; it is the fifth gap.
    await forget("Z000006");
    const asked: string[] = [];
    answerWith((url) => {
      asked.push(url);
      return url.includes("example.test") ? { status: 200, body: PNG } : { status: 404 };
    });

    const got = await mod.memberPortrait("Z000006", "https://example.test/her-face.png");
    expect(got?.contentType).toBe("image/png");
    expect(asked[0]).toBe("https://example.test/her-face.png");
  });

  test("a public post has its recorded URL and nothing else", async () => {
    // There is no directory of cabinet photographs to guess at, so an official
    // is exactly one source: the URL data/federal-government records for them.
    expect(mod.portraitSourcesFor("official-potus", "https://example.test/p.jpg")).toEqual([
      "https://example.test/p.jpg",
    ]);
    expect(mod.portraitSourcesFor("official-potus")).toEqual([]);

    await forget("official-test-post");
    answerWith(() => ({ status: 200, body: JPEG }));
    const got = await mod.memberPortrait("official-test-post", "https://example.test/p.jpg");
    expect(got?.contentType).toBe("image/jpeg");
  });

  test("…and it is kept, so the next hundred cards ask nobody", async () => {
    await forget("Z000002");
    let calls = 0;
    answerWith(() => {
      calls += 1;
      return { status: 200, body: JPEG };
    });

    await mod.memberPortrait("Z000002");
    await mod.memberPortrait("Z000002");
    await mod.memberPortrait("Z000002");
    expect(calls).toBe(1);
  });

  test("A SOURCE THAT SENDS SOMETHING THAT IS NOT AN IMAGE IS PASSED OVER", async () => {
    // The real failure, reproduced: the official source answers 200, says
    // image/jpeg, and sends 64KB of bytes that are not a picture.
    await forget("Z000003");
    answerWith((url) =>
      url.includes("bioguide.congress.gov")
        ? { status: 200, body: THE_CORRUPT_ANSWER }
        : { status: 200, body: PNG },
    );

    const got = await mod.memberPortrait("Z000003");
    expect(got).not.toBeNull();
    // The mirror's real image won, not the official source's rubbish.
    expect(got?.contentType).toBe("image/png");
    const held = await prisma.memberPortrait.findUnique({ where: { bioguideId: "Z000003" } });
    expect(held?.source).toContain("unitedstates");
  });

  test("a source that is simply down is passed over too", async () => {
    await forget("Z000004");
    answerWith((url) =>
      url.includes("bioguide.congress.gov") ? { status: 503 } : { status: 200, body: JPEG },
    );
    expect(await mod.memberPortrait("Z000004")).not.toBeNull();
  });

  test("NOBODY HAS ONE IS A REAL ANSWER, AND IT IS REMEMBERED", async () => {
    await forget("Z000005");
    let calls = 0;
    answerWith(() => {
      calls += 1;
      return null;
    });

    expect(await mod.memberPortrait("Z000005")).toBeNull();
    const afterFirst = calls;
    // Every source was tried once. The second ask must not try them again —
    // that is what turned four missing faces into thousands of requests.
    expect(await mod.memberPortrait("Z000005")).toBeNull();
    expect(calls).toBe(afterFirst);
  });

  test("ADDING A SOURCE UN-REMEMBERS THE PEOPLE IT WOULD HAVE HELPED", async () => {
    // Remembering "nobody has one" is what stops four missing faces becoming
    // thousands of requests — and it is also what would have made adding a
    // source pointless, because the people a new source helps are exactly the
    // people already written off. Darline Graham is the real case: no
    // photograph at bioguide, none at the mirror, and the roster's own URL is
    // the only place hers exists.
    await forget("Z000007");
    answerWith(() => null);
    expect(await mod.memberPortrait("Z000007")).toBeNull();

    // The miss, as it was recorded — against the sources of the day.
    const missed = await prisma.memberPortrait.findUnique({ where: { bioguideId: "Z000007" } });
    expect(missed?.source).toBeTruthy();

    // Somebody adds a source. Rewrite the record to the shape a miss taken
    // before that change has, and ask again: it must go and look, today, not in
    // seven days.
    await prisma.memberPortrait.update({
      where: { bioguideId: "Z000007" },
      data: { source: "an older set of sources" },
    });
    answerWith((url) => (url.includes("example.test") ? { status: 200, body: JPEG } : null));

    const got = await mod.memberPortrait("Z000007", "https://example.test/found-at-last.jpg");
    expect(got?.contentType).toBe("image/jpeg");
  });

  test("A PHOTOGRAPH PUBLISHED AFTER WE GAVE UP IS PICKED UP AT ONCE", async () => {
    // Everton Blair was sworn in with no photograph anywhere, so we recorded a
    // miss. Days later Congress.gov published one — and a remembered miss would
    // have kept the only faceless person on the platform faceless for the rest
    // of the week. A new member is exactly who this happens to.
    await forget("Z000009");
    answerWith(() => null);
    expect(await mod.memberPortrait("Z000009")).toBeNull();

    // Nothing has changed: still no photograph, still no hint. Stays a miss,
    // and asks nobody.
    let calls = 0;
    answerWith(() => {
      calls += 1;
      return null;
    });
    expect(await mod.memberPortrait("Z000009")).toBeNull();
    expect(calls).toBe(0);

    // Now the source names a URL it did not have before. That is a different
    // question, so the old answer does not apply — today, not in seven days.
    answerWith((url) => (url.includes("published-today") ? { status: 200, body: JPEG } : null));
    const got = await mod.memberPortrait("Z000009", "https://example.test/published-today.jpg");
    expect(got?.contentType).toBe("image/jpeg");
  });

  test("WE SAY WHO WE ARE, BECAUSE ONE SOURCE ANSWERS 403 IF WE DO NOT", async () => {
    // Wikimedia's policy requires a descriptive User-Agent and it enforces it:
    // the URL that answers 200 to curl answers 403 to a request without one.
    // That is where Darline Graham's photograph lives, and where all thirty-six
    // cabinet and Supreme Court portraits live. Asking anonymously lost every
    // one of them, and the failure looked exactly like "nobody has a photo".
    await forget("Z000008");
    identifiedAs = [];
    answerWith(() => ({ status: 200, body: JPEG }));

    await mod.memberPortrait("Z000008", "https://upload.wikimedia.org/her-face.jpg");
    expect(identifiedAs.length).toBeGreaterThan(0);
    for (const agent of identifiedAs) {
      expect(agent, "a source was asked without saying who we are").toBeDefined();
      expect(agent).toContain("AyeAndNay");
    }
  });

  test("an id that is not an id never reaches a fetch or a query", async () => {
    let calls = 0;
    answerWith(() => {
      calls += 1;
      return { status: 200, body: JPEG };
    });
    for (const bad of ["../../etc/passwd", "Q22686", "", "A12345", "a123456", "official-"]) {
      expect(await mod.memberPortrait(bad)).toBeNull();
    }
    expect(calls).toBe(0);
  });

  test("the bytes decide what an image is, not the header", () => {
    expect(mod.imageKind(JPEG)).toBe("image/jpeg");
    expect(mod.imageKind(PNG)).toBe("image/png");
    expect(mod.imageKind(THE_CORRUPT_ANSWER)).toBeNull();
    expect(mod.imageKind(Buffer.alloc(20))).toBeNull();
  });
});
