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

// Whether any test file is part of the change at all. Separated from changedFiles() because
// "no test changed" is the finding: an agent that adds behaviour without a test leaves the
// suite green for the least informative reason possible.
function testFilesChanged() {
  const files = new Set()
  if (git("rev-parse", "--verify", "HEAD")) for (const f of git("diff", "--name-only", "--diff-filter=ACMR", "HEAD") || []) files.add(f)
  for (const f of git("diff", "--name-only", "--diff-filter=ACMR") || []) files.add(f)
  for (const f of git("ls-files", "--others", "--exclude-standard") || []) files.add(f)
  return [...files].map((f) => f.replace(/\\/g, "/")).some((f) => TEST_RE.test(f))
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
//
// `repl` is a function of (match, groups), and each match in the file becomes its OWN mutation.
// One-at-a-time is the whole design, not an optimisation: applying a mutation to every site at
// once lets a single tested branch stand in for all of them, so a file with one covered guard and
// two untested ones reports clean. Site-level mutation is the only way "that branch specifically
// has no test" is a sentence the tool can actually say, and naming the branch is the entire
// output.
const MUTATIONS = [
  // Each rule carries the alternative spelling of its own syntax. A single-language rule in a
  // multi-language file list is worse than no rule: the file looks supported and finds nothing,
  // which is a claim of cleanliness built out of a pattern that never matched.
  { id: "swallow-error", why: "a failure reported as success", re: /(?:\bthrow\s+(?:new\s+)?[^\n;}]+|\braise\s+[^\n]+)/g, repl: () => "return undefined" },
  { id: "drop-await", why: "a result used before it arrives", re: /\b(?:await|await\s+)(?:\w|\()/g, repl: () => "" },
  { id: "invert-equality", why: "a comparison that resolves the other way round", re: /([\w)\]])\s*(?:===|==)\s*([^\n=])/g, repl: (_m, a, b) => `${a} !== ${b}` },
  { id: "invert-inequality", why: "a rejection that becomes an acceptance", re: /([\w)\]])\s*!==?\s*([^\n=])/g, repl: (_m, a, b) => `${a} === ${b}` },
  // JS: `if (cond) stmt`. Python: `if cond:` where the body is indented rather than braced.
  { id: "unguard", why: "a guard clause that no longer guards", re: /\bif\s*\(([^)\n]{1,80})\)\s*(?!\{)/g, repl: (_m, cond) => `if (false /* ${cond} */) ` },
  { id: "unguard-colon", why: "a guard clause that no longer guards", re: /^(\s*)if\s+([^\n:]{1,80}):\s*$/gm, repl: (_m, ind, cond) => `${ind}if False:  # was: ${cond}` },
  { id: "and-to-or", why: "a condition that stops at the first false", re: /(\W)and(?=\W)/g, repl: (_m, before) => `${before}or` },
  { id: "or-to-and", why: "a condition that accepts the first true", re: /(\W)or(?=\W)/g, repl: (_m, before) => `${before}and` },
  { id: "off-by-one", why: "a loop that runs one iteration too few", re: /(\bfor\s*\([^;]*;[^;]*;[^)]*\+\+)/g, repl: (_m, head) => `${head} + 1` },
  { id: "swap-arms", why: "a two-branch decision that takes the wrong arm", re: /\?([^:\n]{1,60}):/g, repl: (_m, a) => `?:${a}:` },
  { id: "negate-return", why: "a return that flips its answer", re: /\breturn\s+!(?!=)/g, repl: () => "return (" },
  { id: "zero-out-literal", why: "a threshold that no longer bites", re: /\b(\d+)\b(?=[^\n]*\b(?:limit|max|min|threshold|retries|timeout|ttl|expiry)\b)/gi, repl: (_m, n) => (Number(n) === 0 ? "1" : "0") },
]

/**
 * Every (rule, site) pair in a file, as its own mutation. Returns [] when a site is present but
 * would produce a no-op, because a mutation that cannot change behaviour proves nothing and only
 * burns a suite run.
 */
