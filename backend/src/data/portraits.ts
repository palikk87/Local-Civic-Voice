/**
 * EVERY PRESIDENT AND EVERY SUPREME COURT JUSTICE, WITH THEIR FACE, ALREADY HERE.
 *
 * WHY THIS EXISTS. The platform was looking a portrait up over the network every
 * time it met a name it had not stored, and getting rate-limited for it. But the
 * set of people who can ever sign an executive order or write a Supreme Court
 * opinion is CLOSED and SMALL — 45 presidents and 115 justices since 1789.
 * Khalid: "there have only been a limited amount of justices and presidents. go
 * download all the photos of them and store them somewhere that can be reached."
 *
 * So they are here. No lookup, no rate limit, no waiting — a name is answered
 * from memory. The network is only ever asked about somebody NOT on this list,
 * which in practice means a justice or a president who has just taken office.
 *
 * HOW IT WAS BUILT, and why it can be trusted:
 *
 *   THE JUSTICES ARE THE COURT'S OWN LIST. supremecourt.gov publishes "Justices
 *   1789 to Present" with every oath date and service-end date. That federal
 *   list decides WHO is a justice and WHEN they sat.
 *
 *   THE PORTRAITS ARE MATCHED TO A PERSON, NOT A NAME. Each is keyed to a
 *   Wikidata entity — a stable id for the human being — so no name collision is
 *   possible. That mattered: the Library of Congress, searched by name, offered
 *   "Hon. John Roberts" from the 1860 Brady-Handy Collection for the sitting
 *   Chief Justice. A name is not an identifier, and this list never relies on one.
 *
 *   WHERE A SURNAME IS SHARED, THE TERM DECIDES. There have been two Marshalls
 *   and two Harlans. Where a surname belongs to more than one justice, the match
 *   must also agree with the Court's own oath date, which separates John
 *   Marshall (1801) from Thurgood Marshall (1967). Where a surname is unique,
 *   the date is not required — Wikidata often carries the commission date rather
 *   than the oath date, and those differ by days or months for the same person.
 *
 *   AMBIGUITY IS REFUSED, NOT GUESSED. Where more than one person could match,
 *   nobody is recorded. A wrong face on a law is worse than no face.
 *
 * ALL 115 JUSTICES AND ALL 45 PRESIDENTS ARE HERE, each with a portrait.
 * Five justices were missing at first — Blair, Iredell, Shiras, Van Devanter and
 * Powell — because a surname matcher took the last word of a name, so "Powell Jr."
 * keyed on "jr"; Iredell sat under a third position id the query never asked for.
 * The matcher was the bug, not the source, and all five are now recorded.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import portraits from "./portraits.json";

/**
 * THE FACES WE HOLD OURSELVES.
 *
 * The list below records a Commons file for each person, named so anybody can
 * check it. But pointing every reader's browser at Wikimedia for every card is
 * how this platform got rate-limited in the first place — and the rate limit
 * then refused us the downloads too, at 65 of 158.
 *
 * So the files beside this one came from elsewhere, and are named by the entity
 * id of the person in them:
 *
 *   THE JUSTICES, ALL 115, FROM OYEZ (api.oyez.org/justices), which publishes
 *   every justice in the Court's history with a portrait and their term. Each
 *   was matched to this list on surname AND term, because a surname is not an
 *   identifier — there have been two Marshalls and two Harlans. 114 matched
 *   with no ambiguity; the rest were already held.
 *
 *   THE PRESIDENTS FROM THE MILLER CENTER, which names its files by ordinal —
 *   01-george-washington, 22-24-grover-cleveland — so no name matching was
 *   needed at all. The ordinal IS the match.
 *
 *   WILLIAM HENRY HARRISON FROM THE LIBRARY OF CONGRESS, the one man neither
 *   source had, from a plate captioned "9th President of the United States".
 *
 * A person we hold a file for is served from our own address. A person we do
 * not is served from Commons, exactly as before — so this is complete whether
 * the folder holds all of them or none, and gaining a file changes nothing but
 * where the bytes come from. The folder is read once at start-up: a portrait
 * added while the server is running is picked up by the next restart.
 */
const PORTRAIT_DIR = join(import.meta.dir, "portraits");

function heldLocally(qid: string, fallback: string): string {
  if (!existsSync(join(PORTRAIT_DIR, `${qid}.jpg`))) return fallback;
  const base = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/portraits/${qid}.jpg`;
}

export interface StoredPortrait {
  name: string;
  photoUrl: string;
}

export interface JusticePortrait extends StoredPortrait {
  /** The day they took the judicial oath, from supremecourt.gov. */
  oath: string;
  /** The day their service ended; null while still sitting. */
  end: string | null;
  /** The Wikidata entity this portrait belongs to — the person, not the name. */
  qid: string;
}

export interface PresidentPortrait extends StoredPortrait {
  /**
   * 1 for Washington, 47 for the current term. This list holds TERMS, not
   * people: Cleveland and Trump each served twice non-consecutively, so 47
   * ordinals cover 45 men. Only a list of terms can answer "who held the
   * office on this day", which is the question an executive order asks.
   */
  ordinal: number;
  start: string;
  qid: string;
}

export const JUSTICE_PORTRAITS: JusticePortrait[] = portraits.justices.map((j) => ({
  ...j,
  photoUrl: heldLocally(j.qid, j.photoUrl),
}));
export const PRESIDENT_PORTRAITS: PresidentPortrait[] = portraits.presidents.map((p) => ({
  ...p,
  photoUrl: heldLocally(p.qid, p.photoUrl),
}));

/**
 * Surname plus first initial, lowercased — the same shape the rest of the
 * platform matches names on.
 *
 * Sources disagree about middle names and suffixes for the same person: the
 * Federal Register says "Donald J. Trump", CourtListener says "John G. Roberts",
 * the Court's own roster says "John G. Roberts Jr.". Surname plus first initial
 * survives all three.
 */
export function surnameOf(full: string): string | null {
  const cleaned = full
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^A-Za-z\s]/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]!.toLowerCase() : null;
}

function key(full: string): string | null {
  const cleaned = full
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^A-Za-z\s]/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 1]!.toLowerCase()}|${parts[0]![0]!.toLowerCase()}`;
}

