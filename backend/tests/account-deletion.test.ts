/**
 * CLOSING AN ACCOUNT REALLY CLOSES IT.
 *
 * THE BUG THAT STARTED THIS. A deleted account kept voting. Its rows in
 * GovernmentReferenceVote survived, because that table holds a person's id as a
 * plain column with no link back to the account, so nothing removed them and
 * the Pulse went on counting a ghost. Ten more tables were in the same state.
 *
 * THE RULE, decided by the owner: "any account deletion removes all trace of
 * the user, but does not undo the results of their votes. So if they were on a
 * jury or voted to impeach or a system reset took effect that their vote was a
 * part of, it does not undo those actions once those proceedings are complete.
 * If they delete their account mid proceedings then their vote is removed — in
 * the case of a jury their vote is removed and a new juror is randomly
 * selected."
 *
 * WHY THIS TEST SCANS RATHER THAN CHECKS A LIST. A test that asserts eleven
 * named tables are empty is a test that passes on the day a twelfth is added.
 * So the sweep at the end walks EVERY column of EVERY table looking for the
 * departed person's id, using the schema itself as the list. A table added next
 * year fails here, on the day it is added, rather than quietly keeping
 * somebody.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  freshClientHeaders,
  prisma,
  resetData,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";

const PASSWORD = "correct-horse-battery-staple";

/**
 * What the leaver has to type to confirm.
 *
 * Their username if they have one, otherwise their email. Sign-up asks for an
 * email and a name; a username is set later or never, and an account without
 * one must still be closable by the person it belongs to. This test is how that
 * hole was found — the route demanded a username, every account created here
 * has none, and every delete came back 400.
 */
async function whoAmI(): Promise<string> {
  const me = await prisma.user.findUnique({
    where: { id: leaver.userId },
    select: { username: true, email: true },
  });
  return me?.username ?? me!.email;
}

let leaver = { cookie: "", userId: "" };
let bystander = { cookie: "", userId: "" };
let referenceId = "";

async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", Cookie: cookie }),
    body: JSON.stringify(body),
  });
}

/**
 * Every table and column that can hold a person's id, read out of the live
 * database rather than out of a list somebody maintains.
 *
 * Text columns only, and only ones whose name looks like it points at a person.
 * Scanning every text column in the schema would match a post that happens to
 * quote an id, which is a different problem.
 */
async function tablesHolding(id: string): Promise<string[]> {
  const columns = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string }>
  >(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying')
      AND (
        column_name ILIKE '%user%id%' OR column_name ILIKE '%author%id%'
        OR column_name ILIKE '%voter%id%' OR column_name ILIKE '%juror%id%'
        OR column_name ILIKE '%accused%id%' OR column_name ILIKE '%reporter%id%'
        OR column_name ILIKE '%requested%id%' OR column_name ILIKE '%sender%id%'
        OR column_name ILIKE '%blocker%id%' OR column_name ILIKE '%blocked%id%'
        OR column_name ILIKE '%muter%id%' OR column_name ILIKE '%muted%id%'
        OR column_name ILIKE '%leader%id%' OR column_name ILIKE '%filed%id%'
        OR column_name = 'id'
      )
  `);

  const found: string[] = [];
  for (const { table_name, column_name } of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM "${table_name}" WHERE "${column_name}" = $1`,
      id,
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) found.push(`${table_name}.${column_name} (${n})`);
  }
  return found;
}

beforeAll(async () => {
  await startServer();
  await resetData();

  const reference = await prisma.governmentReference.create({
    data: {
      masterReferenceId: "hr-4836-119",
      referenceType: "bill",
      title: "Veterans Healthcare Improvement Act",
      status: "committee",
      category: "healthcare",
      congress: 119,
    },
  });
  referenceId = reference.id;

  leaver = await signUp({
    email: "leaver@account-deletion.test",
    password: PASSWORD,
    name: "Wants To Leave",
  });
  bystander = await signUp({
    email: "stays@account-deletion.test",
    password: PASSWORD,
    name: "Stays Behind",
  });

  // One of everything, so the sweep has something to find if the deletion
  // misses a table.
  await post(`/api/government-references/${referenceId}/vote`, leaver.cookie, {
    position: "support",
  });
  await post(`/api/government-references/${referenceId}/vote`, bystander.cookie, {
    position: "oppose",
  });

  const created = await post("/api/posts", leaver.cookie, {
    content: "Something I said before I left.",
    governmentReferenceId: referenceId,
  });
  const postId = ((await created.json()) as { post: { id: string } }).post.id;

  await post(`/api/posts/${postId}/like`, bystander.cookie, {});
  await post(`/api/posts/${postId}/save`, leaver.cookie, {});
  await post(`/api/users/${bystander.userId}/follow`, leaver.cookie, {});
  await post("/api/bug-reports", leaver.cookie, {
    message: "Something I reported before I left.",
    page: "/",
  });
});

