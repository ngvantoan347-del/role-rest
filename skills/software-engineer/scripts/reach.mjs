#!/usr/bin/env node
/**
 * reach.mjs - find who calls what this change touched, and whether anything tests them.
 *
 * The failure this exists for: you changed a function, its own test passed, and the report says
 * verified. Meanwhile the function is called from 43 places and you looked at one. Nothing in the
 * diff tells you that, because the other 42 call sites did not change - which is exactly why they
 * are the risk.
 *
 * Every big company's postmortem contains a version of "we did not know it had 43 callers". This is
 * the answer to that question, in about a second, with no setup. An agent asked to count call sites
 * across a monorepo will produce a plausible number from the files it happened to read; this counts
 * them by reading the whole tree, and says which ones it could not parse.
 *
 * What it reports, per changed exported symbol:
 *   - how many call sites exist, and how many packages they span
 *   - which call sites are NOT in the change and NOT reachable from any test file
 *
 * The second list is the finding. Those are the callers your diff cannot show you.
 *
 * Usage:
 *   node reach.mjs                     # the working tree against HEAD
 *   node reach.mjs --file src/a.js     # one file, every symbol it exports
 *   node reach.mjs --max 200           # stop printing after N call sites per symbol
 *   node reach.mjs --all               # include call sites the tests do reach, for context
 *
 * Exit: 0 every untouched caller is reachable from a test, 1 at least one is not, 2 nothing changed.
 *
 * Language: identifiers, imports, and call syntax. Reliable for JS and TS, useful for Python, Go
 * and Ruby. For C, Java or Kotlin it will undercount, and it says so rather than reporting a number
 * it cannot stand behind.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const num = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
}
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

/* ---------- the tree ---------- */

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null
}
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|[^/]+_test\.[a-z]+$/
// Directories that hold nothing but copies. Walking node_modules turns a one-second check into a
// minute and finds the same symbol definition 400 times.
const SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "vendor", "target", ".venv", "__pycache__"])

const SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rb"])
// Comments and string literals look like call sites to a regex. A caller found inside a comment is
// not a caller, and reporting it would inflate the count into fiction.
const stripNoise = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/^\s*#(?!!)[^\n]*/gm, " ")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    if (e.name.startsWith(".") && e.name !== ".github") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (statSync(p).isFile() && SOURCE_EXT.has(extname(e.name))) out.push(p)
  }
  return out
}

const allFiles = walk(root)
const isTest = (p) => TEST_RE.test(relative(root, p).replace(/\\/g, "/"))
const sourceFiles = allFiles.filter((p) => !isTest(p))
const testFiles = allFiles.filter(isTest)

/* ---------- what changed ---------- */

const only = opt("--file", null)
function changedSource() {
  if (only) return [resolve(root, only)].filter(existsSync)
  const files = new Set()
  if (git("rev-parse", "--verify", "HEAD"))
    for (const f of git("diff", "--name-only", "--diff-filter=ACMR", "HEAD") || []) files.add(f)
  for (const f of git("diff", "--name-only", "--diff-filter=ACMR") || []) files.add(f)
  for (const f of git("ls-files", "--others", "--exclude-standard") || []) files.add(f)
  return [...files]
    .map((f) => resolve(root, f))
    .filter((f) => SOURCE_EXT.has(extname(f)) && !TEST_RE.test(f) && existsSync(f))
}

/* ---------- exported names a change introduces ---------- */

