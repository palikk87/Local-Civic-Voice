/**
 * Every recurring job actually recurs.
 *
 * WHAT WENT WRONG. Five background jobs were registered with `setInterval`
 * alone, on intervals of four, six, twelve and twenty-four hours. This
 * container restarts on every deploy — several times an hour on a working day
 * — so a job whose first run is four hours out never reaches it. Not rarely.
 * Never.
 *
 * And it is silent. An interval that never fires logs nothing, throws nothing,
 * and fails no check. The only symptom is data that quietly does not converge:
 * 205 of 255 stored bills with no sponsor and no introduced date, weeks after
 * the filler that populates them shipped with passing tests.
 *
 * This project has paid for this lesson once already, in its own words: "An
 * ingest with no schedule is an ingest that does not exist." A schedule longer
 * than the process's life is the same sentence with an extra step, so it gets
 * a check rather than another fix.
 *
 * READS THE SOURCE rather than the running server, deliberately — the failure
 * is something NOT happening, hours from now, in a process nothing outlives.
 * There is no runtime moment at which it can be observed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INDEX = readFileSync(join(import.meta.dir, "../src/index.ts"), "utf8");

/** Source with comments stripped, so prose about setInterval is not evidence. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("a job's first run has to be reachable", () => {
  test("nothing schedules recurring work with a bare setInterval", () => {
    const body = code(INDEX);

    // schedule() from services/scheduled-work.ts is the one door: it runs the
    // job on a short stagger AND on its interval.
    const bare = [...body.matchAll(/setInterval\(/g)].length;

    // If this fails: use schedule({ name, firstRunAfterMs, everyMs, run }).
    // A bare setInterval means the work first happens one full interval from
    // boot, and this process is very rarely alive that long.
    expect(bare).toBe(0);
  });

  test("every scheduled job runs long before its own interval", async () => {
    const { FIRST_RUN } = await import("../src/services/scheduled-work");

    // The longest stagger is minutes. Anything approaching an hour would put
    // the first run back out of reach of a container's usual life.
    for (const [name, delay] of Object.entries(FIRST_RUN)) {
      expect(delay).toBeGreaterThanOrEqual(30_000); // survives a crash loop
      expect(delay).toBeLessThanOrEqual(10 * 60_000); // reachable in one life
      expect(typeof name).toBe("string");
    }
  });

  test("a job that throws does not stop its schedule or the process", async () => {
    const { schedule } = await import("../src/services/scheduled-work");

    let runs = 0;
    schedule({
      name: "TestJob",
      firstRunAfterMs: 30,
      everyMs: 60_000,
      run: async () => {
        runs++;
        throw new Error("deliberate");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    // It ran, it threw, and we are still here to assert on it.
    expect(runs).toBe(1);
  });

  test("the first run really happens without waiting for the interval", async () => {
    const { schedule } = await import("../src/services/scheduled-work");

    let ran = false;
    schedule({
      name: "TestJob2",
      firstRunAfterMs: 20,
      // An interval far longer than this test, so a run can only have come
      // from the stagger — which is exactly the property that was missing.
      everyMs: 60 * 60_000,
      run: async () => {
        ran = true;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ran).toBe(true);
  });
});

/**
 * SOME WORK HAS AN END, and the schedule has to hear about it.
 *
 * Every other job here is a watcher: it checks something that keeps changing
 * and there is no last time to check. A backfill is not like that. The Federal
 * Register publishes a fixed corpus of past executive orders, and once the
 * oldest is held there is nothing further back — not today, not ever. Left
 * running, that sweep asks a government API the same question every thirty
 * minutes to be told the same thing.
 */
describe("a job that has finished stops being scheduled", () => {
  test("returning FINISHED stops the next run", async () => {
    const { schedule, FINISHED } = await import("../src/services/scheduled-work");

    let runs = 0;
    schedule({
      name: "FinishingJob",
      firstRunAfterMs: 20,
      // Short enough that it would run several more times inside this test if
      // nothing stopped it — which is the whole assertion.
      everyMs: 30,
      run: async () => {
        runs++;
        return FINISHED;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runs).toBe(1);
  });

  test("a job that has NOT finished keeps running", async () => {
    // The other half of the same guard: a sweep with work left must not be
    // silenced by this, or a backfill stops at its first successful batch.
    const { schedule } = await import("../src/services/scheduled-work");

    let runs = 0;
    schedule({
      name: "UnfinishedJob",
      firstRunAfterMs: 20,
      everyMs: 30,
      run: async () => {
        runs++;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runs).toBeGreaterThan(2);
  });

  test("only the sentinel stops it — a truthy result does not", async () => {
    // Why FINISHED is a symbol and not a boolean. A sweep returning `true` to
    // mean "that worked" must never be read as "never run me again".
    const { schedule } = await import("../src/services/scheduled-work");

    let runs = 0;
    schedule({
      name: "TruthyJob",
      firstRunAfterMs: 20,
      everyMs: 30,
      run: async () => {
        runs++;
        return true;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runs).toBeGreaterThan(2);
  });

  test("the archive sweep is the job that uses it", async () => {
    // Reads the source: the behaviour is a request to a government API that
    // does not happen, half an hour from now, and there is no runtime moment at
    // which its absence can be observed.
    const archive = readFileSync(
      join(import.meta.dir, "../src/services/executive-order-archive.ts"),
      "utf8",
    );
    expect(code(archive)).toContain("return FINISHED");
  });

  test("nothing else has quietly stopped scheduling itself", async () => {
    // The two jobs that keep executive orders current must not learn this
    // trick. WhiteHouseOrders reads the day's signings and the nightly Federal
    // Register sync catches the handful the White House feed never carries —
    // three in the last sixteen months. Neither has an end.
    const services = ["executive-order-intake", "executive-order-numbering", "government-sync"];
    for (const name of services) {
      const source = readFileSync(join(import.meta.dir, `../src/services/${name}.ts`), "utf8");
      expect(code(source)).not.toContain("FINISHED");
    }
  });
});
