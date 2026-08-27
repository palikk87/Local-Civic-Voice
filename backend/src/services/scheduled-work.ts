/**
 * Recurring work that actually recurs.
 *
 * THE BUG THIS EXISTS TO KILL. Five background jobs were registered with
 * `setInterval` alone, on intervals of four, six, twelve and twenty-four hours.
 * A container restarts on every deploy, and on a day of active work that is
 * several times an hour — so a job whose first run is four hours away never
 * runs at all. Not rarely. Never.
 *
 * It is silent, because an interval that never fires raises nothing: no error,
 * no log line, no failed check. The only visible symptom is data that quietly
 * does not converge — 205 of 255 stored bills with no sponsor and no
 * introduced date, weeks after the filler that populates them was written and
 * tested and shipped.
 *
 * This project has already paid for this exact lesson once. From index.ts,
 * about the roll-call ingest: "The ingest existed and had tests, but it lived
 * only in scripts/sync-roll-calls.ts, so it ran when somebody typed the
 * command — which nobody ever did... An ingest with no schedule is an ingest
 * that does not exist." A schedule longer than the process's own life is the
 * same sentence with an extra step.
 *
 * THE STAGGER IS THE SAFETY, and it is why this is not simply "run it at
 * boot". The original code had a real concern behind it — a container in a
 * restart loop must not spend a government API's courtesy budget re-running
 * the same sweep every ninety seconds. A container that is crash-looping does
 * not survive minutes, so a first run placed minutes out is never reached by
 * one, while a healthy container reaches it once and then settles onto its
 * interval. Different jobs get different delays so a single boot does not fire
 * everything at once.
 */

export interface ScheduledJob {
  /** Appears in the log line, so a run can be traced to a name. */
  name: string;
  /** How long after boot the first run happens. */
  firstRunAfterMs: number;
  /** How often after that. */
  everyMs: number;
  run: () => Promise<unknown>;
}

/**
 * Start a job so that it runs shortly after boot AND on its interval.
 *
 * Never throws: a failed sweep is a gap that waits for the next one, not a
 * reason to take an API down. The timer is unref'd so it can never be the
 * thing keeping a process alive.
 */
export function schedule(job: ScheduledJob): void {
  const once = (trigger: string) => {
    void job
      .run()
      .catch((error) => console.error(`[${job.name}] ${trigger} run failed:`, error));
  };

  setTimeout(() => once("first"), job.firstRunAfterMs).unref?.();
  setInterval(() => once("scheduled"), job.everyMs);
}

/**
 * Staggered first-run delays, in one place so nobody has to reason about
 * whether two jobs will collide on a cold start.
 */
export const FIRST_RUN = {
  /** Already skips itself if it ran successfully in the last six hours. */
  governmentSync: 30_000,
  /** Cheap, local, and the one with a visible backlog. */
  provenance: 60_000,
  /**
   * Early, and entirely local. It closes Article V proceedings whose week has
   * run out, and an unclosed proceeding blocks the next one from being brought
   * against the same person — so a late sweep is a right nobody can exercise.
   */
  impeachment: 75_000,
  /**
   * Also local, and also a clock nobody else is watching. It closes a reset
   * vote when its two weeks are up and runs one whose 48-hour notice period has
   * elapsed — a reset that was announced for Tuesday and does not happen is the
   * platform breaking a promise it made to every account at once.
   */
  systemReset: 80_000,
  /** One local pass plus a few calls. */
  selfHeal: 90_000,
  /** Reads congress.gov lineage for stored records. */
  lineage: 3 * 60_000,
  /** Merges only on evidence, and every merge is reversible. */
  merge: 4 * 60_000,
  /** The heaviest courtesy cost: a few hundred spaced requests. */
  rollCall: 5 * 60_000,
  /**
   * Last, because it is the only one with a finish line — everything else has
   * to be responsive, this only has to arrive.
   */
  executiveOrderArchive: 6 * 60_000,
} as const;
