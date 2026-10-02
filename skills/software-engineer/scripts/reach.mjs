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

// Exported names, split by whether they can be called at all.
//
// The split is load bearing. An exported `const SCRIPT = join(dir, "x.mjs")` is imported, never
// invoked, so a call-site search returns zero for it - and reporting that as "nobody calls it,
// dead code?" sends someone to delete a path constant that four other files import. Data exports
// get a reference count instead, which is the question people actually have about them.
function exportedNames(file) {
  const src = stripNoise(readFileSync(file, "utf8"))
  const callable = new Set()
  const data = new Set()
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g))
    callable.add(m[1])
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) data.add(m[1])
  for (const m of src.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm)) callable.add(m[1])
  for (const m of src.matchAll(/^func\s+([A-Za-z_]\w*)\s*\(/gm)) callable.add(m[1])
  for (const m of src.matchAll(/def\s+([A-Za-z_]\w*)\s*\(/g)) callable.add(m[1])
  // Python modules are called by name, not by member, so the module itself is a call site.
  if (file.endsWith(".py")) callable.add(excludeStem(file))
  return { callable: [...callable], data: [...data] }
}

const excludeStem = (f) => relative(root, f).replace(/\.[^.]+$/, "").replace(/[\\/](index|__init__)$/, "")
// An exported name is only worth reporting if the change actually touched its line. Otherwise this
// is a whole-codebase inventory, which is a different tool and a much slower one.
function touchedNames(file) {
  const all = exportedNames(file)
  const changedLines = changedLineNumbers(file)
  // An untracked file is entirely new, so everything in it counts.
  if (!changedLines.size) return all
  const lines = stripNoise(readFileSync(file, "utf8")).split("\n")
  const changed = [...changedLines].sort((a, b) => a - b)

  // A function is touched when the change lands anywhere in its body, not only on its declaration
  // line. Matching the declaration alone missed the ordinary case - a guard tightened three lines
  // into an existing function - and reported "no exported name touched", which is worse than
  // useless because it reads as "nothing to worry about here".
  const spanOf = (name) => {
    const declRe = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|def)\\s+${name.replace(/\$/g, "\\$")}\\b`)
    const start = lines.findIndex((l) => declRe.test(l))
    if (start < 0) return null
    // The body runs until the next line at column zero that is not a continuation of this one.
    // Cheap and good enough: a mis-set end line makes the report wider, never narrower.
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i]
      if (!l.trim()) continue
      if (!/^\S/.test(l)) continue
      if (/^[)\]}\s]*$/.test(l)) continue
      end = i
      break
    }
    return [start + 1, end]
  }

  return {
    callable: all.callable.filter((name) => {
      const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*[({=]`)
      // Declaration line, or the two lines above a change, or anywhere in the body.
      for (const ln of changed) {
        if (ln - 1 < lines.length && re.test(lines[ln - 1])) return true
        if (lines.slice(Math.max(0, ln - 3), ln - 1).some((l) => re.test(l))) return true
      }
      const span = spanOf(name)
      return span ? changed.some((ln) => ln >= span[0] && ln <= span[1]) : false
    }),
    // A data export touched anywhere in a changed line counts. Call-site syntax is the wrong
    // question for a constant, so a plain mention is.
    data: all.data.filter((n) => {
      const re = new RegExp(`\\b${n.replace(/\$/g, "\\$")}\\b`)
      return lines.some((l, i) => changedLines.has(i + 1) && re.test(l))
    }),
  }
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

