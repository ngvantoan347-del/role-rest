#!/usr/bin/env node
/**
 * smells.mjs - scan for the mechanical residue of vibe coding.
 *
 * Finds debt markers, debug leftovers, type/lint suppressions, hardcoded secrets, empty
 * catch blocks, skipped tests, possible commented-out code, oversized files/functions,
 * and changed source code with no test change. Pure Node, no dependencies, no writes.
 *
 * Usage:
 *   node smells.mjs               # scan tracked source files
 *   node smells.mjs --changed     # scan only files touched in the working tree (staged + unstaged + untracked)
 *   node smells.mjs --staged      # staged only
 *   node smells.mjs --strict      # also report `any` casts and long lines
 *   node smells.mjs --json        # machine-readable output
 *   node smells.mjs --max-lines 300 --ignore "*.test.ts,legacy/**"
 *
 * Exit codes: 0 no errors (warnings may remain), 1 at least one error finding.
 */

import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"

/* ---------- args ---------- */

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const changed = has("--changed")
const staged = has("--staged")
const strict = has("--strict")
const json = has("--json")
const color = !has("--no-color") && !json && process.stdout.isTTY !== false
const maxLines = Number(opt("--max-lines", 500))
const maxFuncLines = Number(opt("--max-func-lines", 80))
const ignoreGlobs = opt("--ignore", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => (s.endsWith("**") ? s.slice(0, -2) : s.replace(/\/\*\*$/, "").replace(/\*$/, "")))
const root = process.cwd()

const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const bold = (s) => c("1", s)
const red = (s) => c("31", s)
const yellow = (s) => c("33", s)
const cyan = (s) => c("36", s)

/* ---------- file selection ---------- */

const SRC_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".rs",
  ".java", ".kt", ".kts", ".rb", ".php", ".cs", ".c", ".h", ".cc", ".cpp", ".hpp",
  ".swift", ".scala", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".vue", ".svelte", ".ex", ".exs",
])
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|[^/]+_test\.[a-z]+$/
const SKIP_DIR = new Set([
  "node_modules", "dist", "build", "out", ".git", "vendor", "target", "coverage",
  "__pycache__", ".venv", "venv", ".next", ".nuxt", ".svelte-kit", ".idea", ".vscode",
  "bin", "obj", ".gradle", "Pods", ".terraform", "migrations/generated",
])

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null
}

const isSource = (p) => SRC_EXT.has(extname(p).toLowerCase())
const isTest = (p) => TEST_RE.test(p.replace(/\\/g, "/"))
const ignored = (p) => {
  const n = p.replace(/\\/g, "/")
  return ignoreGlobs.some((g) => n.includes(g.replace(/\\/g, "/")))
}

function walk(dir, out = [], depth = 0) {
  if (depth > 12 || out.length > 5000) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue
      walk(full, out, depth + 1)
    } else if (e.isFile() && isSource(full)) {
      out.push(full)
    }
  }
  return out
}

function selectFiles() {
  let list = []
  if (changed || staged) {
    // A repo with no commits has no HEAD, so fall back to the empty tree.
    const base = git("rev-parse", "--verify", "HEAD") ? "HEAD" : "--cached"
    const cmd = staged
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
      : ["diff", base, "--name-only", "--diff-filter=ACMR"]
    list = git(...cmd) || []
    if (!staged) list = [...new Set([...list, ...(git("ls-files", "--others", "--exclude-standard") || [])])]
  } else {
    const tracked = git("ls-files")
    list = tracked ? tracked : walk(root).map((p) => relative(root, p))
  }
  return [...new Set(list)]
    .filter((p) => isSource(p) && !ignored(p))
    .map((p) => resolve(root, p))
    .filter((p) => {
      try {
        return statSync(p).isFile() && statSync(p).size < 2 * 1024 * 1024
      } catch {
        return false
      }
    })
}

/* ---------- rules ---------- */

const PLACEHOLDER = /(example|sample|dummy|placeholder|changeme|your[_-]?|xxx+|<[^>]+>|process\.env|os\.environ|getenv|redacted|\*\*\*)/i