/** Built once at import. 160 people is nothing to hold in memory. */
const byKey = new Map<string, string>();
for (const person of [...PRESIDENT_PORTRAITS, ...JUSTICE_PORTRAITS]) {
  const k = key(person.name);
  // First wins, and both lists are deduped, so this is only ever a genuine
  // collision between a president and a justice sharing a surname and initial.
  // Recording neither is the safe answer; recording the first is not. So skip.
  if (!k) continue;
  if (byKey.has(k) && byKey.get(k) !== person.photoUrl) {
    byKey.set(k, "");
    continue;
  }
  byKey.set(k, person.photoUrl);
}

/** Sorted once at import so the walk below can stop at the first later term. */
const TERMS_IN_ORDER = [...PRESIDENT_PORTRAITS].sort((a, b) => a.start.localeCompare(b.start));

/**
 * WHO WAS PRESIDENT ON THIS DAY.
 *
 * Every executive order was signed by somebody, and the order carries the date
 * it was signed. That is the whole answer — no lookup, no network, no source to
 * be rate-limited by. The Federal Register names the signer too, and where it
 * has, that name is kept; this is for the fifteen hundred orders where it did
 * not, and for every one still to come.
 *
 * A term runs from its start until the next term begins, which is what the
 * handovers actually look like: Clinton signs through 18 January 2001, Bush
 * from the 29th, and an order signed ON an inauguration day belongs to the
 * president being sworn in — Trump's first order is dated 20 January 2017.
 */
export function presidentOn(when: Date | string | null | undefined): PresidentPortrait | null {
  if (!when) return null;
  const day = typeof when === "string" ? when.slice(0, 10) : when.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  let held: PresidentPortrait | null = null;
  for (const term of TERMS_IN_ORDER) {
    if (term.start > day) break;
    held = term;
  }
  return held;
}

/**
 * THE PORTRAIT OF THE JUSTICE WHO WAS SITTING ON THIS DAY.
 *
 * A surname and a first initial cannot separate Samuel Chase (1796) from
 * Salmon Portland Chase (1864), so `storedPortrait` refuses both rather than
 * guess — right, but it costs two real men their faces on a bench we hold both
 * photographs for. Marbury v. Madison rendered with five faces and a gap.
 *
 * The bench knows something the name does not: the DAY. A justice's term is
 * the thing that tells the two Chases apart, and the two Marshalls, and the
 * two Harlans. Where a date is known, this uses it and the ambiguity is gone.
 *
 * Still refuses rather than guesses: if a surname somehow matched two people
 * who BOTH sat that day, nobody is returned.
 */
export function justicePortraitOn(
  name: string | null | undefined,
  servedOn: Date | string | null | undefined,
): string | null {
  const surname = name ? surnameOf(name) : null;
  if (!surname || !servedOn) return null;

  const day =
    typeof servedOn === "string" ? servedOn.slice(0, 10) : servedOn.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const sitting = JUSTICE_PORTRAITS.filter(
    (j) => surnameOf(j.name) === surname && j.oath <= day && (!j.end || j.end >= day),
  );
  if (sitting.length !== 1) return null;

  /*
   * THE DATE NARROWS; IT DOES NOT OVERRULE.
   *
   * Asked for "Samuel Chase" on a day in 1870, the surname and the date alone
   * would hand back SALMON Chase — the only Chase sitting — which is a wrong
   * face, and a wrong face is worse than none. In the bench this cannot
   * happen, because the name and the day come off the same row; it can happen
   * to anyone else who calls this. So the given name has to agree too.
   */
  const given = (full: string) =>
    (/^[A-Za-z]+/.exec(full.trim())?.[0] ?? "").toLowerCase();
  const asked = given(name!);
  const found = given(sitting[0]!.name);
  // An initial is not enough: Samuel and Salmon Chase share one. Compared as
  // whole names, allowing one to be a shortening of the other ("Ben" for
  // "Benjamin"), which is how sources differ about the same man.
  if (asked && found && !asked.startsWith(found) && !found.startsWith(asked)) return null;

  return sitting[0]!.photoUrl;
}

/**
 * The stored portrait for a president or a justice, or null if we do not hold
 * one — in which case the caller may go and look, once, and add them.
 */
export function storedPortrait(name: string | null | undefined): string | null {
  const k = name ? key(name) : null;
  if (!k) return null;
  const found = byKey.get(k);
  // An empty string is the marker for "two different people match this" — see
  // above. Ambiguity is refused, never guessed.
  return found ? found : null;
}
