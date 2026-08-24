/**
 * Sending the sign-up code, and knowing whether it actually went.
 *
 * WHY THIS FILE EXISTS. The code used to be sent by calling Better Auth's
 * `auth.api.sendVerificationOTP`. That endpoint hands the send to
 * `runInBackgroundOrAwait`, whose entire body is:
 *
 *     try { ... await promise } catch (e) { logger.error(...) }
 *
 * So the endpoint answers `{ success: true }` whether the message left the
 * building or the mail provider was never configured at all. The `.catch()`
 * that used to sit on the signup hook was unreachable code: nothing could
 * throw through it. The result on a deployment with no `RESEND_API_KEY` was the
 * worst possible one — the account is created, the screen says "check your
 * email", and no email exists anywhere. Nobody is told, on either side.
 *
 * WHAT THIS DOES INSTEAD. It creates the one-time code itself (Better Auth's
 * server-only `createVerificationOTP`, so the code is stored exactly the way
 * `verify-email` expects to read it), then awaits the send for real and returns
 * what happened. A caller can put that on the screen.
 *
 * It never throws. "Could not send" is an outcome to be reported, not an
 * exception to be swallowed three frames up.
 */

import { prisma } from "../prisma";
import { EmailNotSent, isEmailConfigured, sendOtpEmail } from "./email";
import type { EmailFailureCode } from "./email";

/**
 * Better Auth's own identifier format for a stored one-time code
 * (`plugins/email-otp/utils.ts`: `${type}-otp-${email}`). Duplicated here
 * because the plugin does not export it, and asserted by the test suite so a
 * change upstream fails loudly rather than quietly stranding old codes.
 */
export function otpIdentifier(email: string): string {
  return `email-verification-otp-${email.toLowerCase()}`;
}

export type SendVerificationResult =
  | { sent: true }
  | { sent: false; code: EmailFailureCode; detail: string };

/**
 * Put a fresh code in this person's inbox, and say whether that worked.
 *
 * Old codes for the address are deleted first. Better Auth's own send path
 * inserts a second row and leaves the first one there, so two live codes can
 * exist for one address and the reader has no way to know which one the lookup
 * will pick — a citizen typing the newest code and being told it is wrong.
 */
export async function sendVerificationCode(email: string): Promise<SendVerificationResult> {
  const address = email.trim().toLowerCase();

  // Checked before a code is minted. There is no point issuing one nobody can
  // be told, and a code sitting unsent in the table is a thing an operator
  // would later have to reason about.
  if (!isEmailConfigured()) {
    return {
      sent: false,
      code: "email_not_configured",
      detail:
        "RESEND_API_KEY is not set on the backend, so no verification code can be delivered.",
    };
  }

  // Imported at call time: auth.ts imports this module for the signup path, so
  // a top-level import here would close the cycle at module-evaluation time.
  const { auth } = await import("../auth");

  await prisma.verification.deleteMany({ where: { identifier: otpIdentifier(address) } });

  const otp = await auth.api.createVerificationOTP({
    body: { email: address, type: "email-verification" },
  });

  try {
    await sendOtpEmail(address, String(otp), "email-verification");
    return { sent: true };
  } catch (error) {
    // The code is already stored. Leaving it there is deliberate: if the
    // provider accepted the message and then failed the response, the citizen
    // may well have it, and deleting it would make a code that arrived stop
    // working.
    const code: EmailFailureCode =
      error instanceof EmailNotSent ? error.code : "email_send_failed";
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[Verification] code for ${address} was not delivered: ${detail}`);
    return { sent: false, code, detail };
  }
}
