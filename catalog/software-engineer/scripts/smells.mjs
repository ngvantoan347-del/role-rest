#!/usr/bin/env node
/**
 * smells.mjs - the mechanical residue of vibe coding.
 *
 * Flags what a regex can honestly judge: debt markers, swallowed exceptions, hardcoded
 * secrets, disabled tests, type/lint suppressions, debug leftovers, stub functions, and
 * source changes with no accompanying test. The judgment smells live in
 * references/anti-patterns.md; this script deliberately does not pretend to judge them.
 *
 * Usage:
 *   node smells.mjs               # tracked source files
 *   node smells.mjs --changed     # working tree only (staged + unstaged + untracked)
 *   node smells.mjs --staged      # staged only
 *   node smells.mjs --strict      # also `any` casts, non-null assertions, long lines
 *   node smells.mjs --json        # machine-readable
 *   node smells.mjs --max-lines 300 --max-func-lines 60 --ignore "vendor,legacy"
 *
 * Exit: 0 no errors (warnings may remain), 1 at least one error, 2 bad usage.
 */

import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { extname, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d
}
const { changed, staged, strict, json } = { changed: has("--changed"), staged: has("--staged"), strict: has("--strict"), json: has("--json") }
const color = !has("--no-color") && !json
const maxLines = Number(opt("--max-lines", 500))
const maxFuncLines = Number(opt("--max-func-lines", 80))
const ignore = opt("--ignore", "").split(",").map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean)
const root = process.cwd()

const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const bold = (s) => c("1", s)
const red = (s) => c("31", s)
const yellow = (s) => c("33", s)
const cyan = (s) => c("36", s)

/* ---------- what to scan ---------- */

const SRC_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".rb", ".php", ".cs", ".c", ".h", ".cc", ".cpp", ".hpp", ".swift", ".scala", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".vue", ".svelte", ".ex", ".exs"])
// Config files carry credentials just as often as source does, so they are scanned too -
// but only for secrets. Their style, TODOs, and empty catches are not this tool's business.
const CONF_EXT = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".env", ".tfvars"])
const SECRET_RULES = new Set(["hardcoded-secret", "github-token", "aws-key", "private-key", "bearer-literal"])
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|[^/]+_test\.[a-z]+$/
const ext = (p) => extname(p).toLowerCase()
const isSource = (p) => SRC_EXT.has(ext(p))
const isConfig = (p) => CONF_EXT.has(ext(p)) || /(^|\/)\.env(\.|$)/.test(p.replace(/\\/g, "/"))
const isTest = (p) => TEST_RE.test(p.replace(/\\/g, "/"))
const norm = (p) => p.replace(/\\/g, "/")

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null
}

function selectFiles() {
  let list = []
  if (changed || staged) {
    // A repo with no commits has no HEAD, so fall back to the empty tree.
    const base = git("rev-parse", "--verify", "HEAD") ? "HEAD" : "--cached"
    list = staged ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR") : git("diff", base, "--name-only", "--diff-filter=ACMR")
    if (!staged) list = [...new Set([...(list || []), ...(git("ls-files", "--others", "--exclude-standard") || [])])]
  } else {
    list = git("ls-files") || []
  }
  return [...new Set(list)]
    .filter((p) => (isSource(p) || isConfig(p)) && !ignore.some((g) => norm(p).includes(g)))
    .map((p) => resolve(root, p))
    .filter((p) => {
      try {
        const st = statSync(p)
        return st.isFile() && st.size < 2 * 1024 * 1024
      } catch {
        return false
      }
    })
}

/* ---------- rules ---------- */

const E = (id, re, msg, extra) => ({ id, sev: "error", re, msg, ...extra })
const W = (id, re, msg, extra) => ({ id, sev: "warn", re, msg, ...extra })

