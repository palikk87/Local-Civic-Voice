/**
 * The sign-up code, from the moment an account exists to the moment it can vote.
 *
 * WHAT THIS EXISTS TO CATCH. Verification looked finished and was not. Better
 * Auth's `sendVerificationOTP` endpoint passes the send to
 * `runInBackgroundOrAwait`, which swallows every error and answers
 * `{ success: true }` regardless — so a deployment with no `RESEND_API_KEY`
 * created the account, showed "check your email", sent nothing, and told
 * nobody. Every test that could have caught it stopped at "the endpoint
 * returned 200", which is exactly the thing that stays true when it breaks.
 *
 * So this suite does not assert on the endpoint's own opinion of itself. It
 * stands a server in front of the mail provider, reads the message body that
 * actually left the process, pulls the digits out of it, and types those digits
 * into the verify endpoint. The chain it proves is:
 *
 *   sign up -> a real message with a real code -> that code verifies ->
 *   the account can now move the public tally
 *
 * and, just as importantly, the failure chain:
 *
 *   no provider configured -> 503 that says so, and no code is minted
 *   provider refuses       -> 502 that says so
 *
 * Three servers, because the configuration is what is under test. The harness
 * takes environment overrides for that reason.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  serverLog,
  signUp,
  startServer,
  stopServer,
  waitForLog,
} from "./helpers/server";
import { otpIdentifier } from "../src/services/email-verification";

// ---------------------------------------------------------------------------
// A mail provider we can read
// ---------------------------------------------------------------------------

interface CapturedEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  authorization: string;
}

const outbox: CapturedEmail[] = [];
let refuseMail = false;
let mailServer: ReturnType<typeof Bun.serve> | null = null;

/**
 * Stands in for api.resend.com and keeps what it was sent.
 *
 * `fetch` in this sandbox cannot traverse the outbound proxy, but a local
 * Bun.serve is reachable — the same shape the roll-call suite uses. It is also
 * the honest shape for this test regardless of sandbox: the thing being proven
 * is what the backend puts on the wire.
 */
function startMailServer(): string {
  mailServer = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        from: string;
        to: string[];
        subject: string;
        text: string;
        html: string;
      };
      outbox.push({
        to: body.to[0] ?? "",
        from: body.from,
        subject: body.subject,
        text: body.text,
        html: body.html,
        authorization: request.headers.get("authorization") ?? "",
      });
      if (refuseMail) {
        return new Response(JSON.stringify({ message: "sender domain not verified" }), {
          status: 422,
        });
      }
      return Response.json({ id: `msg_${outbox.length}` });
    },
  });
  return `http://127.0.0.1:${mailServer.port}/emails`;
}

/** The six digits a citizen is asked to type. */
function codeIn(email: CapturedEmail): string {
  const match = email.text.match(/\b(\d{4,8})\b/);
  if (!match) throw new Error(`No code in the message body:\n${email.text}`);
  return match[1]!;
}

async function inboxFor(address: string, timeoutMs = 5000): Promise<CapturedEmail[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mine = outbox.filter((mail) => mail.to === address);
    if (mine.length > 0) return mine;
    await Bun.sleep(50);
  }
  return outbox.filter((mail) => mail.to === address);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PASSWORD = "test-password-not-a-real-one";

function withCookie(cookie: string, extra: Record<string, string> = {}) {
  return freshClientHeaders({ "Content-Type": "application/json", cookie, ...extra });
}

let seq = 0;
async function newcomer(): Promise<{ cookie: string; userId: string; email: string }> {
  seq += 1;
  const email = `newcomer${seq}@example.com`;
  const account = await signUp({ email, password: PASSWORD, name: `Newcomer ${seq}`, verified: false });
  return { ...account, email };
}

let refCounter = 0;
async function law() {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${7100 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill about insulin pricing",
      status: "proposed",
      category: "healthcare",
    },
  });
}

async function tryToVote(cookie: string, referenceId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: withCookie(cookie),
    body: JSON.stringify({ position: "support" }),
  });
}

// ===========================================================================
// 1. No mail provider configured — the case that was silently broken
// ===========================================================================