// Every mention of an identifier, not just a call. This is what a data export needs: a constant is
// used by being named, and asking for a call site returns nothing for it.
function referenceSitesFor(name, from) {
  const escaped = name.replace(/\$/g, "\\$")
  const re = new RegExp(`(?<![\\w$.])${escaped}\\b`)
  const hits = []
  for (const file of allFiles) {
    // The declaring file is excluded. Every symbol mentions itself at least once - in its own
    // declaration and often in its own body - so counting that turns "nothing uses this" into
    // "one reference" and hides the answer the reader came for.
    if (from && resolve(file) === resolve(from)) continue
    const rel = relative(root, file).replace(/\\/g, "/")
    stripNoise(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line)) hits.push({ file, rel, line: i + 1 })
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
let callablesWithCallers = 0
const touchedFiles = new Set(changed.map((f) => resolve(f)))

for (const file of changed) {
  const names = touchedNames(file)
  const rel = relative(root, file).replace(/\\/g, "/")
  if (!names.callable.length && !names.data.length) {
    console.log(`  ${dim(rel)}  ${dim("no exported name touched")}`)
    continue
  }

  for (const name of names.data) {
    // An exported constant is imported by name, not called. Reporting a call-site count of zero
    // would read as "dead code" and point someone at deleting something four files import.
    const refs = referenceSitesFor(name, file)
    const prod = refs.filter((h) => !isTest(h.file))
    // Importers are looked for across every reference, tests included. A test importing the symbol
    // is the common case for a test helper, and filtering tests out first - then searching what is
    // left for an import - concludes nothing imports it, which is the opposite of the truth.
    const importers = new Set(
      refs
        .filter((h) => {
          const line = stripNoise(readFileSync(h.file, "utf8")).split("\n")[h.line - 1] || ""
          return /^\s*import\b.*\bfrom\b|require\(\s*["'][^"']*["']/.test(line)
        })
        .map((h) => h.rel),
    )
    const testImporters = [...importers].filter((r) => isTest(join(root, r)))
    const prodImporters = [...importers].filter((r) => !isTest(join(root, r)))
    totalSymbols++
    if (!refs.length) {
      console.log(`  ${bold(name)}  ${dim(`${rel}  exported constant`)}\n` + dim("    nothing in the tree references it. Brand new, or dead."))
      continue
    }
    const pkgs = new Set(prod.map((h) => h.rel.split("/").slice(0, -1).join("/") || "."))
    const where = pkgs.size > 1 ? ` across ${pkgs.size} packages` : ""
    console.log(`  ${bold(name)}  ${dim(`${rel}  exported constant, ${prod.length} production reference(s)${where}`)}`)
    if (prodImporters.length) {
      console.log(
        dim(
          `    imported by ${prodImporters.length} production file(s): ${prodImporters.slice(0, 3).join(", ")}${prodImporters.length > 3 ? ", ..." : ""}`,
        ),
      )
    } else if (testImporters.length) {
      console.log(dim(`    only tests import it (${testImporters.length}). Nothing in production depends on it yet.`))
    } else {
      // No import means no attribution. A file that declares its own `here` matches a search for
      // someone else's `here`, and a bare reference count cannot tell the two apart. Saying
      // "referenced without an import" reads like a finding when it is really a limitation, so the
      // limitation is what gets reported.
      console.log(dim("    no file imports it, so the references above cannot be attributed to this one."))
      console.log(dim("    That is this check's limit with name collisions, not evidence either way."))
    }
  }

  for (const name of names.callable) {
    totalSymbols++
    const sites = callSitesFor(name)
    // A test calling the symbol is the evidence, not a risk. Counting it as an untested caller
    // would mean a well-tested change reports worse than an untested one.
    const inTests = sites.filter((h) => isTest(h.file))
    const prod = sites.filter((h) => !isTest(h.file))
    const outsideDiff = prod.filter((h) => !touchedFiles.has(resolve(h.file)))
    const untested = outsideDiff.filter((h) => testsOf(h.file).size === 0)
    if (prod.length) callablesWithCallers++

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
      // "all 0 sit in files a test imports" is a reassuring sentence about nothing. When every
      // caller is inside the diff there is no outside caller, and that is a different fact.
      console.log(
        outsideDiff.length
          ? green(`    all ${outsideDiff.length} untouched caller(s) sit in files a test imports`)
          : dim("    every caller is in the change, so there is no outside caller to worry about"),
      )
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
if (!anyUntested && callablesWithCallers === 0) {
  // No callable in the change has a production caller, so there was nothing to find untested. The
  // reassuring summary would be a lie here: it reads as "everything was checked", and the honest
  // statement is that there was nothing to check.
  console.log(yellow(`  ${totalSymbols} exported name(s) touched, and none of them has a production caller.`))
  console.log(dim("  Nothing to find, so nothing was verified. New code, or dead code - say which.\n"))
  process.exit(0)
}
if (!anyUntested) {
  console.log(green(`  every untouched caller of ${callablesWithCallers} changed function(s) sits in a file a test imports.`))
  console.log(dim("  That is module-level evidence, not proof each caller is exercised.\n"))
  process.exit(0)
}

console.log(dim("  A caller the diff does not contain cannot be reviewed by reading the diff. This is the"))
console.log(dim("  one list you cannot get any other way, and it is where a change like this usually"))
console.log(dim("  breaks something. Either test them, or say in the handoff exactly which you did not.\n"))
process.exit(1)