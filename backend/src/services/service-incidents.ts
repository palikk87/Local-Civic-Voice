/**
 * WHAT IS BROKEN, WHAT IS CARRYING IT, AND HAS ANYBODY SEEN IT.
 *
 * WHY THIS EXISTS, in the owner's words: "whatever is happening keeps
 * happening again and makes it fail. there needs to be redundancies in place",
 * and "when the initial method fails its reported to the admin and falls back
 * on the redundancy til I've had time to address the initial failure."
 *
 * A FALLBACK NOBODY IS TOLD ABOUT IS A SLOW SECRET. The platform can quietly
 * run on its safety net for weeks, getting worse answers, and the first anybody
 * hears of it is when the safety net goes too. So falling back is not a silent
 * success: it opens a row here, and the row stays open until a person clears
 * it.
 *
 * ONE ROW PER DISTINCT FAILURE. A dead model fails on every request; writing a
 * line each time would bury the one fact that matters under ten thousand copies
 * of itself. The same failure updates a counter and a timestamp.
 *
 * NOTHING SENSITIVE GOES IN. The detail is the provider's own error text,
 * trimmed — never a key, never a prompt, never a citizen's words.
 *
 * IT NEVER THROWS. This records that something failed; if it cannot, the thing
 * it was recording still has to work. A brief must not fail because the note
 * about the brief failing could not be written.
 */

import { prisma } from "../prisma";

/** The kinds in use. A string, not an enum, so a new one needs no migration. */
export const INCIDENT_AI_MODEL = "ai_model_unusable";
export const INCIDENT_AI_ALL_FAILED = "ai_all_models_failed";

export interface IncidentReport {
  kind: string;
  /** What failed: a model name, a provider, a host. */
  subject: string;
  /** What is carrying the load instead, if anything. */
  fallback?: string | null;
  detail: string;
}

/**
 * Record a failure the platform is working around.
 *
 * Re-opens an acknowledged incident: "I have seen this" is not "this has
 * stopped", and an incident that recurs after being cleared is news again.
 */
export async function reportIncident(report: IncidentReport): Promise<void> {
  const detail = report.detail.slice(0, 1_000);
  try {
    await prisma.serviceIncident.upsert({
      where: { kind_subject: { kind: report.kind, subject: report.subject } },
      create: {
        kind: report.kind,
        subject: report.subject,
        fallback: report.fallback ?? null,
        detail,
      },
      update: {
        lastSeenAt: new Date(),
        occurrences: { increment: 1 },
        fallback: report.fallback ?? null,
        detail,
        // Re-open. The counter keeps climbing so "acknowledged and came back
        // twice" is distinguishable from "acknowledged and stayed fixed".
        acknowledgedAt: null,
        acknowledgedBy: null,
      },
    });
  } catch (error) {
    // Deliberately swallowed — see the header. Logged so it is not invisible.
    console.error("[incident] could not be recorded:", error);
  }
}

export interface OpenIncident {
  id: string;
  kind: string;
  subject: string;
  fallback: string | null;
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

/**
 * What is still broken. Open ones first, then recently acknowledged, so the
 * panel shows both "deal with this" and "you dealt with this and it is quiet".
 */
export async function listIncidents(limit = 50): Promise<OpenIncident[]> {
  try {
    const rows = await prisma.serviceIncident.findMany({
      orderBy: [{ acknowledgedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      subject: row.subject,
      fallback: row.fallback,
      detail: row.detail,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      occurrences: row.occurrences,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: row.acknowledgedBy,
    }));
  } catch (error) {
    console.error("[incident] could not be listed:", error);
    return [];
  }
}

/** How many are open. For a badge on the admin tab. */
export async function openIncidentCount(): Promise<number> {
  try {
    return await prisma.serviceIncident.count({ where: { acknowledgedAt: null } });
  } catch {
    return 0;
  }
}

/** A person has seen it. It re-opens by itself if it happens again. */
export async function acknowledgeIncident(id: string, who: string): Promise<boolean> {
  try {
    await prisma.serviceIncident.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: who },
    });
    return true;
  } catch {
    return false;
  }
}