describe("a deployment that cannot send email says so", () => {
  beforeAll(async () => {
    // No RESEND_API_KEY: the harness's default, and the shape of the
    // deployment where this bug was found.
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  beforeEach(async () => {
    await resetData();
    outbox.length = 0;
  });

  test("asking for a code answers 503 and names the reason", async () => {
    const person = await newcomer();

    const response = await fetch(`${BASE_URL}/api/verification/email/send`, {
      method: "POST",
      headers: withCookie(person.cookie),
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { sent: boolean; code: string; error: string };
    expect(body.sent).toBe(false);
    expect(body.code).toBe("email_not_configured");
    // The citizen is told, in words, that no code is coming. The old behaviour
    // was a green "check your email" over an empty inbox.
    expect(body.error.toLowerCase()).toContain("cannot send email");
  });

  test("no code is minted that nobody could ever receive", async () => {
    const person = await newcomer();

    await fetch(`${BASE_URL}/api/verification/email/send`, {
      method: "POST",
      headers: withCookie(person.cookie),
    });

    const codes = await prisma.verification.count({
      where: { identifier: otpIdentifier(person.email) },
    });
    expect(codes).toBe(0);
  });

  test("the operator is told at sign-up, by name and by reason", async () => {
    const person = await newcomer();

    // Wait for the exact line, not merely for the address: "[Signup] New
    // account created" mentions the address a moment earlier, so polling on
    // the address alone races the thing being measured.
    const logged = await waitForLog(`no verification code reached ${person.email}`);
    expect(logged).toBe(true);
    expect(serverLog()).toContain("email_not_configured");
  });

  test("status is honest about what this server can do", async () => {
    const person = await newcomer();

    const response = await fetch(`${BASE_URL}/api/verification/email`, {
      headers: withCookie(person.cookie),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { email: string; verified: boolean; deliverable: boolean };
    expect(body.email).toBe(person.email);
    expect(body.verified).toBe(false);
    expect(body.deliverable).toBe(false);
  });

  test("a signed-out visitor gets nothing from either route", async () => {
    const status = await fetch(`${BASE_URL}/api/verification/email`, {
      headers: freshClientHeaders(),
    });
    expect(status.status).toBe(401);

    const send = await fetch(`${BASE_URL}/api/verification/email/send`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
    });
    expect(send.status).toBe(401);
  });
});

// ===========================================================================
// 2. The whole flow, against a provider that accepts
// ===========================================================================

describe("sign up, read the code out of the message, and take part", () => {
  beforeAll(async () => {
    const endpoint = startMailServer();
    refuseMail = false;
    await startServer({
      RESEND_API_KEY: "test-resend-key-not-a-real-one",
      RESEND_ENDPOINT: endpoint,
      EMAIL_FROM: "AYE & NAY Test <test@example.invalid>",
    });
  });

  afterAll(async () => {
    await stopServer();
    mailServer?.stop(true);
    mailServer = null;
  });

  beforeEach(async () => {
    await resetData();
    outbox.length = 0;
  });

  test("creating an account puts a real message on the wire", async () => {
    const person = await newcomer();

    const inbox = await inboxFor(person.email);
    expect(inbox.length).toBe(1);

    const mail = inbox[0]!;
    expect(mail.subject).toBe("Verify your AYE & NAY email");
    expect(mail.from).toBe("AYE & NAY Test <test@example.invalid>");
    // Sent as the provider requires, not merely constructed.
    expect(mail.authorization).toBe("Bearer test-resend-key-not-a-real-one");
    // Both parts carry the code — a text-only client is not left with nothing.
    const code = codeIn(mail);
    expect(mail.html).toContain(code);
  });

  test("the code in the message is the code the server stored", async () => {
    const person = await newcomer();
    const mail = (await inboxFor(person.email))[0]!;

    const stored = await prisma.verification.findFirst({
      where: { identifier: otpIdentifier(person.email) },
    });

    // Asserting the identifier, not just the value: the format is Better
    // Auth's (`${type}-otp-${email}`) and this file duplicates it. If upstream
    // changes it, this fails here rather than stranding every citizen's code.
    expect(stored).not.toBeNull();
    expect(stored!.value.split(":")[0]).toBe(codeIn(mail));
  });

  test("before the code, the tally will not move", async () => {
    const person = await newcomer();
    const bill = await law();

    const response = await tryToVote(person.cookie, bill.id);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "email_verification_required",
    );
  });

  test("the wrong code changes nothing", async () => {
    const person = await newcomer();
    await inboxFor(person.email);

    const response = await fetch(`${BASE_URL}/api/auth/email-otp/verify-email`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ email: person.email, otp: "000000" }),
    });

    expect(response.ok).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: person.userId } });
    expect(row.emailVerified).toBe(false);
  });

  test("the right code verifies the account and opens the gate", async () => {
    const person = await newcomer();
    const bill = await law();
    const code = codeIn((await inboxFor(person.email))[0]!);

    const verify = await fetch(`${BASE_URL}/api/auth/email-otp/verify-email`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ email: person.email, otp: code }),
    });
    expect(verify.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: person.userId } });
    expect(row.emailVerified).toBe(true);

    // The point of the whole exercise. Same session cookie, same account,
    // and now the vote lands.
    const vote = await tryToVote(person.cookie, bill.id);
    expect(vote.status).toBe(200);

    const record = await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } });
    expect(record.supportVotes).toBe(1);
  });

  test("'send another code' sends another code, and only one is live", async () => {
    const person = await newcomer();
    const first = codeIn((await inboxFor(person.email))[0]!);

    const resend = await fetch(`${BASE_URL}/api/verification/email/send`, {
      method: "POST",
      headers: withCookie(person.cookie),
    });
    expect(resend.status).toBe(200);
    expect((await resend.json()) as { sent: boolean }).toMatchObject({ sent: true });

    const inbox = await inboxFor(person.email);
    expect(inbox.length).toBe(2);
    const second = codeIn(inbox[1]!);

    // Exactly one row for this address. Better Auth's own send path inserts a
    // second and leaves the first, so two codes are live at once and the
    // lookup picks whichever it finds — a citizen typing the newest code out
    // of the newest email and being told it is wrong.
    const live = await prisma.verification.count({
      where: { identifier: otpIdentifier(person.email) },
    });
    expect(live).toBe(1);

    if (first !== second) {
      const stale = await fetch(`${BASE_URL}/api/auth/email-otp/verify-email`, {
        method: "POST",
        headers: withCookie(person.cookie),
        body: JSON.stringify({ email: person.email, otp: first }),
      });
      expect(stale.ok).toBe(false);
    }

    const fresh = await fetch(`${BASE_URL}/api/auth/email-otp/verify-email`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ email: person.email, otp: second }),
    });
    expect(fresh.status).toBe(200);
  });

  test("a verified account is not mailed again", async () => {
    const person = await newcomer();
    const code = codeIn((await inboxFor(person.email))[0]!);
    await fetch(`${BASE_URL}/api/auth/email-otp/verify-email`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ email: person.email, otp: code }),
    });

    const before = outbox.length;
    const response = await fetch(`${BASE_URL}/api/verification/email/send`, {
      method: "POST",
      headers: withCookie(person.cookie),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as { sent: boolean; verified: boolean }).toMatchObject({
      sent: false,
      verified: true,
    });
    expect(outbox.length).toBe(before);
  });

  test("status follows the account, not the session it was minted with", async () => {
    const person = await newcomer();
    const code = codeIn((await inboxFor(person.email))[0]!);
    await fetch(`${BASE_URL}/api/auth/email-otp/verify-email`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ email: person.email, otp: code }),
    });

    // The cookie was issued at sign-up and says emailVerified:false. Reading
    // the row rather than the session is what keeps somebody who just finished
    // from being told they have not.
    const response = await fetch(`${BASE_URL}/api/verification/email`, {
      headers: withCookie(person.cookie),
    });
    expect(((await response.json()) as { verified: boolean }).verified).toBe(true);
  });

  test("codes cannot be pulled in a stream", async () => {
    const person = await newcomer();
    const headers = withCookie(person.cookie);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await fetch(`${BASE_URL}/api/verification/email/send`, {
        method: "POST",
        headers,
      });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });
});

