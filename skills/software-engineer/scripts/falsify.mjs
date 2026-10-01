#!/usr/bin/env node
/**
 * falsify.mjs - make the claim "it works" falsifiable.
 *
 * An agent reporting "tests pass" costs it nothing to say, and nothing inside that same session
 * can contradict it. This is the counter-check: it breaks the changed code the way a bug would,
 * then requires the suite to go red. A mutation that survives is a branch with no test - and the
 * gap is usually the branch the change just added.
 *
 * What is different from running Stryker or PIT:
 *   - Zero config, zero install. Those need a config file and a working directory.
 *   - Scoped to the diff. The point is the change under review, not a whole codebase.
 *   - Runs in seconds, so an agent will actually run it. Nobody wires a 20-minute gate into
 *     the loop between reading a diff and answering.
 *   - It also falsifies the *claims*, not just the code. See `CLAIMS` below.
 *
 * Usage:
 *   node falsify.mjs                  # prove the working tree against HEAD
 *   node falsify.mjs --file src/a.js # narrow to one file
 *   node falsify.mjs --list          # show which mutations apply, run nothing
 *   node falsify.mjs --quiet         # summary line only
 *
 * Exit: 0 every applied mutation was caught, 1 at least one survived.
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
const c = (n, s) => (color ? `\u001b[${n}m${s}\u001b[0m` : s)
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
const SRC_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rb", ".rs", ".java", ".php"])

function changedFiles() {
  const only = opt("--file", null)
  if (only) return [only]
  const files = new Set()
  if (git("rev-parse", "--verify", "HEAD")) for (const f of git("diff", "--name-only", "--diff-filter=ACMR", "HEAD") || []) files.add(f)
  for (const f of git("diff", "--name-only", "--diff-filter=ACMR") || []) files.add(f)
  for (const f of git("ls-files", "--others", "--exclude-standard") || []) files.add(f)
  return [...files].map((f) => f.replace(/\\/g, "/")).filter((f) => SRC_EXT.has(extname(f)) && !TEST_RE.test(f))
}

/* ---------- the suite ---------- */

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
    const s = pkg.scripts || {}
    const pm =
      (typeof pkg.packageManager === "string" && pkg.packageManager.split("@")[0]) ||
      (existsSync(resolve(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(resolve(root, "yarn.lock")) ? "yarn" : "npm")
    const name = ["test:ci", "test", "jest", "vitest", "mocha"].find((n) => s[n])
    if (name) return [pm, "run", name]
  } catch {
    /* fall through */
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

// Every entry states the failure it represents. A mutation with no stated failure is a rule to
// route around, so there are none.
const MUTATIONS = [
  { id: "swallow-error", why: "a build that reports failure as success", apply: (s) => s.replace(/\bthrow\s+(new\s+)?[^\n;}]+/g, "return undefined") },
  { id: "fire-and-forget", why: "a build that does not wait for the result it needs", apply: (s) => s.replace(/\bawait /g, "") },
  { id: "invert-boundary", why: "a comparison that resolves the other way round", apply: (s) => s.replace(/([\w)\]]) === ([^\n=])/g, "$1 !== $2") },
  { id: "unguard", why: "a guard clause that no longer guards", apply: (s) => s.replace(/if\s*\(([^)\n]{1,80})\)\s*(?!\{)/g, "if (false /* $1 */) ") },
  { id: "short-circuit", why: "a condition that stops at the first false", apply: (s) => s.replace(/\band\b/g, "||") },
  { id: "off-by-one", why: "a loop that runs one iteration too few", apply: (s) => s.replace(/(\bfor\s*\([^;]*;[^;]*;[^)]*\+\+)/g, "$1 + 1") },
]

function mutationsFor(file) {
  const src = readFileSync(file, "utf8")
  const out = []
  for (const m of MUTATIONS) {
    const mutated = m.apply(src)
    if (mutated === src) continue
    // A whitespace-only change proves nothing and burns a full suite run.
    if (mutated.replace(/\s+/g, "") === src.replace(/\s+/g, "")) continue
    out.push({ ...m, file, original: src, mutated })
  }
  return out
}

