#!/usr/bin/env node
/**
 * smells.mjs - the mechanical residue of vibe coding.
 *
 * Flags what a regex can honestly judge: debt markers, swallowed exceptions, hardcoded
 * secrets, disabled tests, type/lint suppressions, debug leftovers, stub functions, and
 * source changes with no accompanying test. The judgment smells live in
 * references/anti-patterns.md; this script deliberately does not pretend to judge them.
 *
 * The rule set is not frozen. At company scale the interesting rules live in the repo -
 * the things your security team blocks, the internal patterns your own linter forbids - so
 * `.software-engineer.json` can add, disable, or re-rank any rule without touching this file.
 *
 * Usage:
 *   node smells.mjs                     # tracked source files
 *   node smells.mjs --changed           # working tree (staged + unstaged + untracked)
 *   node smells.mjs --changed --base main   # diff against a branch, not HEAD
 *   node smells.mjs --staged            # staged only
 *   node smells.mjs --strict            # also `any` casts, non-null assertions, long lines
 *   node smells.mjs --max-warnings 0   # fail the build on warnings too
 *   node smells.mjs --format text|json|sarif|github
 *   node smells.mjs --config path.json
 *   node smells.mjs --ignore "vendor/**,legacy/**" --max-lines 400
 *
 * Exit: 0 within thresholds, 1 errors (or too many warnings), 2 bad usage.
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
const { changed, staged, strict } = { changed: has("--changed"), staged: has("--staged"), strict: has("--strict") }
const format = opt("--format", "text")
const baseRef = opt("--base", null)
const configPath = opt("--config", null)
const color = !has("--no-color") && format === "text" && process.stdout.isTTY !== false

if (!["text", "json", "sarif", "github"].includes(format)) {
  console.error(`unknown --format: ${format} (expected text, json, sarif, github)`)
  process.exit(2)
}

const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const bold = (s) => c("1", s)
const red = (s) => c("31", s)
const yellow = (s) => c("33", s)
const cyan = (s) => c("36", s)

const root = process.cwd()

/* ---------- config ---------- */

const CFG_FILE = ".software-engineer.json"
const cfgRoot = (() => {
  const load = (p) => {
    try {
      return JSON.parse(readFileSync(p, "utf8"))
    } catch {
      return null
    }
  }
  const f = load(resolve(root, CFG_FILE)) || load(resolve(root, "software-engineer.json"))
  return f || {}
})()
let cfg = cfgRoot.smells || {}
if (configPath) {
  const raw = (() => {
    try {
      return JSON.parse(readFileSync(resolve(root, configPath), "utf8"))
    } catch (e) {
      console.error(`cannot read config ${configPath}: ${e.message}`)
      process.exit(2)
    }
  })()
  cfg = raw.smells || raw
}

// A flag wins over the config file. `||` would be wrong for every threshold here: a budget of
// 0 is the strictest setting there is, and `Number(0) || fallback` silently discards it.
const num = (flag, key, d) => {
  const raw = argv.includes(flag) ? opt(flag, null) : key in cfg ? cfg[key] : null
  if (raw === null || raw === undefined || raw === "") return d
  const n = Number(raw)
  return Number.isFinite(n) ? n : d
}
const maxLines = num("--max-lines", "maxLines", 500)
const maxFuncLines = num("--max-func-lines", "maxFuncLines", 80)
const longLine = num("--long-line", "longLine", 160)
const maxWarnings = num("--max-warnings", "maxWarnings", Infinity)

// Ignore entries may be a plain substring (today's behaviour) or a glob. Glob wins when given,
// because a substring cannot express "only at the top level".
const ignoreRaw = [...(cfg.ignore || []), ...String(opt("--ignore", "")).split(",")]
  .map((s) => String(s).trim().replace(/\\/g, "/"))
  .filter(Boolean)
const globToRe = (g) => {
  const out = []
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]
    if (ch === "*") {
      if (g[i + 1] === "*") {
        out.push(".*")
        i++
        if (g[i + 1] === "/") i++
      } else out.push("[^/]*")
    } else if (ch === "?") out.push("[^/]")
    else out.push(ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
  }
  return new RegExp("^" + out.join("") + "$")
}
const ignorers = ignoreRaw.map((g) => ({ re: g.includes("*") || g.includes("?") ? globToRe(g) : null, sub: g }))
const ignored = (p) => {
  const n = p.replace(/\\/g, "/")
  return ignorers.some((g) => (g.re ? g.re.test(n) : n.includes(g.sub)))
}

