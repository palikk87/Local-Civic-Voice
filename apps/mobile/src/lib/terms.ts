/**
 * The Terms of Use, as content rather than markup.
 *
 * A HAND-KEPT MIRROR of apps/web/src/lib/legal/terms.ts — the two apps share no
 * package, so this is a copy. scripts/terms-parity-check.mjs fails the build if
 * the two ever say different things, so "mirror" is enforced, not hoped for.
 *
 * WRITTEN WITHOUT A LAWYER, AND HONEST ABOUT IT. These are plain-language terms
 * assembled to be genuinely useful and protective for a civic-engagement beta,
 * not reviewed by counsel. They are a real starting point and should be read by
 * a lawyer before the platform is relied on at scale. One thing in here still
 * needs a human decision before it is truly correct:
 *
 *   - GOVERNING_JURISDICTION below is a placeholder. Set it to the U.S. state
 *     the operator actually resides or is organised in.
 *
 * TERMS_VERSION is stored with a person's acceptance, so if these change in a
 * way that matters, acceptance can be asked for again rather than assumed.
 */

export const TERMS_VERSION = "2026-08-27.1";
export const TERMS_EFFECTIVE_DATE = "August 27, 2026";

/** TODO(operator): set to the state whose law governs. */
export const GOVERNING_JURISDICTION = "the State in which the operator resides";
export const CONTACT_EMAIL = "ayeandnay1776@gmail.com";