// ===========================================================================
// 3. A provider that refuses
// ===========================================================================

describe("a mail provider that refuses is reported, not hidden", () => {
  beforeAll(async () => {
    const endpoint = startMailServer();
    refuseMail = true;
    await startServer({
      RESEND_API_KEY: "test-resend-key-not-a-real-one",
      RESEND_ENDPOINT: endpoint,
    });
  });

  afterAll(async () => {
    await stopServer();
    mailServer?.stop(true);
    mailServer = null;
    refuseMail = false;
  });

  beforeEach(async () => {
    await resetData();
    outbox.length = 0;
  });

  test("the refusal reaches the caller with the provider's own words", async () => {
    const person = await newcomer();

    const response = await fetch(`${BASE_URL}/api/verification/email/send`, {
      method: "POST",
      headers: withCookie(person.cookie),
    });

    expect(response.status).toBe(502);
    const body = (await response.json()) as { sent: boolean; code: string; detail: string };
    expect(body.sent).toBe(false);
    expect(body.code).toBe("email_send_failed");
    expect(body.detail).toContain("422");
    expect(body.detail).toContain("sender domain not verified");
  });

  test("the account still exists — a bad provider does not lose the signup", async () => {
    const person = await newcomer();
    const row = await prisma.user.findUnique({ where: { id: person.userId } });
    expect(row).not.toBeNull();
    expect(row!.emailVerified).toBe(false);
  });
});
