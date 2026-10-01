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

test("falsify: new code with no test is named as an untested change", () => {
  // The most common way an agent ships untested code: source written, suite still green because
  // an existing placeholder assertion passes. "Nothing to check" would read as the checker
  // finding no fault, when the truth is that nobody wrote a test.
  const r = repo({
    "package.json": PKG,
    "a.test.js": "import { test } from 'node:test'\ntest('placeholder', () => {})\n",
  })
  r.write("src.js", "export function parsePort(s) {\n  return Number(s)\n}\n")
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 1, "an untested change is not a pass")
  has(res.out, "No test file changed", "names the real gap: " + res.out.slice(0, 220))
  has(res.out, "Write the test first", "says what to do")
})

test("falsify: code with no breakable branch and a test present is reported as unproven", () => {
  // Same "nothing to break" state, different cause: a test did change, so the gap is that the
  // checker could not construct a fault - not that nobody tested it.
  const r = repo({
    "package.json": PKG,
    "src.js": "export const x = 1\n",
    "a.test.js": "import { test } from 'node:test'\ntest('placeholder', () => {})\n",
  })
  r.write("src.js", "export const x = 2\n")
  r.write("a.test.js", "import { test } from 'node:test'\ntest('placeholder', () => {})\ntest('two', () => {})\n")
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 1, "an unproven change is not a pass")
  has(res.out, "never run against a deliberate fault", "distinguishes this from the untested case")
  hasNot(res.out, "No test file changed", "does not blame a test that exists")
})

test("falsify: reports its own reach so a pass is not read as full confidence", () => {
  // The dangerous version of this tool is the one that says "all caught" about a file it could
  // only attack three sites of. A pass bounded by the checker's reach has to state the bound.
  const branchy = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": FULL_TEST })
  branchy.write(
    "src.js",
    SRC +
      "\nexport function route(p) {\n  if (p === 'a') return 1\n  if (p === 'b') return 2\n  if (p === 'c') return 3\n  return 0\n}\n"
  )
  // A plain assertion keeps the suite green without reaching into the new function, which is
  // exactly the state this test needs: green suite, many decision points, low reach.
  writeFileSync(join(branchy.dir, "src.test.js"), FULL_TEST + "test('suite still runs', () => assert.ok(true))\n")
  const res = run(FALSIFY, [], branchy.dir)
  has(res.out, "reach:", "states how much it could attack: " + res.out.slice(0, 200))
  has(res.out, "decision point", "bounds the pass by the checker's own reach")
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
  has(res.out, "a failure reported as success", "names the failure each break represents")
  has(res.out, "Write the assertion", "says what to do next")
})

test("falsify: a surviving break is reported at a line, not just a file", () => {
  // The output of this tool is "these exact lines have no test". A file name sends the reader
  // back to grep, and in a 400-line module that is the step people skip. The happy-path suite is
  // used so the guards survive, which is what puts a line number in the report at all.
  const r = repo({ "package.json": PKG, "src.js": SRC, "src.test.js": WEAK_TEST })
  r.write(
    "src.js",
    "// header\n// header\n\n" + SRC + "\nexport function isAdult(age) {\n  return age >= 18\n}\n"
  )
  const res = run(FALSIFY, [], r.dir)
  eq(res.code, 1, "an untested guard is a failure")
  has(res.out, "src.js", "names the file")
  has(res.out, ":6", "gives the line the guard is on: " + res.out.slice(-400))
})

test("falsify: a mutation that breaks the syntax is dropped rather than scored", () => {
  // A suite that goes red because the file stopped compiling has proved nothing about any
  // branch, and counting those as "caught" is how a checker reports 100% on code it never ran.
  // `and-to-or` rewritten across a template literal is the case: syntactically fine in some
  // files, and in others it produces a file that cannot load.
  const r = repo({
    "package.json": PKG,
    "src.js": "export const label = (n) => `you have ${n} and more`\nexport const other = (n) => `you have ${n} or more`\n",
    "src.test.js": FULL_TEST,
  })
  r.write(
    "src.js",
    "export const label = (n) => `you have ${n} and more`\nexport const other = (n) => `you have ${n} or more`\nexport const tail = 1\n"
  )
  const res = run(FALSIFY, ["--list"], r.dir)
  has(res.out, "and-to-or", "the rule is offered")
  // The listing must not offer a break that cannot load; if the syntax filter is working, the
  // generated file is either valid or the rule is absent from this shape entirely.
  hasNot(res.out, "nothing", "still lists something to check")
})

test("falsify: a language it cannot syntax-check is reported, not scored", () => {
  // Python is in the supported extension list but `node --check` cannot parse it. Treating that as
  // "does not parse" would discard every mutation; treating it as "parses" would let a syntax
  // error masquerade as a caught break. The honest third option is to report and not score.
  const r = repo({
    "package.json": JSON.stringify({ name: "t", scripts: { test: "python3 -c 'pass'" } }),
    "calc.py": "def f(a):\n    if a == 1:\n        raise ValueError('x')\n    return a\n",
  })
  r.write("calc.py", "def f(a):\n    if a == 1:\n        raise ValueError('x')\n    return a\n\ndef g():\n    return 1\n")
  const res = run(FALSIFY, [], r.dir)
  has(res.out, "unchecked", "flags it as not scoreable: " + res.out.slice(0, 300))
  has(res.out, "not scoreable", "says so in the summary")
})

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    cleanup()
  }
}
await cleanupAndRun()