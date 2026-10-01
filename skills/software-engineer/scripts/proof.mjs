#!/usr/bin/env node
/**
 * proof.mjs - check that this change's tests would actually catch its regressions.
 *
 * A green suite proves the code runs. It does not prove the tests ask anything: a suite that
 * asserts a stub's return value is green, a suite that swallows every error is green, and both
 * are green for the reason that nobody wrote an assertion about the part that broke.
 *
 * This is the one verification step an agent reliably skips - it is cheaper to read the code,
 * decide it looks fine, and report success. Measured on this skill's own evals: the reading
 * step found the same bugs in both arms, and only this step found that the failure path had no
 * test at all.
 *
 * It works by mutating the code the way a bug would, then requiring the suite to go red:
 *   1. remove every throw      - a build that swallows errors must fail
 *   2. remove every await      - a build that does not wait must fail
 *   3. flip each strict ===    - an inverted boundary must fail
 *   4. drop every guard clause - a missing null check must fail
 * Each mutation is reverted immediately. A mutation that stays green is a hole in the suite.
 *
 * Usage:
 *   node proof.mjs                       # prove the working tree against HEAD
 *   node proof.mjs --file src/foo.ts     # narrow to one file
 *   node proof.mjs --list                # show which mutations apply to this diff
 *
 * Exit: 0 every mutation was caught (or none applied), 1 a mutation survived.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { extname, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d
}
const color = !has("--no-color") && process.stdout.isTTY !== false
const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const red = (s) => c("31", s)
const green = (s) => c("32", s)
const yellow = (s) => c("33", s)
const bold = (s) => c("1", s)

const root = process.cwd()

/* ---------- what changed ---------- */

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null
}
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|[^/]+_test\.[a-z]+$/
const SRC_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rb", ".rs", ".java"])

function changedFiles() {
  const only = opt("--file", null)
  if (only) return [only]
  const head = git("rev-parse", "--verify", "HEAD")
  const files = new Set()
  if (head) for (const f of git("diff", "--name-only", "--diff-filter=ACMR", "HEAD") || []) files.add(f)
  for (const f of git("ls-files", "--others", "--exclude-standard") || []) files.add(f)
  for (const f of git("diff", "--name-only", "--diff-filter=ACMR") || []) files.add(f)
  return [...files].map((f) => f.replace(/\\/g, "/")).filter((f) => SRC_EXT.has(extname(f)) && !TEST_RE.test(f))
}

/* ---------- the gate ---------- */