/* ---------- what to scan ---------- */

const SRC_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".rb", ".php", ".cs", ".c", ".h", ".cc", ".cpp", ".hpp", ".swift", ".scala", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".vue", ".svelte", ".ex", ".exs"])
// Config files carry credentials just as often as source does, so they are scanned too -
// but only for secrets. Their style, TODOs, and empty catches are not this tool's business.
const CONF_EXT = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".env", ".tfvars"])
const SECRET_RULES = new Set(["hardcoded-secret", "github-token", "aws-key", "private-key", "bearer-literal", "env-default-secret"])
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|[^/]+_test\.[a-z]+$/
// A diff line that adds nothing executable: blank, a comment, a docstring, or markup.
const NON_CODE_LINE = /^\s*(\/\/|\/\*|\*|#\s|--|<!--|<\/?[a-z]|[\w-]+:\s*$)/i
// Paths that cannot hold behaviour worth a test: prose, markup, lockfiles, CI config.
const NON_SUBSTANTIVE_PATH = /\.(md|mdx|rst|txt|adoc|lock|log|json|ya?ml|toml)$|(^|\/)(CHANGELOG|CONTRIBUTING|README|LICENSE|CODEOWNERS)(\..*)?$|^\.github\//
const ext = (p) => extname(p).toLowerCase()
const isSource = (p) => SRC_EXT.has(ext(p))
const isConfig = (p) => CONF_EXT.has(ext(p)) || /(^|\/)\.env(\.|$)/.test(p.replace(/\\/g, "/"))
const isTest = (p) => TEST_RE.test(p.replace(/\\/g, "/"))
const norm = (p) => p.replace(/\\/g, "/")

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null
}

// Resolve the comparison point once, so --changed means "what this branch changed" rather
// than "what I have staged". Enterprise review is a branch-versus-main question.
function diffBase() {
  if (baseRef) return baseRef
  if (!git("rev-parse", "--verify", "HEAD")) return null
  for (const cand of ["origin/main", "origin/master", "main", "master"]) {
    const m = git("merge-base", "HEAD", cand)
    if (m && m[0]) return m[0]
  }
  return null
}

