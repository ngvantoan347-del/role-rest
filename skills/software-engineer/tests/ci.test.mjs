#!/usr/bin/env node
/**
 * ci.test.mjs - tests for scripts/ci.mjs.
 *
 * ci.mjs is a wrapper, and a wrapper has one job a standalone script does not: it must not
 * lose information. A gate that failed and a gate that never ran both look like "exit 1" unless
 * the wrapper names them, and a wrapper that swallows output leaves the reader with a red line
 * and no way to act on it.
 *
 * Usage: node tests/ci.test.mjs
 */

import { join } from "node:path"
import { CI, cleanup, createRunner, eq, has, hasNot, repo, run } from "./harness.mjs"

const { test, runAll } = createRunner("ci.mjs")

const PKG = JSON.stringify({ name: "t", type: "module", scripts: { test: "node --test" } })
const CLEAN = "export function add(a, b) {\n  return a + b\n}\n"
const TEST = "import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { add } from './src.js'\ntest('adds', () => { assert.equal(add(1, 2), 3) })\n"

test("ci: reports each gate separately with its own exit code", () => {
  const r = repo({ "package.json": PKG, "src.js": CLEAN, "src.test.js": TEST })
  r.write("src.js", CLEAN + "\nexport const unused = 1\n")
  const res = run(CI, ["--no-falsify", "--no-color"], r.dir)
  has(res.out, "PASS  verify", "verify reported")
  has(res.out, "PASS  smells", "smells reported")
})

test("ci: a failing gate is named with what it owns", () => {
  // "exit 1" from three scripts tells a person nothing. The wrapper's added value is the label.
  const r = repo({ "package.json": PKG, "src.js": CLEAN, "src.test.js": TEST })
  r.write("src.js", "// TODO: no owner, no issue\nexport const x = 1\n")
  const res = run(CI, ["--no-falsify", "--no-color"], r.dir)
  eq(res.code, 1, "a failed gate fails the run")
  has(res.out, "smells", "names the failing gate")
  has(res.out, "mechanical debt in the diff", "says what that gate covers")
})

test("ci: --no-falsify skips the slowest gate", () => {
  const r = repo({ "package.json": PKG, "src.js": CLEAN, "src.test.js": TEST })
  r.write("src.js", CLEAN + "\nexport function half(a) {\n  return a / 2\n}\n")
  const res = run(CI, ["--no-falsify", "--no-color"], r.dir)
  hasNot(res.out, "falsify", "falsify not run")
  eq(res.code, 0, "the other two gates are enough here")
})

test("ci: passes a gate's own output through rather than summarising it", () => {
  const r = repo({ "package.json": PKG, "src.js": CLEAN, "src.test.js": TEST })
  r.write("src.js", "// TODO: unowned\nexport const x = 1\n")
  const res = run(CI, ["--no-falsify", "--no-color"], r.dir)
  has(res.out, "debt-marker", "the gate's finding text survives: " + res.out.slice(0, 200))
  has(res.out, "smells  ", "the gate's own summary line survives")
})

test("ci: a clean repo exits 0", () => {
  const r = repo({ "package.json": PKG, "src.js": CLEAN, "src.test.js": TEST })
  r.write("src.js", CLEAN + "\nexport const version = 1\n")
  const res = run(CI, ["--no-falsify", "--no-color"], r.dir)
  eq(res.code, 0, "green: " + res.out.slice(-300))
  has(res.out, "all gates green", "says so")
})

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    cleanup()
  }
}
await cleanupAndRun()