afterAll(async () => {
  await stopServer();
});

describe("what the vote count says before anybody leaves", () => {
  test("both positions are counted", async () => {
    const response = await fetch(`${BASE_URL}/api/government-references/${referenceId}`);
    const body = (await response.json()) as { reference: { votes: { total: number } } };
    expect(body.reference.votes.total).toBe(2);
  });
});

describe("closing your own account asks for proof it is you", () => {
  test("a wrong username is refused", async () => {
    const response = await fetch(`${BASE_URL}/api/users/me`, {
      method: "DELETE",
      headers: freshClientHeaders({ "Content-Type": "application/json", Cookie: leaver.cookie }),
      body: JSON.stringify({ password: PASSWORD, confirmUsername: "somebody-else" }),
    });
    expect(response.status).toBe(400);

    // And nothing happened.
    const still = await prisma.user.findUnique({ where: { id: leaver.userId } });
    expect(still).not.toBeNull();
  });

  test("A WRONG PASSWORD IS REFUSED", async () => {
    // The guard that matters: a session left open on an unattended laptop must
    // not be enough to erase somebody's civic record.
    const response = await fetch(`${BASE_URL}/api/users/me`, {
      method: "DELETE",
      headers: freshClientHeaders({ "Content-Type": "application/json", Cookie: leaver.cookie }),
      body: JSON.stringify({ password: "not-the-password", confirmUsername: await whoAmI() }),
    });
    expect(response.status).toBe(401);

    const still = await prisma.user.findUnique({ where: { id: leaver.userId } });
    expect(still).not.toBeNull();
  });

  test("a signed-out request is refused", async () => {
    const response = await fetch(`${BASE_URL}/api/users/me`, {
      method: "DELETE",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ password: PASSWORD, confirmUsername: "anyone" }),
    });
    expect(response.status).toBe(401);
  });
});

describe("and then it really closes", () => {
  test("the right password and the right username close it", async () => {
    const response = await fetch(`${BASE_URL}/api/users/me`, {
      method: "DELETE",
      headers: freshClientHeaders({ "Content-Type": "application/json", Cookie: leaver.cookie }),
      body: JSON.stringify({ password: PASSWORD, confirmUsername: await whoAmI() }),
    });
    expect(response.status).toBe(200);
  });

  test("THE ACCOUNT IS GONE", async () => {
    expect(await prisma.user.findUnique({ where: { id: leaver.userId } })).toBeNull();
  });

  test("THE VOTE IS GONE, AND THE PULSE MOVED", async () => {
    // The reported bug, stated as arithmetic. Two votes became one, and the
    // published count says one — not two with a ghost in it.
    const rows = await prisma.governmentReferenceVote.count({
      where: { userId: leaver.userId },
    });
    expect(rows).toBe(0);

    const response = await fetch(`${BASE_URL}/api/government-references/${referenceId}`);
    const body = (await response.json()) as { reference: { votes: { total: number } } };
    expect(body.reference.votes.total).toBe(1);
  });

  test("NOTHING ANYWHERE STILL HOLDS THEM", async () => {
    // The sweep. Reads the schema, not a list — see the note at the top.
    const held = await tablesHolding(leaver.userId);
    expect(
      held,
      held.length
        ? `A closed account is still referenced. Every one of these has to be ` +
            `removed in services/account-deletion.ts:\n  ${held.join("\n  ")}`
        : "",
    ).toEqual([]);
  });

  test("and the person who stayed is untouched", async () => {
    // A deletion that takes a neighbour with it is worse than one that leaves
    // something behind.
    expect(await prisma.user.findUnique({ where: { id: bystander.userId } })).not.toBeNull();
    expect(
      await prisma.governmentReferenceVote.count({ where: { userId: bystander.userId } }),
    ).toBe(1);
  });
});