function mutationsFor(file) {
  const src = readFileSync(file, "utf8")
  const ext = extname(file).toLowerCase()
  // A file that stopped parsing is not a behaviour change, and a suite that goes red on a syntax
  // error has proved nothing about any branch. `node --check` is the only syntax oracle available
  // here, so it is used where the extension allows and skipped elsewhere rather than guessed at.
  const checkable = [".js", ".mjs", ".cjs"].includes(ext)
  const out = []
  for (const m of MUTATIONS) {
    const sites = [...src.matchAll(m.re)]
    sites.forEach((site, i) => {
      // Splice the site out and splice the replacement in, using the match's own groups. Running
      // the rule's regex again over just the matched text is the obvious implementation and it is
      // wrong: a pattern whose context spans the match boundary - a lookbehind, or a capture that
      // consumed the character before the keyword - silently produces no change, and the whole
      // file then looks untestable.
      const args = site.slice(1).map((g) => g ?? "")
      let replacement
      try {
        replacement = m.repl(site[0], ...args)
      } catch {
        return
      }
      const mutated = src.slice(0, site.index) + replacement + src.slice(site.index + site[0].length)
      if (mutated === src) return
      if (mutated.replace(/\s+/g, "") === src.replace(/\s+/g, "")) return
      let parses = null
      if (checkable) parses = syntaxOk(file, mutated)
      if (parses === false) return
      out.push({
        ...m,
        file,
        original: src,
        mutated,
        site: i + 1,
        of: sites.length,
        line: src.slice(0, site.index).split("\n").length,
        // `parses === null` means the language cannot be checked from here. Those are neither
        // evidence for the tests nor evidence against them, so they are counted separately
        // instead of being folded into either verdict.
        verified: parses,
      })
    })
  }
  return out
}

