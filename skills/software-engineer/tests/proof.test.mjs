#!/usr/bin/env node
/**
 * proof.test.mjs - tests for scripts/proof.mjs.
 *
 * A tool that mutates the working tree to prove something is the highest-consequence script
 * here: if it restores badly it corrupts someone's uncommitted work. These tests check the
 * mutations are found, the survivors are reported, and the tree comes back byte for byte.
 *
 * Usage: node tests/proof.test.mjs
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PROOF, cleanup, createRunner, eq, gitIn, has, hasNot, repo, run } from "./harness.mjs"

const { test, runAll } = createRunner("proof.mjs")

const PKG = JSON.stringify({ name: "t", type: "module", scripts: { test: "node --test" } })

// `divide` guards b === 0 and throws. The suite below covers only the happy path, so a
// mutation of that guard survives - which is exactly the gap this tool exists to name.
const GOOD = "export function divide(a, b) {\n  if (b === 0) throw new Error('nope')\n  return a / b\n}\n"
const TEST = "import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { divide } from './src.js'\ntest('divides', () => { assert.equal(divide(6, 3), 2) })\n"

test("proof: an untested guard is reported as a surviving mutation", () => {
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  const res = run(PROOF, [], r.dir)
  eq(res.code, 1, "a surviving mutation is not a pass")
  has(res.out, "SURVIVED", "the surviving mutation is named")
  has(res.out, "no test", "the consequence is stated")
})

test("proof: a fully covered change exits 0", () => {
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  writeFileSync(join(r.dir, "src.test.js"), TEST + "test('guards zero', () => { assert.throws(() => divide(1, 0)) })\n")
  const res = run(PROOF, [], r.dir)
  eq(res.code, 0, "caught mutations pass: " + res.out.slice(0, 300))
  has(res.out, "caught", "reports the catch")
})

test("proof: the tree is restored byte for byte", () => {
  // The tool rewrites the user's working tree on purpose. Getting that wrong corrupts work
  // that exists nowhere else, so it is checked directly rather than inferred from the exit code.
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  const before = readFileSync(join(r.dir, "src.js"), "utf8")
  run(PROOF, [], r.dir)
  eq(readFileSync(join(r.dir, "src.js"), "utf8"), before, "src.js unchanged")
  const status = gitIn(r.dir, ["status", "--porcelain"])
  eq(status.code, 0, "git still runs")
  has(status.out, "M src.js", "the change is still there, uncommitted, as the user left it")
})

test("proof: a change with no applicable mutation says so instead of passing silently", () => {
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", "export const note = 'hello'\n")
  const res = run(PROOF, [], r.dir)
  has(res.out, "not a pass", "an unproven change does not read as proven")
  hasNot(res.out, "the tests ask real questions", "does not claim a result it did not get")
})

test("proof: --list shows the mutations without running the suite", () => {
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  const res = run(PROOF, ["--list"], r.dir)
  has(res.out, "drop-throw", "lists a mutation that applies")
  hasNot(res.out, "baseline:", "does not run the suite")
})

test("proof: a red suite stops the run rather than blaming the mutations", () => {
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  writeFileSync(join(r.dir, "src.test.js"), "test('deliberately failing', () => { throw new Error('x') })\n")
  const res = run(PROOF, [], r.dir)
  has(res.out, "already failing", "explains that a survivor would prove nothing")
  eq(res.code, 1, "does not claim a result from a broken baseline")
})

test("proof: --file narrows the run to one file", () => {
  const r = repo({
    "package.json": PKG,
    "src.js": GOOD,
    "other.js": "export const f = () => { if (x === 1) return 2 }\n",
    "src.test.js": TEST,
  })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  r.write("other.js", "export const f = () => { if (x === 1) return 2 }\nexport const g = 1\n")
  const res = run(PROOF, ["--file", "src.js"], r.dir)
  hasNot(res.out, "other.js", "only the named file is mutated")
})


test("proof: a change with nothing to prove is not reported as proven", () => {
  // "No mutation applies here" must not read as a pass: exit 1 and the reason, so a wrapper
  // cannot mistake silence for a green suite. This path was itself found by proof.mjs.
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", "export const note = 'hello'\n")
  const res = run(PROOF, [], r.dir)
  eq(res.code, 1, "an unproven change is not a pass")
  has(res.out, "not a pass", "says so")
})

test("proof: survives a mutation that removes the only guard it has", () => {
  // The core promise: a green suite plus an untested guard is reported, not waved through.
  const r = repo({ "package.json": PKG, "src.js": GOOD, "src.test.js": TEST })
  r.write("src.js", GOOD + "\nexport function half(a) {\n  return divide(a, 2)\n}\n")
  const res = run(PROOF, [], r.dir)
  has(res.out, "SURVIVED", "the untested guard survives a mutation and is reported")
})

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    cleanup()
  }
}
await cleanupAndRun()