/**
 * A member's face is collected once, from whichever source has one.
 *
 * WHY THIS EXISTS. Every card and page built a congress.gov URL itself and
 * trusted it. Measured against the live set of 251 people that source has no
 * photograph for four sitting members, and for Ron Johnson it answers with
 * 65,536 bytes beginning "\x00nod" — labelled image/jpeg — every single time.
 * A share card that tried to draw that died, and the record lost its whole
 * card rather than just its face.
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

function answerWith(byUrl: (url: string) => { status: number; body?: Buffer } | null) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
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
  await stopServer();
});

describe("collecting a member's face", () => {
  test("THE OFFICIAL SOURCE IS ASKED FIRST", async () => {
    await forget("Z000001");
    const asked: string[] = [];
    answerWith((url) => {
      asked.push(url);
      return { status: 200, body: JPEG };
    });

    const got = await mod.memberPortrait("Z000001");
    expect(got?.contentType).toBe("image/jpeg");
    expect(asked[0]).toContain("bioguide.congress.gov");
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

  test("an id that is not an id never reaches a fetch or a query", async () => {
    let calls = 0;
    answerWith(() => {
      calls += 1;
      return { status: 200, body: JPEG };
    });
    for (const bad of ["../../etc/passwd", "Q22686", "", "A12345", "a123456"]) {
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
