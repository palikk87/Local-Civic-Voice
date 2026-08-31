/**
 * The Privacy Policy, as content rather than markup, so the /privacy page and
 * any summary render the same words and cannot drift apart. Same shape as
 * terms.ts next door, deliberately.
 *
 * WRITTEN WITHOUT A LAWYER, AND HONEST ABOUT IT. The operator is building this
 * alone and cannot afford counsel. So this is not boilerplate copied from a
 * template and hoped over — every sentence below was written by reading the
 * schema and the services and saying what they actually do. That is the only
 * defence available here, and it is a better one than most policies manage:
 * a notice that is TRUE is hard to be wrong about.
 *
 * WHAT IT IS WRITTEN AGAINST. The operator builds and runs this from Jordan,
 * whose Personal Data Protection Law No. 24 of 2023 (in force 17 March 2024)
 * defines a controller as any person "located inside or outside the Kingdom"
 * who has the data in their custody — it follows the person, not the servers.
 * The users are largely in the United States and the hosting is there too.
 *
 * Rather than aim at one regime, this states the truth completely, which is
 * substantially what the PDPL, the GDPR and the U.S. state laws each ask for:
 * what is held, why, for how long, who else sees it, that profiling happens,
 * how to exercise rights, who to contact, and what happens after a breach.
 *
 * It should still be read by a lawyer if that ever becomes affordable.
 *
 * PRIVACY_VERSION is stored with a person's acceptance, separately from the
 * Terms, so a change here can ask again without re-opening that document.
 */

export const PRIVACY_VERSION = "2026-08-31.1";
export const PRIVACY_EFFECTIVE_DATE = "August 31, 2026";

/** The one human answerable for the data. Named, because the law asks for one. */
export const PRIVACY_CONTACT_EMAIL = "ayeandnay1776@gmail.com";