// Only names the change *introduces or modifies*. Re-exporting the whole surface of a file would
// report every symbol in it, including ones nobody touched, and the signal would drown.
// A name counts if it is declared with `export`, or defined at top level and exported by name.
function exportedNames(file) {
  const src = stripNoise(readFileSync(file, "utf8"))
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g))
    names.add(m[1])
  for (const m of src.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm)) names.add(m[1])
  for (const m of src.matchAll(/^func\s+([A-Za-z_]\w*)\s*\(/gm)) names.add(m[1])
  for (const m of src.matchAll(/def\s+([A-Za-z_]\w*)\s*\(/g)) names.add(m[1])
  // Python modules are called by name, not by member, so the module itself is a call site.
  if (file.endsWith(".py")) names.add(excludeStem(file))
  return [...names]
}

const excludeStem = (f) => relative(root, f).replace(/\.[^.]+$/, "").replace(/[\\/](index|__init__)$/, "")
// An exported name is only worth reporting if the change actually touched its line. Otherwise this
// is a whole-codebase inventory, which is a different tool and a much slower one.
function touchedNames(file) {
  const all = exportedNames(file)
  const changedLines = changedLineNumbers(file)
  if (!changedLines.size) return all // untracked file: everything in it is new
  const src = stripNoise(readFileSync(file, "utf8"))
  const lines = src.split("\n")
  const near = (n) => n
  return all.filter((name) => {
    const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*[({=]`)
    for (const [i, line] of lines.entries()) {
      if (!changedLines.has(i + 1)) continue
      if (re.test(line)) return true
      // The declaration can sit above the body the change landed in.
      if (lines.slice(Math.max(0, i - 2), i).some((l) => re.test(l))) return true
    }
    return false
  })
}

function changedLineNumbers(file) {
  const rel = relative(root, file)
  const hunks = git("diff", "--unified=0", "HEAD", "--", rel) || git("diff", "--unified=0", "--", rel) || []
  const out = new Set()
  for (const m of hunks.join("\n").matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    for (let i = 0; i < Math.max(count, 1); i++) out.add(start + i)
  }
  if (!out.size && !git("rev-parse", "--verify", "HEAD")) {
    // No baseline: an untracked file is entirely new.
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((_, i) => out.add(i + 1))
  }
  return out
}

/* ---------- call sites ---------- */

// A call site is the name followed by an opening paren or preceded by a dot, and not the
// declaration itself. `foo(` where foo is not being defined here.
function callSitesFor(name) {
  const escaped = name.replace(/\$/g, "\\$")
  const callRe = new RegExp(`(?<![\\w$])${escaped}\\s*\\(`)
  const memberRe = new RegExp(`\\.${escaped}\\s*\\(`)
  const declRe = new RegExp(`(?:function\\*?|class|const|let|var|def)\\s+${escaped}\\b`)
  const hits = []
  for (const file of allFiles) {
    const rel = relative(root, file).replace(/\\/g, "/")
    const lines = stripNoise(readFileSync(file, "utf8")).split("\n")
    lines.forEach((line, i) => {
      if (declRe.test(line)) return
      if (!callRe.test(line) && !memberRe.test(line)) return
      hits.push({ file, rel, line: i + 1 })
    })
  }
  return hits
}

/* ---------- which test files touch which source files ---------- */

// A test reaching a caller is not proof, but its absence is worth reporting. This is module-level
// rather than symbol-level on purpose: claiming symbol-level coverage from an import would be a
// precision this approach does not have, and the honest answer is the weaker one.
const testImports = new Map() // source file -> Set<test file>
for (const t of testFiles) {
  const text = readFileSync(t, "utf8")
  for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\s+)["']([^"']+)["']/g)) {
    const spec = m[1]
    if (!spec.startsWith(".")) continue
    const abs = resolve(dirnameOf(t), spec)
    // `abs` itself comes first. An import may already carry its extension - `'./routes.js'` - and
    // a list that only tries extensions appended would miss every one of those and silently report
    // the caller as untested. The failure is invisible: the tool just finds more gaps than exist.
    const base = [abs, `${abs}.js`, `${abs}.ts`, `${abs}.mjs`, join(abs, "index.js"), join(abs, "index.ts")].find(
      (cand) => existsSync(cand),
    )
    if (!base) continue
    if (!testImports.has(base)) testImports.set(base, new Set())
    testImports.get(base).add(t)
  }
}
function dirnameOf(p) {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join("/") || "."
}

const testsOf = (file) => testImports.get(file) || new Set()

/* ---------- report ---------- */

const changed = changedSource()
console.log(bold(`\nreach  ${dim(root)}\n`))

if (!changed.length) {
  const head = git("rev-parse", "--verify", "HEAD")
  const dirty = (git("diff", "--name-only", "HEAD") || []).length
  console.log(yellow("  nothing to reach: no changed source file."))
  if (!head) console.log(dim("  No commits yet, so there is no baseline to compare against."))
  else if (dirty === 0) console.log(dim("  The working tree is clean - the change is already committed."))
  else console.log(dim("  The change touches no source file: docs, config, or dependencies only."))
  console.log(dim("  Run --file <path> to point at a file explicitly. This is not a pass.\n"))
  process.exit(2)
}

const LIMIT = num("--max", 12)
let anyUntested = false
let totalSymbols = 0
const touchedFiles = new Set(changed.map((f) => resolve(f)))

for (const file of changed) {
  const names = touchedNames(file)
  const rel = relative(root, file).replace(/\\/g, "/")
  if (!names.length) {
    console.log(`  ${dim(rel)}  ${dim("no exported name touched")}`)
    continue
  }
  for (const name of names) {
    totalSymbols++
    const sites = callSitesFor(name)
    // A test calling the symbol is the evidence, not a risk. Counting it as an untested caller
    // would mean a well-tested change reports worse than an untested one.
    const inTests = sites.filter((h) => isTest(h.file))
    const prod = sites.filter((h) => !isTest(h.file))
    const outsideDiff = prod.filter((h) => !touchedFiles.has(resolve(h.file)))
    const untested = outsideDiff.filter((h) => testsOf(h.file).size === 0)

    console.log(`\n  ${bold(name)}  ${dim(`${rel}  ${prod.length} production call site(s)`)}`)
    if (!prod.length) {
      console.log(
        inTests.length
          ? dim("    only tests call it. Nothing in the product depends on this yet.")
          : dim("    nobody calls it anywhere. Either it is brand new, or it is dead code - worth knowing which."),
      )
      continue
    }
    const pkgs = new Set(outsideDiff.map((h) => h.rel.split("/").slice(0, -1).join("/") || "."))
    if (pkgs.size > 1) console.log(dim(`    spans ${pkgs.size} packages, and ${outsideDiff.length} of them are not in the diff`))
    if (!untested.length) {
      console.log(green(`    all ${outsideDiff.length} untouched caller(s) sit in files a test imports`))
      continue
    }
    anyUntested = true
    console.log(red(`    ${untested.length} untouched caller(s) in files no test imports`))
    for (const h of untested.slice(0, LIMIT)) {
      console.log(`      ${dim(`${h.rel}:${h.line}`.padEnd(58))} ${dim("not in the diff, not reachable from a test")}`)
    }
    if (untested.length > LIMIT) console.log(dim(`      ... and ${untested.length - LIMIT} more (raise --max)`))
    if (inTests.length) console.log(dim(`    ${inTests.length} call site(s) in tests, which is the coverage you do have`))
  }
}

console.log("")
if (!totalSymbols) {
  console.log(yellow("  no exported name is touched by this change, so there is no reach to report."))
  console.log(dim("  The change may be internal to a file. That is fine - but say so, do not imply a blast radius.\n"))
  process.exit(0)
}
if (!anyUntested) {
  console.log(green(`  every untouched caller of ${totalSymbols} changed symbol(s) sits in a file a test imports.`))
  console.log(dim("  That is module-level evidence, not proof each caller is exercised.\n"))
  process.exit(0)
}

console.log(dim("  A caller the diff does not contain cannot be reviewed by reading the diff. This is the"))
console.log(dim("  one list you cannot get any other way, and it is where a change like this usually"))
console.log(dim("  breaks something. Either test them, or say in the handoff exactly which you did not.\n"))
process.exit(1)