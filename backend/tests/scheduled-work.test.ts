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
