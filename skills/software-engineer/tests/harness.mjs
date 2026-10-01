/**
 * harness.mjs - shared scaffolding for the script tests.
 *
 * Each test builds a throwaway git repo in a temp directory, runs a script inside it, and
 * asserts on the exit code and the output. Two reasons for the shape:
 *
 *   - The fixture IS the test, so a test cannot pass against a stale copy of what it checks.
 *   - A scanner's behaviour depends on real git state (tracked vs untracked, merge base), so a
 *     plain temp directory with no repo would test a code path nobody installs into.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const here = dirname(fileURLToPath(import.meta.url))
export const SCRIPTS = join(here, "..", "scripts")
export const VERIFY = join(SCRIPTS, "verify.mjs")
export const SMELLS = join(SCRIPTS, "smells.mjs")
export const PROOF = join(SCRIPTS, "proof.mjs")
export const CI = join(SCRIPTS, "ci.mjs")

/**
 * Run git in a fixture repo. `run` prefixes node for .mjs scripts, which is wrong for a binary,
 * so this spawns git directly.
 */
export function gitIn(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" }
}

const tempDirs = []

export function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "se-test-"))
  tempDirs.push(dir)
  const write = (p, content) => {
    const full = join(dir, p)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  for (const [p, c] of Object.entries(files)) write(p, c)
  const git = (...a) => spawnSync("git", a, { cwd: dir, stdio: "ignore" })
  git("init", "-q")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  git("add", "-A")
  git("commit", "-qm", "init")
  // `.gitignore` is present but empty so an untracked-file test can see the real default
  // behaviour instead of a fixture that happens to ignore everything.
  return { dir, write, git: (...a) => spawnSync("git", a, { cwd: dir, stdio: "ignore" }) }
}

export function run(script, args, cwd, opts = {}) {
  const r = spawnSync(process.execPath, [script, ...args, "--no-color"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  })
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" }
}

export function findings(out) {
  try {
    return JSON.parse(out).findings || []
  } catch {
    return []
  }
}

export const ids = (out) => findings(out).map((f) => f.id)

export const eq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg || ""}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
}
export const ok = (cond, msg) => {
  if (!cond) throw new Error(msg || "expected truthy")
}
export const has = (hay, needle, msg) => {
  if (!String(hay).includes(needle)) throw new Error(`${msg || ""}\n  expected to contain: ${needle}\n  in: ${String(hay).slice(0, 600)}`)
}
export const hasNot = (hay, needle, msg) => {
  if (String(hay).includes(needle)) throw new Error(`${msg || ""}\n  expected NOT to contain: ${needle}`)
}

/**
 * A minimal test runner. Split out so a test file can be about tests; the alternative is a
 * 500-line file that trips this repo's own `big-file` rule, which is a poor advertisement for
 * a skill about keeping files small.
 */
export function createRunner(label) {
  const tests = []
  const test = (name, fn) => tests.push({ name, fn })

  const runAll = async () => {
    let passed = 0
    for (const t of tests) {
      try {
        await t.fn()
        passed++
        console.log(`  ok    ${t.name}`)
      } catch (e) {
        console.log(`  FAIL  ${t.name}`)
        console.log(`        ${String(e.message).replace(/\n/g, "\n        ")}`)
        process.exitCode = 1
      }
    }
    const failed = tests.length - passed
    console.log(`\n  ${label}: ${passed}/${tests.length} passed${failed ? `, ${failed} failed` : ""}\n`)
  }

  return { test, runAll }
}

export function cleanup() {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* a temp dir that will not delete is not worth failing a test run over */
    }
  }
}