function syntaxOk(file, contents) {
  const r = spawnSync(process.execPath, ["--check", file], { cwd: root, input: contents, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  // Older runtimes reject `--check` on stdin; treating "cannot tell" as "does not parse" would
  // discard every mutation, which is worse than keeping them.
  if (r.error) return null
  return r.status === 0
}

// How much of the file this checker can actually attack. A file full of branches but few
// applicable mutations has NOT been verified - and saying "all breaks caught" when the tool
// could only construct two is a false claim in the direction that flatters the code. So the report
// states coverage of the checker's own reach, not of the tests.
function reachability(src) {
  const branches = (src.match(/\b(if|switch|case|while|for)\b|\?[^:\n]{1,60}:|\bcatch\b|\breturn\b|\bthrow\b/g) || []).length
  const sites = MUTATIONS.reduce((n, m) => n + [...src.matchAll(m.re)].length, 0)
  return { branches, sites }
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
  // The dangerous case: source changed, the suite is green, and there is nothing to break.
  // That reads as "the checker found no fault", when the truth is that nobody wrote a test -
  // which is the single most common way an agent ships untested code. Name it as the gap it
  // is, because a silent exit here is indistinguishable from a pass.
  const sourceChanged = files.length
  const testsChanged = testFilesChanged()
  console.log(yellow(`  ${sourceChanged} source file(s) changed and none of them contains a break this checks for.`))
  if (!testsChanged) {
    console.log(dim("\n  No test file changed either. The suite is green because it never exercises"))
    console.log(dim("  this code - a placeholder assertion passes just as well as a real one."))
    console.log(dim("  Write the test first, watch it fail, then fix. That is the only version of"))
    console.log(dim("  'green' that means anything for new behaviour.\n"))
  } else {
    console.log(dim("\n  The suite was never run against a deliberate fault, so it proves nothing.\n"))
  }
  process.exit(1)
}

if (has("--list")) {
  for (const m of all) {
    console.log(`  ${relative(root, m.file)}:${String(m.line).padEnd(5)} ${m.id.padEnd(16)} ${dim(m.why)}`)
  }
  console.log(dim(`\n  ${all.length} break(s) would be constructed across ${files.length} file(s). Nothing run.\n`))
  process.exit(0)
}

const baseline = runTests()
if (!baseline.ran) {
  console.log(yellow("  no test command found, so nothing can be falsified."))
  console.log(dim("  Configure verify.gates.test, or run the project's own command by hand.\n"))
  process.exit(1)
}
if (!baseline.ok) {
  console.log(red("  the suite already fails, so a surviving break would prove nothing."))
  console.log(dim("  Fix the suite first, then run this again.\n"))
  process.exit(1)
}
console.log(dim("  baseline: suite green. Now breaking it on purpose.\n"))

// How much of the change this checker can even attack. Reported before the results, because a
// low number changes what the results mean: 4/4 caught out of 4 possible breaks is weaker
// evidence than 4/4 caught out of 20.
const reach = files.map((f) => ({ file: relative(root, f), ...reachability(readFileSync(f, "utf8")) }))
const totalBranches = reach.reduce((n, r) => n + r.branches, 0)

const survived = []
const caught = []
// Breaks whose language could not be syntax-checked from here. They are reported and not scored,
// because a break the file may not even survive says nothing about whether a test exercises it.
const unchecked = []
for (const m of all) {
  writeFileSync(m.file, m.mutated)
  const r = runTests()
  writeFileSync(m.file, m.original)
  const id = `${`${m.id}${m.of > 1 ? ` ${m.site}/${m.of}` : ""}  ${relative(root, m.file)}:${m.line}`}`.padEnd(52)
  // `r.ran` is false when no test command was found. Without it, a repo with no suite would
  // count every break as "survived" and blame the tests for a missing runner - which is the
  // opposite of the truth, and the version of this bug that falsify.mjs found in ci.mjs.
  if (m.verified === null) {
    unchecked.push(m)
    if (!has("--quiet")) console.log(`  ${yellow("unchecked")} ${id} ${dim(`${m.why} - language not syntax-checked`)}`)
  } else if (r.ran && !r.ok) {
    caught.push(m)
    if (!has("--quiet")) console.log(`  ${green("caught  ")} ${id} ${dim(m.why)}`)
  } else {
    survived.push(m)
    console.log(`  ${red("SURVIVED")} ${id} ${dim(m.why)}`)
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
// Reach first, always. "All breaks caught" reads as full confidence; with 4 breakable sites in
// a file of 40 branches it is a statement about 4 sites, and the number belongs next to it.
//
// The denominator is decision points, and several rules can hit the same one, so the ratio can
// exceed 100%. It is reported as "one break per N decision points" instead of a percentage,
// because a clamped 100% is a claim about the checker's confidence that the data never supported.
if (totalBranches > 0) {
  const per = (totalBranches / Math.max(all.length, 1)).toFixed(1)
  const density = all.length / totalBranches
  console.log(dim(`  reach: ${all.length} break(s) from ${totalBranches} decision point(s) - one every ${per} point(s)`))
  if (density < 0.4) {
    console.log(yellow("  Under 40% of the decision points here can be attacked at all. This checker"))
    console.log(dim("  reads patterns, not code, so a low number is the checker's limit, not a clean"))
    console.log(dim("  bill. Read the changed functions yourself before trusting a pass here.\n"))
  } else {
    console.log(dim("  Most decision points in this change are attackable. Still pattern-based:"))
    console.log(dim("  anything it cannot name needs a human read.\n"))
  }
}

const note = (n, what) => (n ? dim(`  (${n} not scoreable: ${what})`) : "")

if (!survived.length) {
  console.log(green(`  ${caught.length}/${caught.length + survived.length} constructed breaks caught.`))
  console.log(dim("  Within the reach above, the tests are load-bearing. Beyond it, unverified."))
  console.log(note(unchecked.length, "language not syntax-checked from here") + "\n")
  process.exit(0)
}

// Group by file, then by line. The whole output of this tool is "these exact lines have no test",
// so a line number is the deliverable - a file name alone sends the reader back to grep.
const byFile = new Map()
for (const m of survived) {
  if (!byFile.has(m.file)) byFile.set(m.file, new Map())
  const lines = byFile.get(m.file)
  if (!lines.has(m.line)) lines.set(m.line, [])
  lines.get(m.line).push(m)
}
console.log(red(`  ${survived.length} break(s) survived in ${byFile.size} file(s). Those lines have no test.\n`))
if (unchecked.length) console.log(note(unchecked.length, "language not syntax-checked from here"))
for (const [file, lines] of byFile) {
  const shown = [...lines.entries()].sort((a, b) => a[0] - b[0]).slice(0, 8)
  console.log(`    ${relative(root, file)}`)
  for (const [line, ms] of shown) {
    console.log(`      ${dim(`:${line}`.padEnd(6))} ${ms.map((m) => m.id).join(", ")}`)
  }
  if (lines.size > shown.length) console.log(dim(`      ... and ${lines.size - shown.length} more line(s)`))
}
console.log(dim("\n  A surviving break is not a failed test. It is a gap the suite cannot see,"))
console.log(dim("  and it is usually the branch you just added. Write the assertion, or state the"))
console.log(dim("  gap in the handoff instead of letting 'tests pass' stand in for it.\n"))
process.exit(1)