// `not` exempts a shape that looks bad but is legitimate in isolation.
const RULES = [
  E("debt-marker", /\b(TODO|FIXME|XXX|HACK)\b/, "debt marker left in the tree: needs an owner + tracked issue, or it gets deleted"),
  E("unknown-works", /\b(idk|should work|works on my machine|don't touch|do not touch|trust me)\b/i, "unexplained code: comments must say why, or the code goes"),
  E("debugger-stmt", /^\s*debugger\b|^\s*dbg!\s*\(/, "debugger statement committed"),
  E("ts-ignore", /@ts-ignore\b/, "type error suppressed instead of fixed"),
  E("empty-catch", /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^\n:]*:\s*(pass|\.\.\.)\s*$/, "exception swallowed: handle it or log it with a reason"),
  E("disabled-test", /(^|[^.\w])x(it|describe)\s*\(|\.(skip|only)\s*\(|@Ignore\b|@pytest\.mark\.(skip|xfail)|t\.Skip\s*\(|#\[ignore\]/, "test disabled or focused: a permanent blind spot"),

  // Secrets are checked everywhere, configs included - a key in a YAML file is still a leak.
  // `["']?` after the name handles quoted JSON/YAML keys: `"password": "value"`.
  E("hardcoded-secret", /(api[_-]?key|apikey|secret|password|passwd|token|private[_-]?key|access[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i, "possible hardcoded secret: move to env/secret store", { not: /(example|sample|dummy|changeme|your[_-]?|xxx+|<[^>]+>|\$\{)/i }),
  E("github-token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}\b/, "token committed: rotate it now"),
  E("aws-key", /\bAKIA[0-9A-Z]{16}\b/, "AWS access key id committed"),
  E("private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key committed"),
  E("bearer-literal", /\bBearer\s+[A-Za-z0-9._-]{24,}/, "hardcoded bearer token"),

  W("deferred", /\b(quick fix|quickfix|add later|fixme later|for now|temp hack|not implemented yet)\b/i, "deferred work: finish it, or track it"),
  // Exempt: a blank line, or a backtick template that interpolates - a CLI's real output.
  W("debug-leftover", /\bconsole\.(log|debug|dir|trace|table)\s*\(|\bvar_dump\s*\(|\bfmt\.Print(ln|f)?\s*\(|System\.out\.print(ln)?\s*\(/, "debug print left behind: intentional output or leftover?", { not: /console\.[a-z]+\s*\(\s*(["'`])(?:[^"'`\\]|\\.|`[^`]*\$\{[^`]*`)*\1\s*[,)]/ }),
  W("lint-suppression", /eslint-disable|@SuppressWarnings\("all"\)|\btype:\s*ignore\b|#\s*noqa\b|\bnoinspection\b/, "lint/type suppression: fix the cause or scope it narrowly with a reason"),
]

// Commented-out code needs two conditions the regex table cannot express: the line must be
// a comment, and long enough to be code rather than a prose note. Hence its own check.
// A comment is suspected of hiding code when what follows reads as a statement: a keyword,
// an assignment, or a call. Prose notes do not match any of these three.
const CODE_COMMENT = /^\s*(\/\/|#)\s*(?:(if|for|while|return|const|let|var|def|class|import|from|export|await|try|catch|throw|function|async|self\.|print\(|console\.)\b|[\w$.[\]]+\s*(=|\(|=[^=]))/

const STRICT_RULES = [
  W("any-cast", /\bas\s+any\b|:\s*any\b|<any>|any\[\]/, "type safety bypassed with any"),
  W("non-null-assert", /[)\w]!\s*[.;)\[]|\bas\s+const\b/, "non-null assertion / const cast: verify, do not assume"),
  W("long-line", /^.{161,}$/, "very long line"),
]

// A declaration whose body is one sentinel return and nothing else.
const STUB_HEAD = /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+[\w$]+|^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*=\s*(async\s*)?\([^)]*\)\s*=>|^\s*def\s+\w+/
const STUB_RETURN = /^(return\s+(null|undefined|None|\{\}|\[\])|pass|throw\s+new\s+Error\(\s*["'`](?:not implemented|TODO))/i
const STUB_END = /^[)}\];]?[)}]?$/

// Lint configs and static-analysis tools hold these patterns as data. Pointing a scanner at
// its own rule table is noise, not signal.
const CONFIG_LIKE = /(^|\/)(eslint|biome|ruff|flake8|tsconfig|suppress|lint|scanner|smells|verify)[^/]*$|(config|rc)\.(json|ya?ml|toml|ini)$/i
const COMMENT = /^\s*(\/\/|\/\*|\*|#)/
const PLACEHOLDER = /(example|sample|dummy|placeholder|changeme|your[_-]?|xxx+|<[^>]+>|process\.env|os\.environ|getenv|redacted|\*\*\*)/i

const findings = []
const add = (file, line, sev, id, msg, text = "") =>
  findings.push({ file, line, sev, id, msg, text: text.trim().slice(0, 100) })

function analyze(file) {
  let content
  try {
    content = readFileSync(file, "utf8")
  } catch {
    return
  }
  if (content.includes("\0")) return

  const rel = norm(relative(root, file))
  const isConf = CONFIG_LIKE.test(rel) || isConfig(file)
  const lines = content.split(/\r?\n/)
  // A config, lint file, or scanner holds these patterns as data. Only secret rules apply.
  const rules = (strict ? [...RULES, ...STRICT_RULES] : RULES).filter((r) => !isConf || SECRET_RULES.has(r.id))
  const test = isTest(rel)

  if (!isConf && lines.length > maxLines) {
    add(rel, 1, "warn", "big-file", `file is ${lines.length} lines (limit ${maxLines}): split by responsibility`)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 2000) continue
    const comment = COMMENT.test(line)

    for (const r of rules) {
      if (comment && r.sev === "warn" && r.id !== "empty-catch") continue
      if (r.re.test(line) && !(r.not && r.not.test(line))) add(rel, i + 1, r.sev, r.id, r.msg, line)
    }
    if (!isConf && !test && comment && line.trim().length > 12 && CODE_COMMENT.test(line)) {
      add(rel, i + 1, "warn", "commented-code", "possible commented-out code: delete it, git remembers", line)
    }
    if (!isConf && STUB_HEAD.test(line)) {
      const body = lines[i + 1]?.trim() ?? ""
      const next = lines.slice(i + 2).map((l) => l.trim()).find((l) => l !== "")
      if (STUB_RETURN.test(body) && next !== undefined && STUB_END.test(next)) {
        add(rel, i + 1, test ? "warn" : "error", "stub-function", "function is a stub: implement it, or throw a clear not-implemented error", line)
      }
    }
  }
}

/* ---------- run ---------- */

// The synthetic no-test-change entry sorts last, so real findings read first.
const SYNTHETIC = "<changed files>"
const files = selectFiles()
if (!files.length) {
  if (json) console.log(JSON.stringify({ scanned: 0, findings: [] }))
  else console.log(`\n  no source files matched (${changed || staged ? "working-tree selection" : "tracked files"})\n`)
  process.exit(0)
}

for (const f of files) analyze(f)

if (changed || staged) {
  const src = files.filter((f) => !isTest(f)).length
  if (src > 0 && !files.some((f) => isTest(f))) {
    add(SYNTHETIC, 0, "warn", "no-test-change", `${src} source file(s) changed with no test change: is the new behavior covered?`)
  }
}

findings.sort((a, b) => (a.file === SYNTHETIC ? 1 : 0) - (b.file === SYNTHETIC ? 1 : 0) || a.file.localeCompare(b.file) || a.line - b.line)

const errors = findings.filter((f) => f.sev === "error")
const warns = findings.filter((f) => f.sev === "warn")

if (json) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2))
  process.exit(errors.length ? 1 : 0)
}

console.log(bold(`\nsmells  ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s)  ${dim(`(scanned ${files.length} ${changed ? "working tree" : staged ? "staged" : "tracked files"})`)}\n`))

let file = null
for (const f of findings) {
  if (f.file !== file) {
    file = f.file
    console.log(cyan(`  ${file}`))
  }
  console.log(`  ${f.sev === "error" ? red("error") : yellow("warn ")} ${dim(String(f.line).padStart(5))}  ${dim(f.id.padEnd(16))} ${f.msg}`)
  if (f.text) console.log(`         ${dim(f.text)}`)
  console.log("")
}

console.log(`  ${red(`${errors.length} error(s)`)}  ${yellow(`${warns.length} warning(s)`)}`)
if (errors.length) {
  console.log(red("\n  fix the errors before calling this done. A finding you keep needs an owner and a tracked issue."))
  console.log(dim("  need to keep one? Add a comment linking the issue, so the debt has an owner."))
} else {
  console.log(dim(warns.length ? "\n  no blocking errors. Each warning is fixed now or explained in the handoff." : "\n  clean."))
}
console.log(dim("\n  This is a regex. It cannot see the failures that actually ship: wrong abstraction,"))
console.log(dim("  logic that is correct but does the wrong thing, breakage at N records or under"))
console.log(dim("  concurrency, and holes that come from intent. Those need reading - see"))
console.log(dim("  references/anti-patterns.md, section A. A clean run here is not a finished change.\n"))
process.exit(errors.length ? 1 : 0)