export interface TermsSection {
  heading: string;
  paragraphs: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: "1. Agreement",
    paragraphs: [
      `These Terms of Use ("Terms") are an agreement between you and AYE & NAY ("we", "us", the "Platform"). They govern your use of the Platform, including the website and mobile app. By creating an account, casting a position, posting, or otherwise using the Platform, you agree to these Terms. If you do not agree, do not use the Platform.`,
      `Effective ${TERMS_EFFECTIVE_DATE}. We may update these Terms; see "Changes to these Terms" below.`,
    ],
  },
  {
    heading: "2. Who may use AYE & NAY",
    paragraphs: [
      `You must be at least 18 years old, or the age of majority where you live if that is older, to use the Platform. By using it you represent that you meet this requirement and that you are able to enter into this agreement.`,
      `You are responsible for keeping your account credentials secure and for everything done through your account.`,
    ],
  },
  {
    heading: "3. What AYE & NAY is",
    paragraphs: [
      `AYE & NAY is a civic-engagement platform. It gathers real legislation, executive actions, and court decisions from public government sources and lets people read them, discuss them, and record where they personally stand.`,
      `It is a place to express and compare opinion. It is not a government service, is not affiliated with or endorsed by any government body, and does not conduct or influence any official election, referendum, or legislative process.`,
    ],
  },
  {
    heading: "4. Positions and votes are opinion, not official action",
    paragraphs: [
      `When you cast an "Aye" or "Nay", share a position, or see a tally on the Platform, you are taking part in an expression of public opinion. These are personal viewpoints. They are not official votes, they have no legal effect, they do not register with any government, and they do not count toward the passage, defeat, or amendment of any actual law or the outcome of any actual election.`,
      `Counts and other aggregate figures on the Platform reflect what its users have said and nothing more. They are not a scientific poll and should not be represented as the official position of any government body, official, or electorate.`,
    ],
  },
  {
    heading: "5. Not legal, financial, or professional advice",
    paragraphs: [
      `Content on the Platform, including plain-language summaries of laws, is provided for general information and civic engagement. It is not legal, financial, or other professional advice, and it is not a substitute for advice from a qualified professional or for reading the official text of a law yourself. Do not rely on the Platform for any decision that has legal or financial consequences.`,
    ],
  },
  {
    heading: "6. Government data and accuracy",
    paragraphs: [
      `Legislative, executive, and judicial information is drawn from public sources such as Congress.gov, the Federal Register, and court records. We work to present it faithfully and to show where it came from, but we do not guarantee that it is complete, current, or free of error, and government sources themselves are sometimes delayed or incorrect.`,
      `Where the Platform cannot obtain official text or data, it will show that plainly rather than fill the gap with an invented value. Always confirm anything important against the official source.`,
    ],
  },
  {
    heading: "7. Your content",
    paragraphs: [
      `You keep ownership of what you post — your words, positions, and other content. By posting, you grant us a non-exclusive, worldwide, royalty-free licence to host, store, display, and distribute that content on and through the Platform for the purpose of operating it. This licence ends when you delete the content or your account, except for copies retained in routine backups or where the content has been shared by others.`,
      `You are responsible for what you post and confirm that you have the right to post it.`,
    ],
  },
  {
    heading: "8. Acceptable use",
    paragraphs: [
      `You agree not to use the Platform to post or do anything unlawful, and in particular not to: harass, threaten, defame, or incite violence against others; impersonate any person or organisation; post content you do not have the right to share; attempt to manipulate counts or discussion through fake or automated accounts; interfere with or attack the Platform's operation or security; or misrepresent Platform activity as an official government act or result.`,
      `You also agree not to scrape, resell, or bulk-extract Platform data except as expressly permitted.`,
    ],
  },
  {
    heading: "9. Moderation and enforcement",
    paragraphs: [
      `We may review, remove, or restrict content, and we may suspend or terminate accounts, that we reasonably believe violate these Terms or the law, or that harm the Platform or its users. A suspended account may lose access to some or all features, and its activity may be prevented from counting toward Platform figures.`,
      `We aim to act fairly and proportionately, but we are not obligated to host any particular content or account.`,
    ],
  },
  {
    heading: "10. Beta status",
    paragraphs: [
      `The Platform is in beta. It is offered as a work in progress: features may change, break, or be removed, and data or content may be lost. We provide it during this period so that people can use it and tell us what needs fixing — the in-app bug reporter, on every screen, is the fastest way to reach us.`,
    ],
  },
  {
    heading: "11. Privacy",
    paragraphs: [
      `Your use of the Platform is also subject to our handling of your information. We collect what we need to run the Platform — your account details, what you post, and how you use it — and we do not sell your personal information. Aggregate, anonymised figures about Platform activity may be shown to others or offered to organisations, but individual positions are only ever shown where the Platform's own rules allow. A fuller privacy notice will be provided as the Platform develops.`,
    ],
  },
  {
    heading: "12. Third-party links and services",
    paragraphs: [
      `The Platform links to and relies on third-party sources and services, including government websites and infrastructure providers. We do not control those third parties and are not responsible for their content, availability, or practices. Following a link is at your own risk and subject to that third party's own terms.`,
    ],
  },
  {
    heading: "13. Disclaimer of warranties",
    paragraphs: [
      `The Platform is provided "as is" and "as available", without warranties of any kind, whether express or implied, including implied warranties of merchantability, fitness for a particular purpose, accuracy, and non-infringement. We do not warrant that the Platform will be uninterrupted, secure, or error-free, or that any information on it is accurate or current. Some jurisdictions do not allow the exclusion of certain warranties, so parts of this section may not apply to you.`,
    ],
  },
  {
    heading: "14. Limitation of liability",
    paragraphs: [
      `To the fullest extent permitted by law, we will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, goodwill, or other intangible losses, arising out of or relating to your use of the Platform. To the fullest extent permitted by law, our total liability for any claim relating to the Platform will not exceed one hundred U.S. dollars (US$100). Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.`,
    ],
  },
  {
    heading: "15. Indemnification",
    paragraphs: [
      `You agree to indemnify and hold us harmless from claims, damages, and expenses (including reasonable legal fees) arising out of your content, your use of the Platform, or your violation of these Terms or of the law.`,
    ],
  },
  {
    heading: "16. Changes to these Terms",
    paragraphs: [
      `We may update these Terms as the Platform develops. When we make a material change, we will update the effective date and, where appropriate, ask you to review and accept the updated Terms. Continuing to use the Platform after an update means you accept the updated Terms.`,
    ],
  },
  {
    heading: "17. Governing law",
    paragraphs: [
      `These Terms are governed by the laws of the United States and of ${GOVERNING_JURISDICTION}, without regard to conflict-of-law rules. You agree that the courts located there will have jurisdiction over any dispute that is not otherwise resolved.`,
    ],
  },
  {
    heading: "18. Contact",
    paragraphs: [
      `Questions about these Terms can be sent to ${CONTACT_EMAIL}, or raised through the in-app bug reporter.`,
    ],
  },
];
