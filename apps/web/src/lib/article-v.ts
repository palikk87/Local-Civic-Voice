/**
 * Article V, as the client sees it.
 *
 * One module for both remedies, shared by the page and the checks, so the
 * shapes the UI reads are stated once. Every field here is served by the
 * backend from real rows — there is no default, no placeholder and no sample
 * proceeding in this file. When nothing is happening the answer is null, and
 * the page says so.
 */

import { api } from "./api";

export interface ArticleVPerson {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
}

export interface ImpeachmentProceeding {
  id: string;
  status: "open" | "passed" | "expired";
  grounds: string;
  evidence: string;
  leader: ArticleVPerson;
  filedBy: ArticleVPerson | null;
  openedAt: string;
  expiresAt: string;
  suspendedUntil: string | null;
  votes: number;
  electorCount: number;
  viewerHasVoted: boolean;
  viewerProposedDays: number | null;
}

export interface MyProceedings {
  proceedings: ImpeachmentProceeding[];
}

/**
 * One impeachment this person went through and lost.
 *
 * Only ever a PASSED proceeding. An accusation that did not reach two thirds
 * is not a finding against anybody, and is never part of this record.
 */
export interface ImpeachmentRecordEntry {
  id: string;
  grounds: string;
  evidence: string;
  filedBy: ArticleVPerson | null;
  openedAt: string;
  decidedAt: string | null;
  suspendedUntil: string | null;
  /** Whether this is the suspension currently in force, as opposed to a past one. */
  inForce: boolean;
  votes: number;
  electorCount: number;
}

export interface LeaderArticleV {
  leader: ArticleVPerson;
  delegatorCount: number;
  canBeImpeached: boolean;
  /** Kept permanently, newest first. Empty for almost everybody. */
  record: ImpeachmentRecordEntry[];
  suspension: { suspended: boolean; until: string | null; impeachmentId: string | null };
  proceeding: null | {
    id: string;
    status: string;
    grounds: string;
    evidence: string;
    filedBy: ArticleVPerson | null;
    openedAt: string;
    expiresAt: string;
    votes: number;
    electorCount: number;
    threshold: number;
    votesNeeded: number;
    /** Null when signed out — "we do not know" is different from "no". */
    viewerIsElector: boolean | null;
    viewerHasVoted: boolean;
    viewerProposedDays: number | null;
  };
}

export interface ImpeachmentRules {
  windowDays: number;
  threshold: number;
  minSuspensionDays: number;
  maxSuspensionDays: number;
  minArticleLength: number;
  maxArticleLength: number;
}

export interface ResetDisclosure {
  lost: string[];
  kept: string[];
  afterwards: string[];
}

export interface SystemResetState {
  proceeding: null | {
    id: string;
    status: "voting" | "failed" | "scheduled" | "executed";
    grounds: string;
    evidence: string;
    filedBy: ArticleVPerson | null;
    openedAt: string;
    expiresAt: string;
    decidedAt: string | null;
    executeAfter: string | null;
    support: number;
    oppose: number;
    turnout: number;
    eligibleCount: number;
    participation: number;
    approval: number;
    wouldPassOnCurrentNumbers: boolean;
    viewerHasVoted: boolean;
    viewerSupported: boolean | null;
  };
  rules: {
    windowDays: number;
    participationFloor: number;
    approvalThreshold: number;
    disclosureHours: number;
    minArticleLength: number;
    maxArticleLength: number;
  };
  disclosure: ResetDisclosure;
}

export interface Restorable {
  reset: { id: string; executedAt: string | null } | null;
  available: number;
  restored: number;
}

export interface MyDelegation {
  id: string;
  toUser: ArticleVPerson;
  category: string | null;
  isActive: boolean;
  createdAt: string;
}

export const articleV = {
  rules: () => api.get<ImpeachmentRules>("/api/impeachments/rules"),
  myProceedings: () => api.get<MyProceedings>("/api/impeachments/me"),
  forLeader: (userId: string) => api.get<LeaderArticleV>(`/api/impeachments/leader/${userId}`),
  file: (leaderId: string, grounds: string, evidence: string) =>
    api.post<{ impeachmentId: string; electorCount: number; expiresAt: string }>(
      "/api/impeachments",
      { leaderId, grounds, evidence }
    ),
  vote: (impeachmentId: string, proposedDays: number) =>
    api.post<{ votes: number; electorCount: number; passed: boolean }>(
      `/api/impeachments/${impeachmentId}/vote`,
      { proposedDays }
    ),
  withdraw: (impeachmentId: string) =>
    api.delete<{ votes: number; electorCount: number }>(`/api/impeachments/${impeachmentId}/vote`),

  myDelegations: () => api.get<{ delegations: MyDelegation[] }>("/api/delegations/me"),

  reset: () => api.get<SystemResetState>("/api/system-reset"),
  fileReset: (grounds: string, evidence: string) =>
    api.post<{ resetId: string; eligibleCount: number; expiresAt: string }>("/api/system-reset", {
      grounds,
      evidence,
    }),
  voteReset: (resetId: string, support: boolean) =>
    api.post<{ support: number; oppose: number; eligibleCount: number }>(
      `/api/system-reset/${resetId}/vote`,
      { support }
    ),
  withdrawResetVote: (resetId: string) =>
    api.delete<{ support: number; oppose: number }>(`/api/system-reset/${resetId}/vote`),
  restorable: () => api.get<Restorable>("/api/system-reset/my-restorable"),
  restoreMine: () =>
    api.post<{ restored: number; skipped: number }>("/api/system-reset/restore-my-positions"),
};

/** Whole days left, floored at zero. Used for "6 days left" on both remedies. */
export function daysLeft(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Hours left, for the 48-hour notice period where days are too coarse. */
export function hoursLeft(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (60 * 60 * 1000)));
}

export function personLabel(person: ArticleVPerson | null): string {
  if (!person) return "an account that no longer exists";
  return person.username ? `@${person.username}` : person.name;
}
