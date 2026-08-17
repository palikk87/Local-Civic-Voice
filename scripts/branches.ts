/**
 * What branches exist, and is any of them holding work that main does not have?
 *
 *   bun run branches            report
 *   bun run branches --prune    delete every branch whose work is already on main
 *
 * The companion to `deploy-check`. That one asks whether main is live; this one
 * asks whether anything is stranded short of main. Between them there is no
 * gap: work is on main and deployed, or this says out loud where it is sitting.
 *
 * A branch is only ever reported as MERGED when every commit it carries is
 * already on main. That is deliberately looser than `git branch --merged`,
 * which asks about ancestry alone and so calls a rebased or cherry-picked
 * branch unmerged forever, and stricter than eyeballing the log. The real
 * question is: would deleting this lose a change? Answered by comparing what
 * each commit does — its patch — rather than which commit id it happens to
 * have, so a branch that landed under a different id is correctly seen as
 * landed.
 *
 * --prune only ever deletes MERGED branches. It will not touch main, and it
 * will not touch a branch carrying work of its own, no matter what is asked.
 */

import { execSync } from "node:child_process";

const PRUNE = process.argv.includes("--prune");

function git(command: string): string {
  return execSync(`git ${command}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(command: string): string | null {
  try {
    return git(command);
  } catch {
    return null;
  }
}

/** Branches on the remote, which are the ones that can mislead somebody. */
function remoteBranches(): string[] {
  const raw = tryGit("ls-remote --heads origin");
  if (raw === null) {
    console.error("Could not reach origin. Check the network, then run this again.");
    process.exit(1);
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[1]!.replace("refs/heads/", ""))
    .filter((name) => name !== "main");
}

type Status = "MERGED" | "AHEAD" | "UNKNOWN";

interface Branch {
  name: string;
  sha: string;
  status: Status;
  /** For AHEAD: the commits main does not have. */
  commits: string[];
  /** For AHEAD: how many files differ. */
  files: number;
}

function inspect(name: string): Branch {
  const sha = tryGit(`rev-parse refs/remotes/origin/${name}`) ?? tryGit(`rev-parse ${name}`);
  if (!sha) return { name, sha: "", status: "UNKNOWN", commits: [], files: 0 };

  // Ancestry first: the cheap, unambiguous case.
  const ancestor = (() => {
    try {
      execSync(`git merge-base --is-ancestor ${sha} origin/main`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  if (ancestor) return { name, sha, status: "MERGED", commits: [], files: 0 };

  // Not an ancestor, which is the normal state of rebased and cherry-picked
  // work. `git cherry` compares each commit by what it changes, marking with
  // "-" the ones main already has under some other id and "+" the ones it
  // genuinely does not.
  const cherry = tryGit(`cherry origin/main ${sha}`);
  if (cherry === null) return { name, sha, status: "UNKNOWN", commits: [], files: 0 };

  const unlanded = cherry
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(2).trim());
  if (unlanded.length === 0) return { name, sha, status: "MERGED", commits: [], files: 0 };

  const commits = unlanded.map(
    (id) => tryGit(`log -1 --format='%h %s' ${id}`) ?? id.slice(0, 8),
  );
  const files = new Set(
    unlanded.flatMap(
      (id) =>
        tryGit(`show --name-only --format= ${id}`)
          ?.split("\n")
          .filter(Boolean) ?? [],
    ),
  ).size;
  return { name, sha, status: "AHEAD", commits, files };
}

tryGit("fetch origin --prune --quiet");

const names = remoteBranches();
const mainSha = tryGit("rev-parse origin/main") ?? "";

console.log(`main is at ${mainSha.slice(0, 8)}\n`);

if (names.length === 0) {
  console.log("No branches besides main. Nothing is stranded.");
  process.exit(0);
}

const branches = names.map(inspect);
const merged = branches.filter((b) => b.status === "MERGED");
const ahead = branches.filter((b) => b.status === "AHEAD");
const unknown = branches.filter((b) => b.status === "UNKNOWN");

for (const branch of ahead) {
  console.log(`AHEAD    ${branch.name}`);
  console.log(`         ${branch.commits.length} commit(s), ${branch.files} file(s) not on main:`);
  for (const line of branch.commits.slice(0, 5)) console.log(`           ${line}`);
  if (branch.commits.length > 5) console.log(`           ... and ${branch.commits.length - 5} more`);
  console.log("");
}

for (const branch of merged) console.log(`merged   ${branch.name}`);
for (const branch of unknown) console.log(`?        ${branch.name} — could not read`);
console.log("");

if (PRUNE) {
  if (merged.length === 0) {
    console.log("Nothing safe to delete.");
  } else {
    console.log(`Deleting ${merged.length} branch(es) whose work is already on main.\n`);
    const failures: string[] = [];
    for (const branch of merged) {
      try {
        execSync(`git push origin --delete ${branch.name}`, { stdio: "ignore" });
        console.log(`  deleted  ${branch.name}`);
      } catch {
        failures.push(branch.name);
        console.log(`  FAILED   ${branch.name}`);
      }
    }
    if (failures.length > 0) {
      console.log(
        `\n${failures.length} could not be deleted. If they are protected, remove the` +
          ` protection rule; otherwise re-run — a delete is safe to repeat.`,
      );
    }
    console.log(
      `\nEvery deleted branch's work is on main and its commit id is above, so any of` +
        ` them can be restored with \`git push origin <sha>:refs/heads/<name>\`.`,
    );
  }
  console.log("");
}

if (ahead.length > 0) {
  console.error(
    `${ahead.length} branch(es) carry work that is not on main, and nothing deploys from a\n` +
      `branch. Merge them or delete them — leaving them is how a finished fix stays\n` +
      `invisible.`,
  );
  process.exit(1);
}

if (!PRUNE && merged.length > 0) {
  console.log(
    `All ${merged.length} branch(es) are fully contained in main — clutter, not risk.\n` +
      `Clear them with: bun run branches --prune`,
  );
} else if (merged.length === 0) {
  console.log("Nothing is stranded off main.");
}