function selectFiles() {
  let list = []
  if (changed || staged) {
    if (staged) list = git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    else {
      const b = diffBase()
      // No commits yet, or no resolvable base: fall back to the empty tree plus the index.
      const from = b || (git("rev-parse", "--verify", "HEAD") ? "HEAD" : null)
      list = from ? git("diff", "--name-only", "--diff-filter=ACMR", from) : git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
      for (const f of git("ls-files", "--others", "--exclude-standard") || []) list.push(f)
    }
  } else {
    list = git("ls-files") || []
  }
  return [...new Set(list)]
    .filter((p) => (isSource(p) || isConfig(p)) && !ignored(p))
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

// Count executable lines added by the diff. Used only by `no-test-change`, where the question is
// "did any behaviour change at all" - which is answerable from added lines without parsing code.
function addedCodeLines() {
  const base = diffBase()
  const from = base || (git("rev-parse", "--verify", "HEAD") ? "HEAD" : null)
  const args = from ? ["diff", "-U0", "--diff-filter=ACMR"] : ["diff", "--cached", "-U0", "--diff-filter=ACMR"]
  const r = spawnSync("git", [...args, ...(from ? [from] : [])], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return 1 // cannot tell: assume there is a change rather than reporting nothing

  const added = []
  const removed = []
  for (const line of (r.stdout || "").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (NON_CODE_LINE.test(line.slice(1))) continue
    // Whitespace-insensitive: a reformatted line is not a behaviour change, and treating it as
    // one makes every prettier run look like an untested code change.
    const key = line.slice(1).replace(/\s+/g, "")
    if (line.startsWith("+")) added.push(key)
    else if (line.startsWith("-")) removed.push(key)
  }
  const stillThere = added.filter((k) => !removed.includes(k))

  // `git diff` cannot see an untracked file, so a brand-new source file would read as zero added
  // lines and silently escape the check. Count its content directly.
  for (const f of git("ls-files", "--others", "--exclude-standard") || []) {
    if (isTest(f) || !isSource(f)) continue
    if (NON_SUBSTANTIVE_PATH.test(norm(f))) continue
    try {
      const text = readFileSync(resolve(root, f), "utf8")
      const n = text.split("\n").filter((l) => l.trim() && !NON_CODE_LINE.test(l)).length
      if (n > 0) return n
    } catch {
      return 1
    }
  }
  return stillThere.length
}

// A value that is obviously not a credential. Scoped to the VALUE side deliberately: it must not
// match `process.env.SECRET || "..."`, because reading the secret from the environment is the
// correct pattern and exempting it on the left of the `||` would silence the exact bug the
// `env-default-secret` rule exists to catch.
const PLACEHOLDER_VALUE = /(example|sample|dummy|placeholder|changeme|your[_-]?|xxx+|<[^>]+>|redacted|\*\*\*)/i

// Rules whose matches live in prose, so they must keep firing inside comments. Declared once
// here rather than inline in the scan loop, where a per-rule Set was allocated on every line.
const IN_COMMENT_OK = new Set(["empty-catch", "deferred", "unknown-works", "debt-marker"])

const E = (id, re, msg, extra) => ({ id, sev: "error", re, msg, ...extra })
const W = (id, re, msg, extra) => ({ id, sev: "warn", re, msg, ...extra })

// `not` exempts a shape that looks bad but is legitimate in isolation.
const BUILTIN = [
  // A marker WITH an owner and a tracked reference is managed debt, which the skill explicitly
  // permits. The exemption matters: if the only way to silence a finding is to delete the
  // comment, people delete the comment, and the debt becomes invisible rather than owned.
  E("debt-marker", /\b(TODO|FIXME|XXX|HACK)\b/, "debt marker left in the tree: add an owner and a tracked issue, or it gets deleted", {
    not: /\b(owner|assignee|assigned to|tracked|follow.?up|ticket|issue|PL-\d|[A-Z]{2,}-\d+|#\d+|https?:\/\/\S+\/(issues|pull)\/\d+)\b/i,
  }),
  E("unknown-works", /\b(idk|should work|works on my machine|don't touch|do not touch|trust me)\b/i, "unexplained code: comments must say why, or the code goes"),
  E("debugger-stmt", /^\s*debugger\b|^\s*dbg!\s*\(/, "debugger statement committed"),
  E("ts-ignore", /@ts-ignore\b/, "type error suppressed instead of fixed"),
  E("empty-catch", /catch\s*(\([^)]*\))?\s*\{\s*\}|\.(catch|then)\s*\(\s*\(?[\w\s,]*\)?\s*=>\s*\{?\s*\}?\s*\)|except[^\n:]*:\s*(pass|\.\.\.)\s*$/, "exception swallowed: handle it or log it with a reason"),
  E("disabled-test", /(^|[^.\w])x(it|describe)\s*\(|\.(skip|only)\s*\(|@Ignore\b|@pytest\.mark\.(skip|xfail)|t\.Skip\s*\(|#\[ignore\]/, "test disabled or focused: a permanent blind spot"),
  E("merge-marker", /^<{7}( |$)|^\|{7}( |$)|^={7}\s*$/, "unresolved merge conflict committed"),

  // Secrets are checked everywhere, configs included - a key in a YAML file is still a leak.
  // `["']?` after the name handles quoted JSON/YAML keys: `"password": "value"`.
  E("hardcoded-secret", /(api[_-]?key|apikey|secret|password|passwd|token|private[_-]?key|access[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i, "possible hardcoded secret: move to env/secret store", { not: new RegExp(`(example|sample|dummy|changeme|your[_-]?|xxx+|<[^>]+>|\\$\\{)|${PLACEHOLDER_VALUE.source}`) }),
  E("env-default-secret", /(api[_-]?key|secret|password|passwd|token|private[_-]?key)["']?\s*\)?\s*(?:,\s*|\|\|\s*|or\s+)["'][^"'\s]{4,}["']/i, "secret falls back to a hardcoded value: a missing env var silently becomes a known secret", { not: new RegExp(`(example|sample|dummy|changeme|your[_-]?|xxx+|<[^>]+>|\\$\\{)|${PLACEHOLDER_VALUE.source}`) }),
  E("github-token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}\b/, "token committed: rotate it now"),
  E("aws-key", /\bAKIA[0-9A-Z]{16}\b/, "AWS access key id committed"),
  E("private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key committed"),
  E("bearer-literal", /\bBearer\s+[A-Za-z0-9._-]{24,}/, "hardcoded bearer token"),

  // These are the findings a security review blocks a PR over, and none of them fail a test.
  // Matched at the sink, not at the template literal: in JS and TS a backtick is a template
  // literal, so flagging "`${x}`" on its own flags every string concatenation in the language.
  // The dangerous form is a template literal reaching exec(), which the exec patterns below
  // already catch where the value actually lands.
  E(
    "shell-injection",
    /shell\s*=\s*True|os\.system\s*\(|child_process\.exec\s*\(|Runtime\.getRuntime\(\)\.exec\s*\(|ProcessBuilder\s*\(|subprocess\.(Popen|run|call|check_output)\s*\(|system\s*\(\s*["'`]|\bshell_exec\s*\(|\b(popen|system)\s*\(/,
    "command built as a string for a shell: pass argv or use a parameterised call, never interpolation"
  ),
  E("tls-verify-off", /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(false|0)|ssl\._create_unverified_context|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/, "TLS verification disabled: one proxy is not a reason to trust every certificate"),
  E("unsafe-deserialize", /pickle\.loads?\s*\(|yaml\.load\s*\((?![^)]*Safe)|marshal\.loads?\s*\(|ObjectInputStream|unserialize\s*\(/, "unsafe deserialization of untrusted input: it is remote code execution"),
  E("sql-string-build", /\b(SELECT|INSERT|UPDATE|DELETE)\b[^\n;]*?(\+\s*[\w(]|\$\{|\bformat\s*\(|%\s*\(?\w|\bf["'][^"']*\bSELECT|\bf["'][^"']*\b(INSERT|UPDATE|DELETE)\b)/i, "SQL built by string interpolation: use a parameterised query"),

  W("deferred", /\b(quick fix|quickfix|add later|fixme later|for now|temp hack|not implemented yet)\b/i, "deferred work: finish it, or track it"),
  // Exempt: a blank line, or a backtick template that interpolates - a CLI's real output.
  W("debug-leftover", /\bconsole\.(log|debug|dir|trace|table)\s*\(|\bfmt\.Print(ln|f)?\s*\(|System\.out\.print(ln)?\s*\(/, "debug print left behind: intentional output or leftover?", { not: /console\.[a-z]+\s*\(\s*(["'`])(?:[^"'`\\]|\\.|`[^`]*\$\{[^`]*`)*\1\s*[,)]/ }),
  W("lint-suppression", /eslint-disable|@SuppressWarnings\("all"\)|\btype:\s*ignore\b|#\s*noqa\b|\bnoinspection\b/, "lint/type suppression: fix the cause or scope it narrowly with a reason"),
  W("bare-except", /except\s*:/, "bare except also swallows KeyboardInterrupt and SystemExit: name the exception you handle"),
]

// Commented-out code needs two conditions the regex table cannot express: the line must be
// a comment, and long enough to be code rather than a prose note. Hence its own check.
// A comment is suspected of hiding code when what follows reads as a statement: a keyword,
// an assignment, or a call. Prose notes do not match any of these three.
const CODE_COMMENT = /^\s*(\/\/|#)\s*(?:(if|for|while|return|const|let|var|def|class|import|from|export|await|try|catch|throw|function|async|self\.|print\(|console\.)\b|[\w$.[\]]+\s*(=|\(|=[^=]))/

const STRICT_BUILTIN = [
  W("any-cast", /\bas\s+any\b|:\s*any\b|<any>|any\[\]/, "type safety bypassed with any"),
  W("non-null-assert", /[)\w]!\s*[.;)\[]|\bas\s+const\b/, "non-null assertion / const cast: verify, do not assume"),
  W("long-line", new RegExp(`^.{${longLine + 1},}$`), `very long line (limit ${longLine})`),
]

// Determinism rules fire only in test files, because a live clock in a test is a flaky suite
// while the same call in production code is the whole point. `references/testing-guide.md`
// lists determinism as a requirement; these catch the two ways it gets broken silently.
const TEST_BUILTIN = [
  W("nondeterministic-test", /Date\.now\s*\(|new\s+Date\s*\(\s*\)|time\.time\s*\(|datetime\.(now|utcnow)\s*\(|Math\.random\s*\(|random\.(random|randint|choice|shuffle)\s*\(/, "test depends on the real clock or random source: inject it, or the suite fails on someone else's machine"),
  W("sleep-in-test", /time\.sleep\s*\(|setTimeout\s*\(\s*[\w.]+\s*,\s*\d|sleep\s+\d+/, "test waits for wall-clock time: await the condition instead of the duration"),
  W("assert-in-test", /^\s*assert\s+\w/, "python `assert` is stripped under -O: use unittest/pytest assertions that cannot be optimised away"),
]

// A declaration whose body is one sentinel return and nothing else.
const STUB_HEAD = /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+[\w$]+|^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*=\s*(async\s*)?\([^)]*\)\s*=>|^\s*def\s+\w+/
const STUB_RETURN = /^(return\s+(null|undefined|None|\{\}|\[\])|pass|throw\s+new\s+Error\(\s*["'`](?:not implemented|TODO))/i
const STUB_END = /^[)}\];]?[)}]?$/

// Matching a function's extent needs an indentation rule rather than a regex on one line, since
// the body's last line is somewhere below the declaration. Blocks are opened by a brace, a
// colon, or a python `def`, and closed when the indent returns to the opening level. This is
// approximate on purpose: it counts lines, it does not need to parse.
function bodyLines(lines, start) {
  const head = lines[start]
  const pyLike = /^\s*def\s+\w+/.test(head)
  const indent = (head.match(/^[ \t]*/) || [""])[0].length
  const opener = pyLike ? null : head.match(/\{/)
  let last = start
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const ind = (line.match(/^[ \t]*/) || [""])[0].length
    if (pyLike ? ind <= indent : ind <= indent && !opener) break
    if (pyLike ? ind <= indent : ind <= indent) break
    last = i
    // A hard brace balance is more reliable than indentation inside a single line, so prefer it.
    if (!pyLike && opener) {
      const opens = (line.match(/\{/g) || []).length
      const closes = (line.match(/\}/g) || []).length
      if (closes > opens && ind <= indent) break
    }
    if (i - start > maxFuncLines * 4) break
  }
  return last - start
}

// Lint configs and static-analysis tools hold these patterns as data. Pointing a scanner at
// its own rule table is noise, not signal.
const CONFIG_LIKE = /(^|\/)(eslint|biome|ruff|flake8|tsconfig|suppress|lint|scanner|smells|verify)[^/]*$|(config|rc)\.(json|ya?ml|toml|ini)$/i

// A scanner or rule file is exempt from *every* rule, secrets included: its job is to spell
// out what a secret looks like, and its ignore list is a list of secret-shaped names. This is
// separate from CONFIG_LIKE on purpose - a .env or a CI yaml holds credentials and must still
// be scanned for them, while a rule table only holds the description of one.
const RULE_TABLE = /(^|\/)(eslint|biome|ruff|flake8|suppress|scanner|smells|verify|ci|proof|deno|sonar)[^/]*\.(m?[jt]sx?|py|rb|go|rs)$/i

// An inline escape hatch, required to be honest about itself: a bare suppression hides the
// finding with no record of why. `smells:allow <id>` silences one rule on that line and
// `smells:allow <id> -- <reason>` records the reason next to it, so a reviewer can see it.
const ALLOW = /smells:allow\s+([a-z0-9-]+)\s*(?:--\s*(.*))?$/

// The test suite for a scanner is mostly made of the things the scanner hunts for: fixture
// strings containing planted secrets, real timers measuring real durations, deliberate bad
// code quoted as a string. Flagging those teaches people to ignore the scanner, which is
// worse than having none. Scoped to a scanner's own harness - production code with the same
// shapes is still reported.
const HARNESS = /(^|\/)(tests?\/[\w.-]+\.mjs|tests?\/[\w.-]+\.ts|[\w.-]+\.test\.[a-z]+|[\w.-]+\.spec\.[a-z]+)$/

// ...and only when the file really is a harness for a scanner, which it proves by referencing
// one. A test file that happens to live in tests/ is scanned normally: this is not a blanket
// exemption for test directories, which is where a real leaked secret would sit.
const SCANNER_HARNESS = /\b(smells|verify)\.mjs\b/
const COMMENT = /^\s*(\/\/|\/\*|\*|#)/

// Repo-supplied rules go through the same shape and the same exemptions as built-ins, so a
// custom rule cannot quietly skip the "this is only a warning" or test-file carve-outs.
function buildRules() {
  const custom = []
  for (const r of cfg.rules || []) {
    if (!r || !r.id || !r.pattern) {
      console.error(`smells: rule needs an "id" and a "pattern": ${JSON.stringify(r)}`)
      process.exit(2)
    }
    let re
    try {
      re = new RegExp(r.pattern, r.flags || "")
    } catch (e) {
      console.error(`smells: rule "${r.id}" has an invalid pattern: ${e.message}`)
      process.exit(2)
    }
    custom.push({ id: String(r.id), sev: r.severity === "error" ? "error" : "warn", re, msg: String(r.message || "matches repo policy"), not: r.not ? new RegExp(r.not) : undefined, test: r.test === true, config: r.config === true })
  }
  const disabled = new Set(cfg.disable || [])
  const rerank = cfg.severity || {}
  // `native` remembers what the rule was before a repo re-ranked it, because two rules below
  // branch on the original severity: which patterns are searched inside comments, and which
  // still count as a secret in a config file. Re-ranking must not silently delete a finding.
  const rank = (r) => ({ ...r, native: r.sev, sev: rerank[r.id] === "error" || rerank[r.id] === "warn" ? rerank[r.id] : r.sev })
  const all = [
    ...BUILTIN.map(rank),
    ...(strict ? STRICT_BUILTIN.map(rank) : []),
    ...custom,
    // Test-only rules are appended last so a normal source file never pays for them.
    ...TEST_BUILTIN.map((r) => ({ ...rank(r), testOnly: true })),
  ].filter((r) => !disabled.has(r.id))
  return (isTestFile) => all.filter((r) => (r.testOnly ? isTestFile : true))
}

const findings = []
const add = (file, line, sev, id, msg, text = "") => findings.push({ file, line, sev, id, msg, text: text.trim().slice(0, 100) })

function analyze(file, rulesFor) {
  let content
  try {
    content = readFileSync(file, "utf8")
  } catch {
    return
  }
  if (content.includes("\0")) return

  const rel = norm(relative(root, file))
  const ruleTable = RULE_TABLE.test(rel) || (HARNESS.test(rel) && SCANNER_HARNESS.test(content))
  const isConf = CONFIG_LIKE.test(rel) || isConfig(file)
  const lines = content.split(/\r?\n/)
  // A config, lint file, or scanner holds these patterns as data. Only secret rules apply -
  // unless the file is itself a scanner, which is exempt entirely.
  const rules = ruleTable ? [] : rulesFor(isTest(rel)).filter((r) => !isConf || SECRET_RULES.has(r.id) || r.config)
  const test = isTest(rel)
  // Line number -> allowed rule id, for the inline escape hatch.
  const suppressed = new Map()
  const firstFinding = findings.length

  if (!isConf && lines.length > maxLines) {
    add(rel, 1, "warn", "big-file", `file is ${lines.length} lines (limit ${maxLines}): split by responsibility`)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 2000) continue
    const comment = COMMENT.test(line)

    for (const r of rules) {
      // Warnings are skipped inside comments on purpose - "console.log" quoted in a prose note
      // is not a finding. But a debt marker lives in a comment by definition, so the rules whose
      // whole job is finding things written in prose are exempt from that skip. Without this, a
      // file of `// add later` and `// quick fix` reports clean, which is the exact residue the
      // skill is named for. `native` keeps a re-ranked error behaving like an error, so
      // downgrading a rule cannot delete its findings from comments.
      if (comment && r.native === "warn" && !IN_COMMENT_OK.has(r.id)) continue
      if (r.re.test(line) && !(r.not && r.not.test(line))) add(rel, i + 1, r.sev, r.id, r.msg, line)
    }
    if (!isConf && !test && comment && line.trim().length > 12 && CODE_COMMENT.test(line)) {
      add(rel, i + 1, "warn", "commented-code", "possible commented-out code: delete it, git remembers", line)
    }
    // An inline allow silences exactly the named rule, and a missing `-- reason` is itself a
    // finding: a suppression nobody can explain is just a deleted rule. Trailing form covers
    // this line; a comment on its own line covers the next one, which is the only way to
    // annotate a block that has no room at the end.
    const allow = line.match(ALLOW)
    if (allow) {
      const id = allow[1]
      if (!allow[2] || !allow[2].trim()) add(rel, i + 1, "warn", "bare-suppression", `\`smells:allow ${id}\` has no reason; add \`-- why\``, line)
      const rest = line.replace(allow[0], "").trim()
      if (COMMENT.test(line) && !rest.replace(COMMENT, "").trim()) {
        const next = lines.slice(i + 1).findIndex((l) => l.trim() !== "")
        if (next >= 0) suppressed.set(i + 2 + next, id)
      } else {
        suppressed.set(i + 1, id)
      }
    }
    if (!isConf && STUB_HEAD.test(line)) {
      const body = lines[i + 1]?.trim() ?? ""
      const next = lines.slice(i + 2).map((l) => l.trim()).find((l) => l !== "")
      if (STUB_RETURN.test(body) && next !== undefined && STUB_END.test(next)) {
        add(rel, i + 1, test ? "warn" : "error", "stub-function", "function is a stub: implement it, or throw a clear not-implemented error", line)
      }
    }
    // Reported on the declaration line so it points at the thing that needs splitting. A long
    // function is the one size signal that reliably predicts an unreviewable diff, and it was
    // the one threshold `--max-func-lines` was documented to police but never checked.
    if (!isConf && STUB_HEAD.test(line) && !test) {
      const n = bodyLines(lines, i)
      if (n > maxFuncLines) add(rel, i + 1, "warn", "long-function", `function is ${n} lines (limit ${maxFuncLines}): split at the seams you can name`, line)
    }
  }

  // Applied last so an allow comment can appear anywhere on the line, including before the
  // match it silences. Only the named rule is affected: an allow for one id must not quietly
  // hide the next error on the same line.
  for (let i = findings.length - 1; i >= firstFinding; i--) {
    const f = findings[i]
    if (f.file === rel && suppressed.get(f.line) === f.id) findings.splice(i, 1)
  }
}

/* ---------- run ---------- */

// The synthetic no-test-change entry sorts last, so real findings read first.
const SYNTHETIC = "<changed files>"
const files = selectFiles()
if (!files.length) {
  if (format === "json") console.log(JSON.stringify({ scanned: 0, findings: [], summary: { error: 0, warn: 0 } }, null, 2))
  else if (format === "sarif") console.log(sarif([]))
  else console.log(`\n  no source files matched (${changed || staged ? "working-tree selection" : "tracked files"})\n`)
  process.exit(0)
}

const rulesFor = buildRules()
for (const f of files) analyze(f, rulesFor)

if (changed || staged) {
  const src = files.filter((f) => !isTest(f)).length
  // A diff that adds no executable line does not need a test, and the skill says so: a typo or
  // a comment fix is explicitly exempt in `references/testing-guide.md`. Without this exemption a
  // legal T1 change trips the warning, and a repo running `maxWarnings: 0` fails a build for
  // editing a comment - which teaches people to ignore the whole gate.
  //
  // The check is on ADDED lines, not on the file type: a .ts file whose diff is three comment
  // lines has changed no behaviour, while a .ts file with one new statement has.
  if (src > 0 && !files.some((f) => isTest(f)) && addedCodeLines() > 0) {
    add(SYNTHETIC, 0, "warn", "no-test-change", `${src} source file(s) changed with no test change: is the new behavior covered?`)
  }
}

findings.sort((a, b) => (a.file === SYNTHETIC ? 1 : 0) - (b.file === SYNTHETIC ? 1 : 0) || a.file.localeCompare(b.file) || a.line - b.line)

const errors = findings.filter((f) => f.sev === "error")
const warns = findings.filter((f) => f.sev === "warn")
const overWarnBudget = warns.length > maxWarnings

/* ---------- report ---------- */

const SARIF_LEVEL = { error: "error", warn: "warning" }

function sarif(fs) {
  const ids = [...new Set(fs.map((f) => f.id))]
  const rules = ids.map((id) => {
    const sample = fs.find((f) => f.id === id)
    return {
      id,
      name: id,
      shortDescription: { text: sample?.msg || id },
      fullDescription: { text: `${sample?.msg || id} (${sample?.file}:${sample?.line})` },
      defaultConfiguration: { level: SARIF_LEVEL[sample?.sev] || "note" },
    }
  })
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "software-engineer/smells",
              informationUri: "https://github.com/ngvantoan347-del/role-rest",
              rules,
            },
          },
          // A synthetic finding has no location, so it is emitted as a run-level notification.
          results: fs.map((f) => ({
            ruleId: f.id,
            level: SARIF_LEVEL[f.sev] || "note",
            message: { text: f.msg },
            locations: f.file === SYNTHETIC ? [] : [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: Math.max(1, f.line) } } }],
          })),
          invocations: [{ executionSuccessful: errors.length === 0, toolExecutionNotifications: overWarnBudget ? [{ level: "warning", message: { text: `${warns.length} warnings exceeds the budget of ${maxWarnings}` } }] : [] }],
        },
      ],
    },
    null,
    2
  )
}

if (format === "json") {
  console.log(JSON.stringify({ scanned: files.length, findings, summary: { error: errors.length, warn: warns.length, maxWarnings } }, null, 2))
  process.exit(errors.length || overWarnBudget ? 1 : 0)
}
if (format === "sarif") {
  console.log(sarif(findings))
  process.exit(errors.length || overWarnBudget ? 1 : 0)
}
if (format === "github") {
  // GitHub annotations need file:line; the synthetic finding has no line to point at.
  for (const f of findings) {
    if (f.file === SYNTHETIC) console.log(`::warning title=${f.id}::${f.msg}`)
    else console.log(`::${f.sev === "error" ? "error" : "warning"} file=${f.file},line=${Math.max(1, f.line)},title=${f.id}::${f.msg}`)
  }
  console.log(`${errors.length} error(s), ${warns.length} warning(s)`)
  process.exit(errors.length || overWarnBudget ? 1 : 0)
}

console.log(bold(`\nsmells  ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s)  ${dim(`(scanned ${files.length} ${changed ? baseRef ? `diff vs ${baseRef}` : "working tree" : staged ? "staged" : "tracked files"})`)}\n`))

let file = null
for (const f of findings) {
  if (f.file !== file) {
    file = f.file
    console.log(cyan(`  ${file}`))
  }
  console.log(`  ${f.sev === "error" ? red("error") : yellow("warn ")} ${dim(String(f.line).padStart(5))}  ${dim(f.id.padEnd(20))} ${f.msg}`)
  if (f.text) console.log(`         ${dim(f.text)}`)
  console.log("")
}

console.log(`  ${red(`${errors.length} error(s)`)}  ${yellow(`${warns.length} warning(s)`)}${Number.isFinite(maxWarnings) ? dim(` / budget ${maxWarnings}`) : ""}`)
if (errors.length) {
  console.log(red("\n  fix the errors before calling this done. A finding you keep needs an owner and a tracked issue."))
  console.log(dim("  need to keep one? Add a comment linking the issue, so the debt has an owner."))
} else {
  console.log(dim(warns.length ? "\n  no blocking errors. Each warning is fixed now or explained in the handoff." : "\n  clean."))
}
if (overWarnBudget) console.log(red(`\n  ${warns.length} warnings exceed the budget of ${maxWarnings}, which this repo treats as blocking.`))
console.log(dim("\n  This is a regex. It cannot see the failures that actually ship: wrong abstraction,"))
console.log(dim("  logic that is correct but does the wrong thing, breakage at N records or under"))
console.log(dim("  concurrency, and holes that come from intent. Those need reading - see"))
console.log(dim("  references/anti-patterns.md, section A. A clean run here is not a finished change.\n"))
process.exit(errors.length || overWarnBudget ? 1 : 0)