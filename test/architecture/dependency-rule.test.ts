import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The dependency rule in CLAUDE.md, as a test rather than a paragraph.
 *
 * It grew one when `reminder-clock.ts` — pure calendar math — was put in
 * `shared/` and seven `domain`/`application` files started importing it. The
 * dependency direction was fine, but `shared/` in this repo means
 * infrastructure, so it read as a violation and a code review flagged it. The
 * fix was `shared-kernel/`; this keeps the distinction from eroding again,
 * which a paragraph alone did not.
 */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const contextFiles = filesUnder("src/contexts");
const inner = contextFiles.filter((p) => p.includes("/domain/") || p.includes("/application/"));

describe("the dependency rule", () => {
  it("has inner layers to check (the sweep is not vacuously empty)", () => {
    // Without this, a glob that stops matching turns every assertion below
    // into a statement about an empty list.
    expect(inner.length).toBeGreaterThan(50);
  });

  it("keeps domain and application out of shared/ and adapters/", () => {
    const offenders = inner.filter((p) => {
      const src = readFileSync(p, "utf8");
      return /from "[^"]*\/shared\/[^"]*"/.test(src) || /from "[^"]*\/adapters\/[^"]*"/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps shared/ free of anything the inner layers would want", () => {
    // The other half: the rule holds trivially if `shared/` is empty or if
    // pure logic quietly moves back in. Everything here must live under a
    // subdirectory named for its infrastructure concern (db/, auth/, ...),
    // never a bare file at the top — that is how `reminder-clock.ts` got in.
    const bare = readdirSync("src/shared").filter((e) => statSync(join("src/shared", e)).isFile());
    expect(bare).toEqual([]);
  });
});