const files = changedFiles().map((f) => resolve(root, f)).filter(existsSync)
const all = files.flatMap(mutationsFor)

console.log(bold(`\nfalsify  ${dim(root)}\n`))

if (!files.length) {
  // Distinguish the two reasons, because they need different responses and "nothing to check"
  // is not an answer to either. Silently exiting 0 here is how a gate becomes decoration.
  const head = git("rev-parse", "--verify", "HEAD")
  const dirty = (git("diff", "--name-only", "HEAD") || []).length + (git("ls-files", "--others", "--exclude-standard") || []).length
  console.log(yellow("  nothing to falsify: no changed source file."))
  if (!head) console.log(dim("  This repo has no commits, so there is no baseline to compare against."))
  else if (dirty === 0) console.log(dim("  The working tree is clean - the change is already committed."))
  else console.log(dim("  The change touches no source file: docs, config, or dependencies only."))
  console.log(dim("  Run --file <path> to point at a file explicitly. This is not a pass.\n"))
  process.exit(1)
}
if (!all.length) {
  console.log(dim(`  ${files.length} file(s) changed, none contains a break this checks for.`))
  console.log(dim("  The suite was never run against a deliberate fault, so it proves nothing.\n"))
  process.exit(1)
}

if (has("--list")) {
  for (const m of all) console.log(`  ${relative(root, m.file)}  ${m.id.padEnd(16)} ${dim(m.why)}`)
  console.log("")
  process.exit(0)
}

const baseline = runTests()
if (!baseline.ran) {
  console.log(yellow("  no test command found, so nothing can be falsified."))
  console.log(dim("  Configure verify.gates.test, or run the project's own command by hand.\n"))
  process.exit(1)
}
if (!baseline.ok) {
  console.log(red("  the suite already fails, so a surviving mutant would prove nothing."))
  console.log(dim("  Fix the suite first, then run this again.\n"))
  process.exit(1)
}
console.log(dim("  baseline: suite green. Now breaking it on purpose.\n"))

const survived = []
const caught = []
for (const m of all) {
  writeFileSync(m.file, m.mutated)
  const r = runTests()
  writeFileSync(m.file, m.original)
  const id = `${m.id}  ${relative(root, m.file)}`
  // `r.ran` is false when no test command was found. Without it, a repo with no suite would
  // count every break as "survived" and blame the tests for a missing runner - which is the
  // opposite of the truth, and the version of this bug that falsify.mjs found in ci.mjs.
  if (r.ran && !r.ok) {
    caught.push(m)
    if (!has("--quiet")) console.log(`  ${green("caught  ")} ${id.padEnd(44)} ${dim(m.why)}`)
  } else {
    survived.push(m)
    console.log(`  ${red("SURVIVED")} ${id.padEnd(44)} ${dim(m.why)}`)
  }
}

// Confirm the tree came back. A falsification tool that corrupts uncommitted work is worse than
// none, and that failure is invisible until someone loses an afternoon.
const after = runTests()
if (!after.ok) {
  console.log(red("\n  the suite is red after reverting every mutant - the tree was not restored.\n"))
  process.exit(1)
}

console.log("")
if (!survived.length) {
  console.log(green(`  ${caught.length}/${all.length} breaks caught. The tests are load-bearing.`))
  console.log(dim("  That is a claim with evidence behind it.\n"))
  process.exit(0)
}

// Group by file: one untested branch per file is actionable, six mutants in one file is one
// message repeated.
const byFile = new Map()
for (const m of survived) {
  if (!byFile.has(m.file)) byFile.set(m.file, [])
  byFile.get(m.file).push(m)
}
console.log(red(`  ${survived.length} break(s) survived in ${byFile.size} file(s). That code has no test.\n`))
for (const [file, ms] of byFile) console.log(`    ${relative(root, file)}  ${ms.map((m) => m.id).join(", ")}`)
console.log(dim("\n  A surviving mutant is not a failed test. It is a gap the suite cannot see,"))
console.log(dim("  and it is usually the branch you just added. Write the assertion, or state the"))
console.log(dim("  gap in the handoff instead of letting 'tests pass' stand in for it.\n"))
process.exit(1)