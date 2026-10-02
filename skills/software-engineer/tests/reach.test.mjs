#!/usr/bin/env node
/**
 * reach.test.mjs - tests for scripts/reach.mjs.
 *
 * reach.mjs answers "who calls this, and did anything test them". Every test builds a real monorepo
 * with real call sites, because the whole failure mode is a regex that counts a comment as a caller
 * or misses a caller in a package it did not walk. Neither failure shows up on a string fixture.
 *
 * Usage: node tests/reach.test.mjs
 */

import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FALSIFY, REACH, cleanup, createRunner, eq, gitIn, has, hasNot, repo, run } from "./harness.mjs"

const { test, runAll } = createRunner("reach.mjs")

const PKG = JSON.stringify({ name: "m", type: "module", scripts: { test: "node --test" } })

// A monorepo-shaped fixture: the function lives in one package and is called from another, which is
// the case a diff hides completely.
const monorepo = (extra = {}) => ({
  "package.json": PKG,
  "packages/api/charge.js":
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  return { charged: amount }\n}\n",
  "packages/api/routes.js": "import { charge } from './charge.js'\nexport function post(r) { return charge(r, 1) }\n",
  "tests/charge.test.js":
    "import { test } from 'node:test'\nimport { charge } from '../packages/api/charge.js'\ntest('c', () => charge({}, 1))\n",
  ...extra,
})

test("reach: a caller in another package is found even though it is not in the diff", () => {
  // The whole point. routes.js did not change, so nothing in the diff mentions it.
  const r = repo(monorepo())
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const res = run(REACH, [], r.dir)
  eq(res.code, 1, "an untested caller is a finding")
  has(res.out, "packages/api/routes.js:2", "names the caller: " + res.out.slice(0, 300))
  has(res.out, "not in the diff", "says why it matters")
})

test("reach: a caller a test reaches is not reported as a gap", () => {
  const r = repo(
    monorepo({
      "tests/routes.test.js":
        "import { test } from 'node:test'\nimport { post } from '../packages/api/routes.js'\ntest('p', () => post({}))\n",
    }),
  )
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const res = run(REACH, [], r.dir)
  eq(res.code, 0, "no untested caller remains: " + res.out.slice(-300))
  has(res.out, "sit in files a test imports", "says why it is not a finding")
  has(res.out, "not proof each caller is exercised", "and bounds what that evidence means")
})

test("reach: a caller inside a comment or string is not a caller", () => {
  // A regex that reads comments finds callers that do not exist, and the count stops meaning
  // anything. This is the single easiest way for a reachability tool to lie.
  const r = repo(
    monorepo({
      "packages/api/comments.js":
        "// charge(user, amount) used to live here\n/* charge(x) removed */\nexport const note = 'charge(1)'\n",
      "tests/comments.test.js": "import { test } from 'node:test'\nimport { note } from '../packages/api/comments.js'\ntest('n', () => note)\n",
    }),
  )
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const res = run(REACH, [], r.dir)
  hasNot(res.out, "comments.js", "a comment is not a call site: " + res.out.slice(0, 400))
})

test("reach: a declaration is not its own call site", () => {
  const r = repo(monorepo())
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const res = run(REACH, [], r.dir)
  hasNot(res.out, "charge.js:", "the declaration does not count: " + res.out.slice(0, 300))
})

test("reach: a symbol nothing calls is reported as new or dead, not as zero risk", () => {
  // Zero callers is ambiguous and saying nothing about it invites reading it as safe.
  const r = repo({ "package.json": PKG, "src.js": "export function charge() { return 1 }\n" })
  r.write("src.js", "export function charge() { return 2 }\n")
  const res = run(REACH, [], r.dir)
  has(res.out, "nobody calls it", "states the ambiguity")
  has(res.out, "dead code", "names both readings")
})

test("reach: a test calling the symbol counts as coverage, not as a risk", () => {
  // A well-tested change must never report worse than an untested one.
  const r = repo({
    "package.json": PKG,
    "src.js": "export function charge() { return 1 }\n",
    "src.test.js": "import { test } from 'node:test'\nimport { charge } from './src.js'\ntest('c', () => charge())\n",
  })
  r.write("src.js", "export function charge() { return 2 }\n")
  const res = run(REACH, [], r.dir)
  has(res.out, "only tests call it", "no production caller exists: " + res.out.slice(0, 300))
  hasNot(res.out, "untested", "the test call is not reported as a gap")
})

test("reach: the tree is never modified", () => {
  // Unlike falsify.mjs this must be read-only. It reports on a working tree that may hold hours of
  // uncommitted work, and a tool that rewrites it to answer a question is not worth having.
  const r = repo(monorepo())
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const before = gitIn(r.dir, ["status", "--porcelain"]).out
  run(REACH, [], r.dir)
  eq(gitIn(r.dir, ["status", "--porcelain"]).out, before, "the working tree is untouched")
})

test("reach: a clean tree says why, not just that there is nothing", () => {
  const r = repo(monorepo())
  const res = run(REACH, [], r.dir)
  eq(res.code, 2, "nothing to reach is distinct from a pass, so it gets its own code")
  has(res.out, "clean", "explains the state: " + res.out.slice(0, 200))
})

test("reach: --max stops printing callers without hiding the count", () => {
  const callers = {}
  for (let i = 0; i < 6; i++) {
    callers[`packages/c${i}/caller.js`] = `import { charge } from '../api/charge.js'\nexport const c${i} = () => charge({}, 1)\n`
  }
  const r = repo(monorepo(callers))
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const res = run(REACH, ["--max", "2"], r.dir)
  has(res.out, "7 untouched caller", "the count is never truncated")
  has(res.out, "raise --max", "and the truncation is stated")
})

test("reach: node_modules is not walked", () => {
  // A vendored copy of the same symbol would double or triple every count and take a minute.
  const r = repo(monorepo({ "node_modules/dep/index.js": "export function charge() { return 0 }\nconst x = charge()\n" }))
  r.write(
    "packages/api/charge.js",
    "export function charge(user, amount) {\n  if (amount <= 0) throw new Error('bad')\n  if (amount > user.balance) throw new Error('short')\n  return { charged: amount }\n}\n",
  )
  const res = run(REACH, [], r.dir)
  hasNot(res.out, "node_modules", "vendored copies are not callers")
})

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    cleanup()
  }
}
await cleanupAndRun()