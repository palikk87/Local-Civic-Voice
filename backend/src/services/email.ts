import { createHash } from "node:crypto";
import { env } from "../env";

/**
 * Transactional email via Resend.
 *
 * This replaces a hardcoded POST to the old host platform's own SMTP relay,
 * which took no API key because it authorised by network position — so it sent
 * mail only from inside their network, and stopped existing the moment this
 * project left it.
 *
 * Plain fetch rather than the SDK: one endpoint, one shape, and nothing else in
 * this backend needs an email dependency.
 */

/**
 * Overridable only so the test suite can stand a server in front of it and read
 * what actually went out. Defaults to Resend; see env.ts.
 */
const RESEND_ENDPOINT = env.RESEND_ENDPOINT;

/**
 * Why a send failed, in a form a route can turn into a status code.
 *
 * `sendEmail` used to throw a bare Error for both cases, which meant "nobody
 * configured a mail provider" and "the provider rejected this message" reached
 * the caller as the same unclassifiable string. They are different problems
 * with different owners, and a citizen staring at a code screen deserves to be
 * told which one is happening.
 */
export type EmailFailureCode = "email_not_configured" | "email_send_failed";

export class EmailNotSent extends Error {
  readonly code: EmailFailureCode;

  constructor(code: EmailFailureCode, message: string) {
    super(message);
    this.name = "EmailNotSent";
    this.code = code;
  }
}

/**
 * Every purpose Better Auth's emailOTP plugin can emit. Keep this exhaustive —
 * a missing member is how the previous handler silently dropped reset codes.
 */
export type OtpPurpose =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email";

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Loud on purpose. The previous implementation returned silently for every
    // purpose except sign-in, so password-reset codes were dropped with no error
    // anywhere — the failure was invisible until someone tried to reset.
    throw new EmailNotSent(
      "email_not_configured",
      "RESEND_API_KEY is not set, so no email can be sent. Set it in the backend " +
        "environment; sign-up, sign-in and password-reset codes all depend on it."
    );
  }

  // A connection failure has to come back classified too. Left bare it arrives
  // as a TypeError, which the caller cannot tell apart from a bug in this file.
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
    });
  } catch (error) {
    throw new EmailNotSent(
      "email_send_failed",
      `Could not reach the mail provider: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new EmailNotSent(
      "email_send_failed",
      `Resend rejected the message (HTTP ${response.status})${detail ? `: ${detail}` : ""}`
    );
  }
}

const PURPOSE_COPY: Record<OtpPurpose, { subject: string; lead: string }> = {
  "sign-in": {
    subject: "Your AYE & NAY sign-in code",
    lead: "Use this code to sign in to AYE & NAY.",
  },
  "email-verification": {
    subject: "Verify your AYE & NAY email",
    lead: "Use this code to verify your email address.",
  },
  "forget-password": {
    subject: "Reset your AYE & NAY password",
    lead: "Use this code to reset your password.",
  },
  "change-email": {
    subject: "Confirm your new AYE & NAY email",
    lead: "Use this code to confirm your new email address.",
  },
};

/**
 * Send a one-time code.
 *
 * Handles every purpose Better Auth's emailOTP plugin emits. The handler this
 * replaced opened with `if (type !== "sign-in") return;`, so reset codes were
 * generated, recorded, and never delivered.
 */
export async function sendOtpEmail(
  to: string,
  otp: string,
  purpose: OtpPurpose
): Promise<void> {
  const copy = PURPOSE_COPY[purpose] ?? PURPOSE_COPY["sign-in"];

  const text = [
    copy.lead,
    "",
    `Code: ${otp}`,
    "",
    "It expires shortly. If you didn't request it, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0F172A">
      <h1 style="font-size:20px;margin:0 0 8px">AYE & NAY</h1>
      <p style="margin:0 0 24px;color:#475569">${copy.lead}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;padding:16px 0;text-align:center;background:#F1F5F9;border-radius:12px">${otp}</div>
      <p style="margin:24px 0 0;color:#64748B;font-size:13px">
        It expires shortly. If you didn't request it, you can ignore this email.
      </p>
    </div>
  `.trim();

  await sendEmail({ to, subject: copy.subject, html, text });
}

/** Whether a key is present at all. Surfaced by the health check. */
export function isEmailConfigured(): boolean {
  return !!env.RESEND_API_KEY;
}

/**
 * What this deployment can say about its mail setup without sending anything.
 *
 * Never returns the key. `keyFingerprint` is the first four characters of its
 * SHA-256 digest — enough to answer "is the value the server has the same one I
 * pasted?" by comparing two fingerprints, and useless to anybody who learns it.
 *
 * WHY THIS EXISTS. "There is definitely a key in place" and "no email arrives"
 * are both true far more often than they should be, and the reason is almost
 * never a missing key. It is a key with a newline on the end, a key set on the
 * web host instead of the API, or — most often — a verified key sending From a
 * domain the provider has not verified, which is refused identically to a bad
 * key. Guessing between those from the outside is what wasted the time. This
 * reports each of them separately.
 */
export function emailConfiguration(): {
  configured: boolean;
  keyFingerprint: string | null;
  keyLooksLikeResend: boolean;
  from: string;
  fromDomain: string | null;
  fromIsProviderTestSender: boolean;
} {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  const domain = from.match(/@([^\s>]+)/)?.[1]?.toLowerCase() ?? null;

  return {
    configured: !!key,
    keyFingerprint: key
      ? createHash("sha256").update(key).digest("hex").slice(0, 4)
      : null,
    // Resend keys start "re_". A value that does not is usually the wrong key
    // pasted into the right box — an OpenAI key, a database URL, a Vercel token.
    keyLooksLikeResend: !!key && key.startsWith("re_"),
    from,
    fromDomain: domain,
    // Resend's shared sender. Needs no DNS, and delivers ONLY to the address
    // the Resend account was opened with — which is itself a common reason a
    // send "succeeds" and nothing arrives for anybody else.
    fromIsProviderTestSender: domain === "resend.dev",
  };
}

/**
 * Actually send a message, and report exactly what happened.
 *
 * The one question worth asking of a mail setup, asked in the only way that
 * answers it: by sending. Everything else is inference.
 */
export async function trySendingEmail(to: string): Promise<
  | { ok: true }
  | { ok: false; code: EmailFailureCode; detail: string }
> {
  try {
    await sendEmail({
      to,
      subject: "AYE & NAY mail check",
      text:
        "This is a test message from the AYE & NAY admin console.\n\n" +
        "If it arrived, sign-up codes, sign-in codes and password resets will too.",
      html:
        "<p>This is a test message from the AYE & NAY admin console.</p>" +
        "<p>If it arrived, sign-up codes, sign-in codes and password resets will too.</p>",
    });
    return { ok: true };
  } catch (error) {
    const code: EmailFailureCode =
      error instanceof EmailNotSent ? error.code : "email_send_failed";
    return {
      ok: false,
      code,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
