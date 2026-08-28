/**
 * A CITIZEN'S EMAIL ADDRESS IS NOT THEIR NAME.
 *
 * Roughly a dozen endpoints published `author.email.split("@")[0]` as a
 * person's handle. Somebody who signed up as jane.smith.1987@gmail.com was
 * shown to every reader of every post as "jane.smith.1987" — their real name
 * and their birth year, taken from a field they gave us so we could send them
 * a sign-in code.
 *
 * Bill of Rights IV promises identity stays shielded. This is the test that
 * makes that true rather than aspirational.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";
import { publicHandle } from "../src/services/public-identity";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
async function body(response: Response): Promise<Body> {
  return (await response.json()) as Body;
}

let seq = 0;
let refCounter = 0;

function freshReferenceId(): string {
  refCounter += 1;
  return `pi-${7000 + refCounter}-119`;
}

/** An address whose local part is unmistakable if it ever escapes. */
async function citizen(localPart: string) {
  seq += 1;
  return signUp({
    email: `${localPart}.${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Person ${seq}`,
  });
}

async function reference() {
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: freshReferenceId(),
      referenceType: "bill",
      title: "A bill somebody posted about",
      status: "proposed",
      category: "healthcare",
    },
  });
}

describe("the handle a person is given in public", () => {
  test("the chosen username wins", () => {
    expect(publicHandle({ id: "abc123456789", username: "jane" })).toBe("jane");
  });

  test("with no username, a stand-in built from the account id — never the email", () => {
    const handle = publicHandle({ id: "user_aaaaaa4f2a91", username: null });
    expect(handle).toBe("citizen-4f2a91");
    expect(handle).not.toContain("@");
  });

  test("whitespace is not a username", () => {
    expect(publicHandle({ id: "user_zzzzzzabcdef", username: "   " })).toBe("citizen-abcdef");
  });
});

describe("[bor-art4] no endpoint publishes an email address", () => {
  test("A POST BY SOMEBODY WITH NO USERNAME DOES NOT NAME THEIR EMAIL", async () => {
    const person = await citizen("jane.smith.1987");
    const bill = await reference();

    const created = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({
        content: "A position worth putting a name to.",
        governmentReferenceId: bill.id,
      }),
    });
    expect(created.status).toBe(201);

    const feed = await fetch(`${BASE_URL}/api/posts`, {
      headers: freshClientHeaders({ cookie: person.cookie }),
    });
    const raw = await feed.text();

    // The whole response, not just the field we remembered to check.
    expect(raw).not.toContain("jane.smith.1987");
    expect(raw).not.toContain("@example.com");

    const payload = JSON.parse(raw);
    expect(payload.posts[0].author.username).toMatch(/^citizen-/);
  });

  test("somebody who chose a username is shown that", async () => {
    const person = await citizen("bob.jones.1975");
    await prisma.user.update({
      where: { id: person.userId },
      data: { username: "civicbob", displayUsername: "civicbob" },
    });
    const bill = await reference();

    await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ content: "Something to say.", governmentReferenceId: bill.id }),
    });

    const feed = await fetch(`${BASE_URL}/api/posts`, {
      headers: freshClientHeaders({ cookie: person.cookie }),
    });
    const raw = await feed.text();

    expect(raw).toContain("civicbob");
    expect(raw).not.toContain("bob.jones.1975");
  });

  test("a profile does not name it either", async () => {
    const person = await citizen("alice.brown.1990");
    const viewer = await citizen("viewer");

    const response = await fetch(`${BASE_URL}/api/users/${person.userId}`, {
      headers: freshClientHeaders({ cookie: viewer.cookie }),
    });
    const raw = await response.text();

    expect(raw).not.toContain("alice.brown.1990");
    expect(JSON.parse(raw).username).toMatch(/^citizen-/);
  });
});

describe("the guard that keeps it fixed", () => {
  test("no route or service derives a handle from an email address", async () => {
    // THIS IS THE POINT OF THE FILE. Twelve endpoints did the same wrong thing
    // because each was written by copying the one beside it. A test that only
    // checked today's twelve would pass the day somebody writes the thirteenth.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const roots = [
      join(import.meta.dir, "..", "src", "routes"),
      join(import.meta.dir, "..", "src", "services"),
    ];

    const offenders: string[] = [];
    for (const root of roots) {
      for (const name of readdirSync(root)) {
        const path = join(root, name);
        if (!statSync(path).isFile() || !name.endsWith(".ts")) continue;

        readFileSync(path, "utf8").split("\n").forEach((line, index) => {
          const code = line.split("//")[0] ?? "";
          // Prose is not code. Without this the guard flags the comment in
          // public-identity.ts that explains what it is guarding against.
          if (/^\s*[*/]/.test(line)) return;
          // The admin console is exempt: it shows an operator the account's
          // real email in a column of its own, which is the point of it.
          if (name === "admin.ts") return;
          if (/\.email\.split\(/.test(code)) {
            offenders.push(`${name}:${index + 1} ${line.trim()}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  test("author projections do not load the email at all", async () => {
    // A string that is never selected cannot be spread into a response by
    // somebody in a hurry.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    for (const file of ["posts.ts", "feed.ts", "government-references.ts", "bills.ts"]) {
      const source = readFileSync(join(import.meta.dir, "..", "src", "routes", file), "utf8");
      source.split("\n").forEach((line, index) => {
        if (/author:\s*\{\s*select:.*email:\s*true/.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
