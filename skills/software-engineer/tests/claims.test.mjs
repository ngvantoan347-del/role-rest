#!/usr/bin/env node
/**
 * claims.test.mjs - tests for tests/claims.mjs.
 *
 * claims.mjs is the check that stops the prose from describing scripts that no longer exist. A
 * checker that can pass on a drifted repo is worse than no checker, because it buys the exact
 * confidence the repo is against. So each rule is proved by making it fire.
 *
 * Every case copies the real skill to a temp directory, breaks one thing on purpose, and asserts
 * the specific problem named. A test that only proves the check returns 0 would pass on a check
 * that never checks anything.
 *
 * Usage: node tests/claims.test.mjs
 */

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { createRunner } from "./harness.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const skillRoot = join(here, "..")
const CLAIMS = join(here, "claims.mjs")

const { test, runAll } = createRunner("claims.mjs")

const dirs = []
const realSkill = () => {
  const dir = mkdtempSync(join(tmpdir(), "se-claims-"))
  dirs.push(dir)
  cpSync(skillRoot, dir, { recursive: true })
  return dir
}
const check = (dir) => {
  const r = spawnSync(process.execPath, [join(dir, "tests", "claims.mjs")], { encoding: "utf8" })
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` }
}
// Every occurrence, not just the first. A half-applied rename leaves the check satisfied by the
// copy nobody was testing, which is how these cases passed while looking like they covered
// something.
const patchAll = (dir, file, from, to) => {
  const p = join(dir, file)
  writeFileSync(p, readFileSync(p, "utf8").split(from).join(to))
}
const patch = (dir, file, from, to) => patchAll(dir, file, from, to)
const expects = (res, needle, why) => {
  if (res.code === 0) throw new Error(`${why}\n  expected failure, got exit 0\n  ${res.out.slice(0, 300)}`)
  if (!res.out.includes(needle)) {
    throw new Error(`${why}\n  expected to name: ${needle}\n  got:\n${res.out.slice(0, 600)}`)
  }
}

test("claims: the shipped skill passes its own check", () => {
  const r = check(realSkill())
  if (r.code !== 0) throw new Error(`the shipped skill must be clean\n${r.out}`)
  if (!r.out.includes("claims ok")) throw new Error(`did not report success\n${r.out.slice(0, 300)}`)
})

test("claims: a flag the script no longer accepts is caught", () => {
  // The incident this whole file exists for. SKILL.md kept naming a renamed flag for two commits
  // while every other test stayed green, because nothing compared the prose to the code.
  const dir = realSkill()
  patch(dir, "SKILL.md", "--list", "--verify-all")
  expects(check(dir), "falsify.mjs has no `--verify-all`", "a stale flag name must be reported")
})

test("claims: a script deleted but still documented is caught", () => {
  const dir = realSkill()
  rmSync(join(dir, "scripts", "falsify.mjs"))
  expects(check(dir), "which does not exist in scripts/", "prose pointing at a missing script must be reported")
})

test("claims: a shipped script nobody documents is caught", () => {
  const dir = realSkill()
  writeFileSync(join(dir, "scripts", "extra.mjs"), "// a new script nobody wrote about\n")
  expects(check(dir), "no prose file mentions it", "an undiscoverable script must be reported")
})

test("claims: an output string the script never prints is caught", () => {
  const dir = realSkill()
  const p = join(dir, "scripts", "falsify.mjs")
  writeFileSync(p, readFileSync(p, "utf8").split('"unchecked"').join('"UNSCORED"'))
  expects(check(dir), "never prints it", "a quoted output string must match the code")
})

test("claims: a mutation id renamed in the code is caught where prose still names it", () => {
  // The direction that actually occurs: prose is written after the code, so a rule gets renamed
  // and the docs keep the old name. The reverse - a prose inventing an id - is deliberately not
  // caught, and that limit is documented in claims.mjs rather than left to be discovered.
  const dir = realSkill()
  patchAll(dir, "scripts/falsify.mjs", 'id: "swallow-error"', 'id: "swallow-the-error"')
  expects(check(dir), "prose names mutation `swallow-error`", "a renamed rule must be reported in prose")
})

test("claims: a script that can no longer return a documented exit code is caught", () => {
  // smells.mjs returns 2 from five call sites. Replacing one proves nothing, which is why this
  // patch replaces every occurrence.
  const dir = realSkill()
  const p = join(dir, "scripts", "smells.mjs")
  writeFileSync(p, readFileSync(p, "utf8").split("process.exit(2)").join("process.exit(0)"))
  expects(check(dir), "but the script never does", "the exit contract must hold both ways")
})

test("claims: a script exiting outside its documented contract is caught", () => {
  const dir = realSkill()
  const p = join(dir, "scripts", "falsify.mjs")
  writeFileSync(p, readFileSync(p, "utf8") + "\nprocess.exit(7)\n")
  expects(check(dir), "does not document", "an undocumented exit code is a trap for CI")
})

test("claims: a raw control byte in a shipped script is caught", () => {
  // Not hypothetical: verify.mjs shipped three NUL bytes inside template literals. grep treated the
  // file as binary and returned nothing for every search, so the audit meant to find stale flag
  // names was itself blind inside the one script most likely to have drifted.
  const dir = realSkill()
  const p = join(dir, "scripts", "smells.mjs")
  writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from([0])]))
  expects(check(dir), "raw control byte", "a byte that blinds grep must be reported")
})

test("claims: the check reports every problem, not just the first", () => {
  const dir = realSkill()
  patch(dir, "SKILL.md", "--list", "--verify-all")
  patch(dir, "SKILL.md", "smells.mjs --changed", "smells.mjs --whole-repo")
  const res = check(dir)
  const count = (res.out.match(/^  - /gm) || []).length
  if (count < 2) throw new Error(`expected both problems named, got ${count}\n${res.out.slice(0, 400)}`)
})

test("claims: the shipped skill has both scripts and prose that pass together", () => {
  // The inverse of every case above. The exit-code rule had a real false positive when it was
  // written: it matched only literal exit(1), so verify.mjs - which returns its failure through
  // exit(failed.length ? 1 : 0) - looked like it could never exit 1, and the check demanded the
  // opposite. That is the failure mode to guard, and it is why this case exists in the file: if
  // the rules start rejecting healthy code, this goes red before anyone skips the check.
  const r = check(realSkill())
  if (r.code !== 0) throw new Error(`a shipped skill must pass cleanly\n${r.out.slice(0, 400)}`)
  if (!/exit contracts/.test(r.out)) throw new Error(`did not verify the exit contracts\n${r.out.slice(0, 300)}`)
})

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* a temp dir that will not delete is not worth failing a test run over */
      }
    }
  }
}
await cleanupAndRun()