const RULES = [
  // --- debt markers ---
  { id: "debt-marker", sev: "error", re: /\b(TODO|FIXME|XXX|HACK)\b/, msg: "debt marker left in the tree: needs an owner + tracked issue, or it gets deleted" },
  { id: "unknown-works", sev: "error", re: /\b(idk|should work|works on my machine|don't touch|do not touch|magic number|trust me)\b/i, msg: "unexplained code: comments must say why, or the code goes" },
  { id: "deferred", sev: "warn", re: /\b(quick fix|quickfix|add later|fixme later|for now|temp hack|not implemented yet)\b/i, msg: "deferred work: finish it, or track it" },

  // --- debug leftovers ---
  // A plain string argument is a debug print; a computed argument is usually a CLI's real output.
  // Quoted or interpolation-free template literal. A backtick containing `${` is almost
  // always a CLI's real output rather than a leftover print.
  {
    id: "debug-leftover",
    sev: "warn",
    re: /\bconsole\.(log|debug|dir|trace|table)\s*\(\s*(["']|`(?![^`]*\$\{))/,
    msg: "debug logging with a literal message: is this intentional output?",
  },
  { id: "debug-leftover", sev: "warn", re: /\bconsole\.(debug|dir|trace|table)\s*\(/, msg: "debug logging left behind" },
  { id: "debugger-stmt", sev: "error", re: /^\s*debugger\b|^\s*dbg!\s*\(/, msg: "debugger statement committed" },
  { id: "print-leftover", sev: "warn", re: /\bprint\s*\(|\bvar_dump\s*\(|\bfmt\.Print(ln|f)?\s*\(|System\.out\.print(ln)?\s*\(/, msg: "debug print left behind" },

  // --- suppressions ---
  { id: "ts-ignore", sev: "error", re: /@ts-ignore\b/, msg: "type error suppressed instead of fixed" },
  { id: "lint-suppression", sev: "warn", re: /eslint-disable|@SuppressWarnings\("all"\)|\btype:\s*ignore\b|#\s*noqa\b|\bnoinspection\b/, msg: "lint/type suppression: fix the cause or scope it narrowly with a reason" },

  // --- secrets ---
  { id: "hardcoded-secret", sev: "error", re: /(api[_-]?key|apikey|secret|password|passwd|token|private[_-]?key|access[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i, msg: "possible hardcoded secret: move to env/secret store" },
  { id: "aws-key", sev: "error", re: /\bAKIA[0-9A-Z]{16}\b/, msg: "AWS access key id committed" },
  { id: "private-key", sev: "error", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, msg: "private key committed" },
  { id: "github-token", sev: "error", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, msg: "GitHub token committed: rotate it now" },
  { id: "openai-key", sev: "error", re: /\bsk-[A-Za-z0-9]{20,}\b/, msg: "API key committed: rotate it now" },
  { id: "bearer-literal", sev: "warn", re: /\bBearer\s+[A-Za-z0-9._-]{24,}/, msg: "hardcoded bearer token" },

  // --- silently ignored failures ---
  { id: "empty-catch", sev: "error", re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^\n:]*:\s*(pass|\.\.\.)\s*$/, msg: "exception swallowed: handle it or log it with a reason" },
  { id: "only-comment-catch", sev: "warn", re: /catch\s*(\([^)]*\))?\s*\{\s*\/\/[^\n]*\s*\}/, msg: "exception caught and ignored" },

  // --- disabled tests ---
  { id: "disabled-test", sev: "error", re: /(^|[^.\w])x(it|describe)\s*\(|\.(skip|only)\s*\(|@Ignore\b|@pytest\.mark\.(skip|xfail)|t\.Skip\s*\(|#\[ignore\]/, msg: "test disabled or focused: a permanent blind spot" },
]

// A function whose entire body is a sentinel return and nothing else. Patterns like
// `return null` are legitimate in isolation (parse helpers, cache misses), so only flag
// them when the declaration, the return, and the closing brace are the whole function.
const STUB_BODY = /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+[\w$]+|^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*=\s*(async\s*)?\([^)]*\)\s*=>|^\s*def\s+\w+/

const STRICT_RULES = [
  { id: "any-cast", sev: "warn", re: /\bas\s+any\b|:\s*any\b|<any>|any\[\]|\bdict\b.*#\s*type:\s*ignore/, msg: "type safety bypassed with any" },
  { id: "non-null-assert", sev: "warn", re: /[)\w]!\s*[.;)\[]|\bas\s+const\b/, msg: "non-null assertion / const cast: verify, do not assume" },
]

/* ---------- analyzers ---------- */

const findings = []
const add = (file, line, sev, id, msg, text) => {
  if (sev === "warn" && PLACEHOLDER.test(text)) return
  findings.push({ file, line, sev, id, msg, text: text.trim().slice(0, 100) })
}

const CODE_COMMENT = /^\s*(\/\/|#)\s*(if\b|for\b|while\b|return\b|const\b|let\b|var\b|def\b|class\b|import\b|from\b|export\b|await\b|try\b|catch\b|throw\b|self\.|print\(|console\.|function\b|async\b)/

// Lint configs and static-analysis tools hold debt markers and suppressions as data.
// Reporting a scanner's own rule table back to it is noise, not signal.
const SELF_RELATED =
  /(^|\/)(eslint|biome|ruff|flake8|tsconfig|suppress|lint|scanner|smells|verify)[^/]*$|(config|rc)\.(json|ya?ml|toml|ini)$/i
const FUNC_START = /^\s*(export\s+)?(async\s+)?(function|def|fn|func)\s|^\s*(public|private|protected|static|\s)*(async\s+)?[A-Za-z_$][\w$]*\s*\([^;]*\)\s*(->\s*[\w<>\[\]]+\s*)?\{\s*$|^\s*(class|struct|impl)\s+[A-Za-z_$]/
const BRACEY = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".go", ".rs", ".java", ".kt", ".cs", ".c", ".cc", ".cpp", ".hpp", ".swift", ".scala", ".php", ".vue", ".svelte"])

function analyze(file) {
  const rel = relative(root, file).replace(/\\/g, "/")
  let content
  try {
    content = readFileSync(file, "utf8")
  } catch {
    return
  }
  if (content.includes("\u0000")) return
  const lines = content.split(/\r?\n/)
  const ext = extname(file).toLowerCase()
  const rules = strict ? [...RULES, ...STRICT_RULES] : RULES

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 2000) continue
    const isCommentOnly = /^\s*(\/\/|\/\*|\*|#)/.test(line)
    for (const r of rules) {
      // A lint config or a scanner legitimately contains debt-marker and suppression
      // patterns as data. Scanning them would only ever report the scanner at itself.
      if (SELF_RELATED.test(rel)) continue
      if (r.sev === "warn" && r.id !== "empty-catch" && r.id !== "only-comment-catch" && isCommentOnly) continue
      if (r.re.test(line) && !(r.not && r.not.test(line))) add(rel, i + 1, r.sev, r.id, r.msg, line)
    }
    if (CODE_COMMENT.test(line) && line.trim().length > 12) {
      add(rel, i + 1, "warn", "commented-code", "possible commented-out code: delete it, git remembers", line)
    }
    if (strict && line.length > 160) {
      add(rel, i + 1, "warn", "long-line", `very long line (${line.length} chars)`, line)
    }
  }

  // Stub functions: declaration, sentinel return, closing brace, nothing else.
  for (let i = 0; i < lines.length; i++) {
    if (!STUB_BODY.test(lines[i])) continue
    const body = lines[i + 1]?.trim() ?? ""
    if (!/^(return\s+(null|undefined|None|\{\}|\[\])|pass|throw\s+new\s+Error\(\s*["'`](?:not implemented|TODO))/i.test(body)) continue
    // The sentinel return must be the last statement: the next non-blank line closes the function.
    const next = lines.slice(i + 2).map((l) => l.trim()).find((l) => l !== "")
    if (next !== "}" && next !== ")" && next !== ");") continue
    add(rel, i + 1, isTest(rel) ? "warn" : "error", "stub-function", "function is a stub: implement it or make it throw a clear not-implemented error", lines[i])
  }

  if (lines.length > maxLines) {
    add(rel, 1, "warn", "big-file", `file is ${lines.length} lines (limit ${maxLines}): split by responsibility`, `// ${lines.length} lines`)
  }

  // Function length: brace tracking for curly languages, indentation for Python.
  let reported = 0
  if (BRACEY.has(ext)) {
    let depth = 0
    let start = -1
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (start === -1 && FUNC_START.test(l) && !isTest(rel)) {
        start = i
        depth = 0
      }
      for (const ch of l) {
        if (ch === "{") depth++
        else if (ch === "}") depth--
      }
      if (start !== -1 && depth <= 0 && i > start) {
        const len = i - start + 1
        if (len > maxFuncLines && reported < 3) {
          add(rel, start + 1, "warn", "long-function", `function is ~${len} lines (limit ${maxFuncLines}): split it`, lines[start])
          reported++
        }
        start = -1
      }
      if (start === -1 && depth < 0) depth = 0
    }
  } else if (ext === ".py") {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(async\s+)?def\s+\w+/)
      if (!m) continue
      const base = m[1].length
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && !lines[j].startsWith(" ".repeat(base + 1)) && lines[j].trim()[0] !== "#") {
          end = j
          break
        }
      }
      const len = end - i
      if (len > maxFuncLines && reported < 3) {
        add(rel, i + 1, "warn", "long-function", `function is ~${len} lines (limit ${maxFuncLines}): split it`, lines[i])
        reported++
      }
    }
  }
}

/* ---------- run ---------- */

const files = selectFiles()
if (files.length === 0) {
  console.log(json ? JSON.stringify({ findings: [], scanned: 0 }) : `\n  no source files matched (${changed || staged ? "working-tree selection" : "tracked files"})\n`)
  process.exit(0)
}
for (const f of files) analyze(f)

if (changed || staged) {
  const srcChanged = files.filter((f) => !isTest(f))
  const testChanged = files.filter((f) => isTest(f))
  if (srcChanged.length > 0 && testChanged.length === 0) {
    add("<changed files>", 0, "warn", "no-test-change", `${srcChanged.length} source file(s) changed with no test change: is the new behavior covered?`, "")
  }
}

const SYNTHETIC = "<changed files>"
findings.sort((a, b) => {
  // The synthetic no-test-change entry belongs at the end, not above the real findings.
  if (a.file === SYNTHETIC) return 1
  if (b.file === SYNTHETIC) return -1
  return a.file.localeCompare(b.file) || a.line - b.line
})

if (json) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2))
  process.exit(findings.some((f) => f.sev === "error") ? 1 : 0)
}

const errors = findings.filter((f) => f.sev === "error")
const warns = findings.filter((f) => f.sev === "warn")
const scope = changed ? "working tree" : staged ? "staged" : "tracked files"

console.log(bold(`\nsmells  ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s)  ${dim(`(scanned ${files.length} ${scope})`)}\n`))

let file = null
for (const f of findings) {
  if (f.file !== file) {
    file = f.file
    console.log(cyan(`  ${file}`))
  }
  const tag = f.sev === "error" ? red("error") : yellow("warn ")
  const ln = String(f.line).padStart(5)
  const id = dim(f.id.padEnd(18))
  console.log(`  ${tag} ${dim(ln)}  ${id} ${f.msg}`)
  if (f.text) console.log(`         ${dim(f.text)}`)
  console.log("")
}

console.log(`  ${red(`${errors.length} error(s)`)}  ${yellow(`${warns.length} warning(s)`)}`)
if (errors.length) {
  console.log(red("\n  fix the errors before calling this done. A finding you keep must have an owner and a tracked issue."))
  console.log(dim("  need to keep one? Add a comment with a tracked issue link so the debt has an owner.\n"))
} else if (warns.length) {
  console.log(dim("\n  no blocking errors. Review the warnings: each one is either fixed now or explained in the handoff.\n"))
} else {
  console.log(dim("\n  clean.\n"))
}
process.exit(errors.length ? 1 : 0)
