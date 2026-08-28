/**
 * The Community Juries, as the client sees it — Constitution Article IV.
 *
 * "Disputes are settled by randomly chosen trusted users."
 *
 * There is no default, no placeholder and no sample case in this file. When
 * nobody has been summoned the answer is an empty list, and the screen says so.
 *
 * NOTHING HERE NAMES A JUROR. The server never sends one: a seat is a state and
 * a timestamp, and only the viewer's own seat is marked. A neighbour who judged
 * honestly must not be findable by the person they judged.
 */

import { api } from "./api";

export type PanelKind = "comment" | "post" | "leader";
export type JuryStatus = "drawing" | "deliberating" | "decided" | "abandoned";
export type Verdict = "upheld" | "dismissed";
export type Ballot = "uphold" | "dismiss";
export type SeatState = "summoned" | "accepted" | "voted" | "lapsed" | "recused";

export interface JuryPerson {
  id: string;
  name: string;
  /** Never an email address. See public-identity. */
  handle: string;
  image: string | null;
}

/** A seat, as the draw record shows it. Only the viewer's own seat is named. */
export interface DrawSeat {
  id: string;
  state: SeatState;
  summonedAt: string;
  answeredAt: string | null;
  replacesSeatId: string | null;
  isYou: boolean;
}

export interface JuryCase {
  id: string;
  status: JuryStatus;
  verdict: Verdict | null;
  panelKind: PanelKind;
  seats: number;
  votesToDecide: number;
  accusedDelegations: number;
  accusedIsCivilLeader: boolean;
  openedAt: string;
  decidedAt: string | null;

  report: { reason: string; detail: string | null };
  accused: JuryPerson | null;

  post: {
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; name: string; username: string | null; displayUsername: string | null; image: string | null };
    governmentReference: {
      id: string;
      masterReferenceId: string;
      title: string;
      status: string;
      /** The law's citizen brief. Judging on a screenshot is not judging. */
      citizenBrief: string | null;
    } | null;
  } | null;

  comment: {
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; name: string; username: string | null; displayUsername: string | null; image: string | null };
    post: JuryCase["post"];
  } | null;

  draw: DrawSeat[];
  /** The votes and the reasons, once decided. Never attributed to a juror. */
  reasons: Array<{ vote: Ballot; reasoning: string }>;
  tally: { uphold: number; dismiss: number; seated: number };
  /** Withheld until the verdict is in — null while the case is live. */
  priorFindings: number | null;

  viewer: {
    seatState: SeatState | null;
    hasVoted: boolean;
    /** When the platform lets them go if they do nothing. */
    releasedAt: string | null;
    /** When an unanswered summons is redrawn. */
    answerBy: string | null;
  };
}

export interface Summons {
  juryId: string;
  state: SeatState;
  summonedAt: string;
  answerBy: string;
  releasedAt: string | null;
}

export interface JuryRules {
  panels: Record<PanelKind, { seats: number; votesToDecide: number }>;
  civilLeaderDelegations: number;
  summonsWindowMs: number;
  deliberationWindowMs: number;
  minReasoningLength: number;
  maxReasoningLength: number;
  maxRecusalLength: number;
}

/** Reasons a report can be filed under, in words a juror can weigh. */
export const REASON_LABELS: Record<string, string> = {
  misinformation: "Misrepresents a law",
  harassment: "Harassment",
  spam: "Spam",
  hate: "Hate speech",
  violence: "Violence or threats",
  other: "Other",
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** What the panel is, in one line, and why it is that size. */
export function panelSentence(file: JuryCase): string {
  const what =
    file.panelKind === "comment"
      ? "a comment"
      : file.panelKind === "leader"
        ? "a civil leader's post"
        : "a post";
  return `${file.seats} jurors, ${file.votesToDecide} to decide — this is ${what}.`;
}

export const juries = {
  rules: () => api.get<JuryRules>("/api/juries/rules"),
  /** The summonses waiting on you, and whether you are sequestered right now. */
  mine: () => api.get<{ sequesteredBy: string | null; summonses: Summons[] }>("/api/juries/me"),
  case: (id: string) => api.get<{ case: JuryCase }>(`/api/juries/${id}`),
  accept: (id: string) => api.post<{ accepted: boolean; case: JuryCase }>(`/api/juries/${id}/accept`, {}),
  recuse: (id: string, reason: string) =>
    api.post<{ recused: boolean }>(`/api/juries/${id}/recuse`, { reason }),
  verdict: (id: string, vote: Ballot, reasoning: string) =>
    api.post<{ recorded: boolean; decided: boolean; verdict: Verdict | null; tally: { uphold: number; dismiss: number } }>(
      `/api/juries/${id}/verdict`,
      { vote, reasoning },
    ),
};
