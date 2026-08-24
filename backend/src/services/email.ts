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
    subject: "Your Civic Voice sign-in code",
    lead: "Use this code to sign in to Civic Voice.",
  },
  "email-verification": {
    subject: "Verify your Civic Voice email",
    lead: "Use this code to verify your email address.",
  },
  "forget-password": {
    subject: "Reset your Civic Voice password",
    lead: "Use this code to reset your password.",
  },
  "change-email": {
    subject: "Confirm your new Civic Voice email",
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
      <h1 style="font-size:20px;margin:0 0 8px">Civic Voice</h1>
      <p style="margin:0 0 24px;color:#475569">${copy.lead}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;padding:16px 0;text-align:center;background:#F1F5F9;border-radius:12px">${otp}</div>
      <p style="margin:24px 0 0;color:#64748B;font-size:13px">
        It expires shortly. If you didn't request it, you can ignore this email.
      </p>
    </div>
  `.trim();

  await sendEmail({ to, subject: copy.subject, html, text });
}

/** Whether email can actually be sent. Surfaced by the health check. */
export function isEmailConfigured(): boolean {
  return !!env.RESEND_API_KEY;
}