export interface PrivacySection {
  heading: string;
  paragraphs: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: "1. The short version",
    paragraphs: [
      `We collect as little as we can and still work, we do not sell it, and closing your account really deletes it. This page says exactly what "as little as we can" means, in full, without hiding anything behind "and other information".`,
      `Effective ${PRIVACY_EFFECTIVE_DATE}. AYE & NAY is built and operated by one person. That person is the data controller and can be reached at ${PRIVACY_CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: "2. What we hold about you",
    paragraphs: [
      `When you create an account: your name, a username you choose, your email address, and whether that email has been verified. If you fill them in, an optional short bio and an optional location you type yourself. A profile picture if you set one.`,
      `As you use the Platform: the positions you take on laws, the posts and replies you write, who you follow, who you have lent your voice to, direct messages you send, media you upload, reports and bug reports you file, and the records of any Article IV or Article V proceeding you take part in.`,
      `Technical records kept to run the service: your account's sessions so you stay signed in, and rate-limiting counters so one account cannot flood the Platform.`,
      `If you look up your congressional district, we use the ZIP code you enter to find it and then discard the ZIP. We keep the district, not the ZIP, and never the street address — we do not ask for one.`,
    ],
  },
  {
    heading: "3. What we deliberately do not collect",
    paragraphs: [
      `We do not ask for, and cannot check, your legal identity or your nationality. Amendment IV of our own Constitution forbids it, and nothing in the code requests it.`,
      `We do not collect a home address. We do not keep your ZIP code. We do not track you across other websites, and there is no advertising network in the Platform.`,
      `We never see your password. It is stored as a one-way hash, which means it cannot be read by us, by anyone holding a copy of the database, or by anyone at all.`,
    ],
  },
  {
    heading: "4. Why we hold it, and on what basis",
    paragraphs: [
      `Your account details exist so you can sign in and so other people can see who is speaking. Your positions, posts and replies exist because publishing them is the purpose of the Platform. Your email exists to verify the account, to let you recover it, and to send the notifications you have not turned off.`,
      `The basis is your agreement: you accepted these terms when you created the account, and you can withdraw that agreement at any time by closing it. For the small number of things we must keep to run safely — a rate-limit counter, an audit record of an action taken against an account — the basis is our legitimate need to operate the Platform and to be accountable for it.`,
    ],
  },
  {
    heading: "5. The feed is personalised, and that is profiling",
    paragraphs: [
      `We build a profile of what you engage with and use it to order your feed. It reads which laws you have voted on, which categories you spend time in, and which posts you like, comment on or scroll past. This is profiling, and we are naming it rather than describing it as "personalisation" and leaving it there.`,
      `It changes the ORDER of what you see. It does not change any vote, any count, or any published figure, and it never decides anything about you — no score derived from it affects what you are allowed to do.`,
      `You can object. Tell us at ${PRIVACY_CONTACT_EMAIL} and we will turn it off for your account, and you will get an unranked chronological feed instead.`,
    ],
  },
  {
    heading: "6. Where it is stored",
    paragraphs: [
      `The Platform's servers and database are in the United States. The operator works from Jordan and accesses the administration console from there. If you are outside the United States, using the Platform means your information is stored and processed there, under United States law, and you are agreeing to that by creating an account.`,
    ],
  },
  {
    heading: "7. Who else receives anything",
    paragraphs: [
      `We do not sell your personal information, and we do not share it for anyone else's advertising. The only outside services that receive anything are the ones needed to make the Platform work, and each receives only what its job requires:`,
      `Our hosting and database providers store everything described above, because that is what hosting is. Our email provider receives your email address and the message, so that verification codes, password resets and notifications can reach you. Our bot-check provider receives a one-time token from your browser at sign-up, to confirm a person and not a script is signing up; it does not receive your name or email.`,
      `Our media storage holds any image you upload. Our AI provider receives the published text of a law in order to write a Citizen's Brief about it — it never receives your name, your email, your votes, or anything you have written.`,
      `We read from public government sources (congress.gov, the Federal Register, CourtListener) to get the laws themselves. Nothing about you is sent to them.`,
      `We will disclose information if we are legally required to. If that ever happens and we are permitted to tell you, we will.`,
    ],
  },
  {
    heading: "8. Business accounts and published figures",
    paragraphs: [
      `Organisations can buy access to aggregate figures about Platform activity — how many people supported a bill, how a category is trending. These are counts, never individuals.`,
      `A figure covering fewer than the privacy floor of people is not published at all: the Platform prints a withheld notice and drops the number rather than rounding it, because a rounded number about four people can still identify them. The one exception is a law's own tally, which is public on its card by design.`,
      `Business accounts cannot see who you are, what you voted, or what you wrote beyond what is already public on the Platform.`,
    ],
  },
  {
    heading: "9. What other people can see",
    paragraphs: [
      `Your profile, your posts and your replies are public. Your username and picture appear beside them.`,
      `Your votes are public by default, and the first time you vote we ask whether you want that vote anonymous. An anonymous vote is counted in the total but is not attributed to you anywhere another person can reach.`,
      `Your direct messages are visible to you and the person you sent them to, and to nobody else. There is no administrative screen anywhere in the Platform that reads them.`,
      `Jury deliberations name the jurors to each other and to the record, so a verdict can be inspected afterwards, as Article IV requires.`,
    ],
  },
  {
    heading: "10. How long we keep it",
    paragraphs: [
      `While your account is open, we keep what is described above so the Platform can work.`,
      `When you close your account it is erased — not hidden, not marked deleted. Your posts, replies, messages, votes, delegations, media, trust score and record all go, and your votes come out of the counts they were part of. We keep no copy and there is no undo.`,
      `Two things survive, and both are stated on the closing screen before you confirm. Proceedings that have already concluded keep their outcome, with your name removed — a verdict other people took part in is not one person's to undo. And if you are a party to a proceeding that is still live, your account is closed immediately but your profile stays visible to the people voting or being judged alongside you until it is decided, and is erased the moment it is.`,
    ],
  },
  {
    heading: "11. Your rights",
    paragraphs: [
      `You can see what we hold: most of it is on your profile and in your record, and you can ask us for the rest.`,
      `You can correct your name, username, bio and location yourself in settings, at any time.`,
      `You can delete your account yourself in settings. It is genuine erasure, as described above.`,
      `You can withdraw your agreement by closing your account, object to the profiling described in section 5, ask for a copy of your information, or ask us to limit what we do with it. Write to ${PRIVACY_CONTACT_EMAIL} and we will answer.`,
      `If you think we have got something wrong, tell us first — but you are also entitled to complain to the data protection authority where you live.`,
    ],
  },
  {
    heading: "12. Keeping it safe, and what happens if we fail",
    paragraphs: [
      `Passwords are stored as one-way hashes. Connections use HTTPS. Administrative access requires a separate sign-in from the ordinary account, and every action taken through it is written to an activity log with the name of the person who took it.`,
      `No system is perfectly safe, and a policy that claims otherwise is lying. If there is a breach that could seriously affect you, we will tell you within 24 hours of finding it, say what happened and what to do about it, and notify the relevant authority within 72 hours.`,
    ],
  },
  {
    heading: "13. Children",
    paragraphs: [
      `The Platform is for adults. The Terms of Use require you to be at least 18, or the age of majority where you live if that is older, and this policy follows that same line rather than setting a different one. We do not knowingly collect information from anyone below it, and if we learn we have, the account and everything on it will be deleted.`,
    ],
  },
  {
    heading: "14. Changes to this policy",
    paragraphs: [
      `If we change this policy in a way that matters — a new recipient of your information, a new purpose — we will ask you to read and accept it again rather than assume your old agreement covers it. That is why the version of this document is recorded alongside your acceptance.`,
      `Smaller corrections, such as making a sentence clearer, will be made without re-asking, and the effective date at the top will change.`,
    ],
  },
  {
    heading: "15. Contact",
    paragraphs: [
      `AYE & NAY is built and run by one person, who is the data controller and the contact for anything on this page: ${PRIVACY_CONTACT_EMAIL}.`,
      `This policy was written without a lawyer. It is accurate about how the Platform actually works, which is what we can promise; it is not a substitute for legal advice, and it will be reviewed by counsel when that becomes possible.`,
    ],
  },
];