// The project's own test command, discovered the same way verify.mjs does it. Reusing the
// detection here rather than reimplementing keeps one answer to "how do I run the tests".
function testCommand() {
  const cfg = (() => {
    try {
      return JSON.parse(readFileSync(resolve(root, ".software-engineer.json"), "utf8"))
    } catch {
      return {}
    }
  })()
  const gate = cfg?.verify?.gates?.test
  if (Array.isArray(gate) && gate.length) return gate
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
    const scripts = pkg.scripts || {}
    const pm =
      (typeof pkg.packageManager === "string" && pkg.packageManager.split("@")[0]) ||
      (existsSync(resolve(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(resolve(root, "yarn.lock")) ? "yarn" : "npm")
    const name = ["test:ci", "test", "jest", "vitest", "mocha"].find((s) => scripts[s])
    if (name) return [pm, "run", name]
  } catch {
    /* no package.json: fall through */
  }
  if (existsSync(resolve(root, "Makefile"))) return ["make", "test"]
  if (existsSync(resolve(root, "pytest.ini")) || existsSync(resolve(root, "pyproject.toml"))) return ["pytest", "-q"]
  return null
}

const runTests = () => {
  const cmd = testCommand()
  if (!cmd) return { ran: false }
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return { ran: true, ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}` }
}

/* ---------- mutations ---------- */

// Each mutation is a regex rewrite plus the reason it matters. A mutation with no reason gets
// dropped: a checker nobody can justify is a rule to route around.
const MUTATIONS = [
  {
    id: "drop-throw",
    why: "a build that swallows errors instead of raising them",
    apply: (s) => s.replace(/\bthrow\s+(new\s+)?[^\n;}]+/g, "return undefined"),
  },
  {
    id: "drop-await",
    why: "a build that fires and forgets instead of waiting",
    apply: (s) => s.replace(/\bawait /g, ""),
  },
  {
    id: "flip-strict-eq",
    why: "a boundary compared the wrong way round",
    apply: (s) => s.replace(/([\w)\]]) === ([^\n=])/g, "$1 !== $2"),
  },
  {
    id: "drop-guard",
    why: "a guard clause that no longer guards, e.g. an absent null check",
    apply: (s) => s.replace(/if\s*\(([^)\n]{1,80})\)\s*(?!\{)/g, "if (false /* $1 */) "),
  },
  {
    id: "short-circuit-and",
    why: "a condition that stops at the first false instead of checking both",
    apply: (s) => s.replace(/\band\b/g, "||"),
  },
]

function mutationsFor(file) {
  const src = readFileSync(file, "utf8")
  const base = /\bthrow\b/.test(src) ? 0 : 0
  const out = []
  for (const m of MUTATIONS) {
    const mutated = m.apply(src)
    if (mutated === src) continue
    // A mutation that changes nothing observable is a no-op; skip it rather than report it.
    if (mutated.replace(/\s+/g, "") === src.replace(/\s+/g, "")) continue
    out.push({ ...m, file, original: src, mutated })
  }
  return out
}

const files = changedFiles().map((f) => resolve(root, f)).filter(existsSync)
const all = files.flatMap((f) => mutationsFor(f))

console.log(bold(`\nproof  ${dim(root)}\n`))
if (!files.length) {
  console.log(dim("  no changed source file to mutate. Nothing was proven."))
  console.log(dim("  This is not a pass - say so in the handoff.\n"))
  process.exit(0)
}
if (!all.length) {
  console.log(dim(`  ${files.length} file(s) changed, but none contains a mutation this checker applies to.`))
  console.log(dim("  The suite was never exercised against a deliberate break, so this is not a pass."))
  console.log(dim("  Either the change is trivial, or the checker does not cover this language.\n"))
  process.exit(1)
}

if (has("--list")) {
  for (const m of all) console.log(`  ${relative(root, m.file)}  ${m.id.padEnd(20)} ${dim(m.why)}`)
  console.log("")
  process.exit(0)
}

const baseline = runTests()
if (!baseline.ran) {
  console.log(yellow("  no test command detected, so nothing can be proven."))
  console.log(dim("  Configure verify.gates.test, or run the project's own command by hand.\n"))
  process.exit(1)
}
if (!baseline.ok) {
  console.log(red("  the suite is already failing, so a surviving mutation proves nothing."))
  console.log(dim("  Fix the suite first, then run this again.\n"))
  process.exit(1)
}
console.log(dim(`  baseline: suite green\n`))

const survived = []
for (const m of all) {
  writeFileSync(m.file, m.mutated)
  const r = runTests()
  writeFileSync(m.file, m.original)
  if (r.ran && !r.ok) {
    console.log(`  ${green("caught")}   ${relative(root, m.file)}  ${m.id.padEnd(20)} ${dim(m.why)}`)
  } else {
    survived.push(m)
    console.log(`  ${red("SURVIVED")} ${relative(root, m.file)}  ${m.id.padEnd(20)} ${dim(m.why)}`)
  }
}

// Confirm the revert left the tree as it was. A proof tool that mutates the repo is worse than
// no proof tool.
const after = runTests()
if (!after.ok) {
  console.log(red("\n  the suite is red after reverting every mutation - the tree was not restored.\n"))
  process.exit(1)
}

console.log("")
if (!survived.length) {
  console.log(green(`  all ${all.length} mutation(s) caught - the tests ask real questions\n`))
  process.exit(0)
}
console.log(red(`  ${survived.length} mutation(s) survived. That code path has no test.\n`))
console.log(dim("  A surviving mutation is not a failed test. It is a gap the suite does not see,"))
console.log(dim("  and the gap is usually the branch you touched. Add the assertion, or state the"))
console.log(dim("  gap in the handoff rather than letting it read as verified.\n"))
process.exit(1)