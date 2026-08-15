// Fails if any working-tree change to a Dart/TS file altered anything other
// than comments. Compares the comment-stripped, whitespace-normalized form of
// HEAD's version against the working tree's version, file by file.
//
// Defaults to scanning the repo this script lives in (found by walking up
// from the script's own location to the nearest .git), so it works
// unmodified after being copied into another repo. Pass one or more repo
// dirs as arguments to override.
//
// The .dart|.ts regex below matches both extensions even though a given
// repo only has one of them, so the frontend (life-os, Dart) and backend
// (life-os-backend, TS) copies can stay byte-for-byte identical.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton } from "./code-skeleton.mjs";

function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not find repo root above ${startDir}`);
    }
    dir = parent;
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repos = process.argv.length > 2 ? process.argv.slice(2) : [findRepoRoot(scriptDir)];

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });

let violations = 0;
let checked = 0;

for (const repo of repos) {
  const names = git(repo, ["diff", "HEAD", "--name-only"])
    .split("\n")
    .filter((n) => /\.(dart|ts)$/.test(n));

  for (const name of names) {
    checked += 1;
    const path = `${repo}/${name}`;
    let before;
    try {
      before = git(repo, ["show", `HEAD:${name}`]);
    } catch {
      console.log(`NEW FILE (not a comment-only change): ${name}`);
      violations += 1;
      continue;
    }
    if (!existsSync(path)) {
      console.log(`DELETED FILE (not a comment-only change): ${name}`);
      violations += 1;
      continue;
    }
    const after = readFileSync(path, "utf8");
    const a = skeleton(before);
    const b = skeleton(after);
    if (a !== b) {
      violations += 1;
      const al = a.split("\n");
      const bl = b.split("\n");
      const at = al.findIndex((l, i) => l !== bl[i]);
      console.log(`CODE CHANGED: ${name}`);
      console.log(`  HEAD: ${al[at] ?? "<end of file>"}`);
      console.log(`  NOW : ${bl[at] ?? "<end of file>"}`);
    }
  }
}

console.log(`${checked} changed file(s) checked, ${violations} violation(s).`);
process.exit(violations === 0 ? 0 : 1);
