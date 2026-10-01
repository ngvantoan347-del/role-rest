#!/usr/bin/env node
/**
 * falsify.test.mjs - tests for scripts/falsify.mjs.
 *
 * falsify.mjs rewrites the working tree to prove a claim. That makes it the highest-consequence
 * script in the skill: if it restores badly it corrupts work that exists nowhere else. So the
 * tests check three things in order - it finds real gaps, it does not cry wolf, and it gives the
 * tree back byte for byte.
 *
 * Usage: node tests/falsify.test.mjs
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FALSIFY, cleanup, createRunner, eq, gitIn, has, hasNot, repo, run } from "./harness.mjs"

const { test, runAll } = createRunner("falsify.mjs")

const PKG = JSON.stringify({ name: "t", type: "module", scripts: { test: "node --test" } })

// Two guards and one boolean boundary. The "happy path only" suite leaves both guards untested,
// which is the case the tool exists to name.
const SRC = 'export function charge(user, amount) {\n  if (amount <= 0) throw new Error("bad")\n  if (user.balance < amount) throw new Error("short")\n  return { ok: true }\n}\n'
const WEAK_TEST = "import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { charge } from './src.js'\ntest('charges', () => { assert.deepEqual(charge({balance:100}, 10), {ok:true}) })\n"
const FULL_TEST =
  WEAK_TEST +
  "test('rejects non-positive', () => { assert.throws(() => charge({balance:100}, 0)) })\n" +
  "test('rejects insufficient', () => { assert.throws(() => charge({balance:5}, 10)) })\n"

test("falsify: an untested guard is reported as a surviving break", () => {
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": WEAK_TEST })
  r.write("src.js", SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n")
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 1, "a surviving break is not a pass")
  has(res.out, "SURVIVED", "names the surviving break: " + res.out.slice(0, 200))
  has(res.out, "no test", "states the consequence")
})

test("falsify: covering the guards turns the same change green", () => {
  // The point of the tool in one test: same code, same mutation, opposite verdict - and the
  // difference is only that the tests now say what the guards do.
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": FULL_TEST })
  r.write("src.js", SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n")
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 0, "load-bearing tests pass falsification: " + res.out.slice(-300))
  has(res.out, "load-bearing", "says the claim now has evidence")
})

test("falsify: the tree is restored byte for byte", () => {
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": WEAK_TEST })
  r.write("src.js", SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n")
  const before = readFileSync(join(r.dir, "src.js"), "utf8")
  run(FALSIFY, [], r.dir)
  eq(readFileSync(join(r.dir, "src.js"), "utf8"), before, "src.js unchanged")
  const st = gitIn(r.dir, ["status", "--porcelain"])
  has(st.out, "M src.js", "the change is still there, uncommitted, exactly as the user left it")
})

test("falsify: a clean tree says why, not just that there is nothing", () => {
  // "Nothing to check" is not an answer to either reason. A clean tree and a docs-only change
  // need different responses, so the tool distinguishes them.
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": FULL_TEST })
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 1, "an unfalsified claim is not a pass")
  has(res.out, "clean", "explains that the tree is clean: " + res.out.slice(0, 200))
})

test("falsify: a docs-only change is reported as such", () => {
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": FULL_TEST, "README.md": "# x\n" })
  r.write("README.md", "# x\nmore\n")
  const res = run(FALSIFY, [], r.dir)
  has(res.out, "docs, config, or dependencies", "names what the change actually was")
})

test("falsify: a red suite stops the run rather than blaming the mutants", () => {
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": FULL_TEST })
  r.write("src.js", SRC + "\nexport const x = 1\n")
  writeFileSync(join(r.dir, "src.test.js"), "test('fails on purpose', () => { throw new Error('x') })\n")
  const res = run(FALSIFY, [], r.dir)
  has(res.out, "already fails", "explains that a survivor would prove nothing")
  eq(res.code, 1, "does not report a result from a broken baseline")
})

test("falsify: --list shows the breaks without running the suite", () => {
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": WEAK_TEST })
  r.write("src.js", SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n")
  const res = run(FALSIFY, ["--list"], r.dir)
  has(res.out, "swallow-error", "lists a break that applies")
  hasNot(res.out, "baseline:", "does not run the suite")
})

test("falsify: a repo with no test command is not reported as untested code", () => {
  // A missing runner and an untested branch both look like "the suite did not catch it". They
  // need different responses - install a test command versus write an assertion - so they must
  // not produce the same report. falsify.mjs shipped this bug in ci.mjs and found it here.
  const r = repo({ "src.js": SRC })
  r.write("src.js", SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n")
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 1, "still a failure, for the right reason")
  has(res.out, "no test command", "blames the missing runner: " + res.out.slice(0, 200))
  hasNot(res.out, "SURVIVED", "does not blame the tests for a runner that does not exist")
})

test("falsify: --file narrows the run to one file", () => {
  const r = repo({
    "package.json": PKG,
    "src.js": SRC,
    "other.js": "export const f = (x) => { if (x === 1) return 2 }\n",
    "src.test.js": WEAK_TEST,
  })
  r.write("src.js", SRC + "\nexport const v = 1\n")
  r.write("other.js", "export const f = (x) => { if (x === 1) return 2 }\nexport const g = 1\n")
  const res = run(FALSIFY, ["--file", "src.js"], r.dir)
  hasNot(res.out, "other.js", "only the named file is broken")
})

test("falsify: the reason for each break is stated", () => {
  // A number with no meaning is not actionable. "2 survived" does not tell anyone what to do.
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": WEAK_TEST })
  r.write("src.js", SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n")
  const res = run(FALSIFY, [], r.dir)
  has(res.out, "reports failure as success", "names the failure each break represents")
  has(res.out, "Write the assertion", "says what to do next")
})

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    cleanup()
  }
}
await cleanupAndRun()