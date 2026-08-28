/**
 * The Integrity Audit, as the client sees it — Constitution Article III §2.
 *
 * AN AUDIT COUNTS; IT NEVER NAMES. Nothing in these shapes carries a person:
 * every finding is a title, a status, a sentence and some counts. If a name
 * ever appears on an audit screen, it did not come from here.
 *
 * There is no default, no placeholder and no sample audit in this file. When
 * nothing has been audited the answer is an empty list, and the page says so
 * rather than showing an example.
 */

import { api } from "./api";

export type AuditSubjectType = "reference" | "leader" | "impeachment" | "reset";

export type FindingStatus = "ok" | "attention" | "withheld";

export interface AuditFinding {
  id: string;
  title: string;
  status: FindingStatus;
  /** One plain sentence. Never a name, never an accusation. */
  summary: string;
  /** The numbers behind the sentence. Empty when the finding is withheld. */
  detail: Record<string, number>;
}

export interface IntegrityAudit {
  id: string;
  subjectType: AuditSubjectType;
  subjectId: string;
  runAt: string;
  /** True when at least one finding is worth a person reading. Not an accusation. */
  flagged: boolean;
  findings: AuditFinding[];
  /** True when the platform ran it itself, on an impeachment filing. */
  automatic: boolean;
}

export interface AuditRules {
  subjectTypes: AuditSubjectType[];
  cooldownMs: number;
  /**
   * The privacy floor, read from the server rather than typed here. A screen
   * that hardcoded its own number would eventually explain a withheld finding
   * with a threshold the server had stopped using.
   */
  privacyFloor: number;
}

/**
 * The numbers, spelled out for a reader.
 *
 * `detail` keys are camelCase because they are data; nobody should read
 * "largestSingleHour" on a page. This turns the key into words and is the only
 * place that mapping lives.
 */
export const DETAIL_LABELS: Record<string, string> = {
  publishedSupport: "Published in favour",
  publishedOppose: "Published against",
  recountedSupport: "Counted in favour",
  recountedOppose: "Counted against",
  votesCast: "Votes cast",
  peopleWhoVoted: "People who voted",
  delegatedVoice: "Voice lent by others",
  totalVoice: "Total voice",
  people: "People",
  underOneWeek: "Accounts under a week old",
  underOneMonth: "Accounts under a month old",
  underThreeMonths: "Accounts under three months old",
  olderThanThreeMonths: "Accounts over three months old",
  largestSingleDay: "Most in one day",
  shareOfPeople: "Share of people (%)",
  votes: "Votes",
  largestSingleHour: "Most in one hour",
  shareOfVotes: "Share of votes (%)",
  delegators: "People lending their vote",
  shareInLargestHour: "Share in that hour (%)",
  circularChains: "Circular chains",
  shortestChain: "Shortest chain",
  votedInLastMonth: "Voted in the last month",
  quietForAMonth: "Quiet for a month",
  quietShare: "Quiet share (%)",
  entitledToVote: "Entitled to vote",
  voted: "Voted",
};

export function detailLabel(key: string): string {
  return DETAIL_LABELS[key] ?? key;
}

/** What the whole audit amounts to, in one line, without accusing anybody. */
export function auditHeadline(audit: IntegrityAudit): string {
  const attention = audit.findings.filter((f) => f.status === "attention").length;
  const withheld = audit.findings.filter((f) => f.status === "withheld").length;
  if (attention === 0 && withheld === 0) return "Nothing here needs a second look.";
  if (attention === 0) return "Nothing here needs a second look. Some figures are withheld.";
  return `${attention} thing${attention === 1 ? "" : "s"} worth reading. An audit reports patterns; it does not accuse.`;
}

export const audits = {
  rules: () => api.get<AuditRules>("/api/audits/rules"),
  byId: (id: string) => api.get<{ audit: IntegrityAudit }>(`/api/audits/${id}`),
  history: (subjectType: AuditSubjectType, subjectId: string) =>
    api.get<{ audits: IntegrityAudit[] }>(`/api/audits/subject/${subjectType}/${subjectId}`),
  /** Article III's word is "demand": no approval, no queue, no administrator. */
  demand: (subjectType: AuditSubjectType, subjectId: string) =>
    api.post<{ audit: IntegrityAudit; reused: boolean }>("/api/audits", {
      subjectType,
      subjectId,
    }),
};
