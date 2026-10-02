#!/usr/bin/env node
/**
 * verify.mjs - discover and run this project's real engineering gates.
 *
 * Detection order mirrors OpenCode's own config precedence: the project's own scripts and
 * CI-shaped files win over generic defaults. A gate that cannot be detected is reported as
 * MISSING, never as passing, so a missing linter is never mistaken for a clean one.
 *
 * At enterprise scale the hard problem is not finding the gates, it is running them without
 * a 40 minute feedback loop. So this resolves the workspace layout, works out which
 * packages a diff actually touches, and runs only those.
 *
 * Usage:
 *   node verify.mjs                     # detect and run all gates at the repo root
 *   node verify.mjs --changed           # run gates only for packages the diff touches
 *   node verify.mjs --base origin/main  # diff base for --changed (default: auto)
 *   node verify.mjs --only test --only lint
 *   node verify.mjs --jobs 4            # run independent package gates in parallel
 *   node verify.mjs --timeout 600000    # hard cap per gate
 *   node verify.mjs --dry-run
 *   node verify.mjs --format json|sarif|github|text
 *   node verify.mjs --config path.json
 *
 * Exit: 0 all run gates passed, 1 a gate failed, 2 nothing detected, 3 bad usage.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d
}
const many = (f) =>
  argv.reduce((a, v, i) => (v === f && argv[i + 1] && !argv[i + 1].startsWith("--") ? [...a, argv[i + 1]] : a), [])

const changedOnly = has("--changed")
const dryRun = has("--dry-run")
const only = many("--only")
const base = opt("--base", null)
const format = opt("--format", "text")
const jobs = Math.max(1, Number(opt("--jobs", 1)) || 1)
const timeoutOpt = Number(opt("--timeout", 0)) || 0
const configPath = opt("--config", null)
const color = !has("--no-color") && format === "text" && process.stdout.isTTY !== false

const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const bold = (s) => c("1", s)
const green = (s) => c("32", s)
const red = (s) => c("31", s)
const yellow = (s) => c("33", s)

if (!["text", "json", "sarif", "github"].includes(format)) {
  console.error(`unknown --format: ${format} (expected text, json, sarif, github)`)
  process.exit(3)
}

const root = process.cwd()
const GATES = ["typecheck", "lint", "test", "build"]
const at = (...p) => join(root, ...p)
const read = (...p) => {
  try {
    return readFileSync(at(...p), "utf8")
  } catch {
    return ""
  }
}
const hasFile = (...p) => existsSync(at(...p))
const json = (...p) => {
  try {
    return JSON.parse(read(...p))
  } catch {
    return null
  }
}

/* ---------- config ---------- */

// `.software-engineer.json` at the repo root configures both scripts, so a team tunes the
// gates once in a committed file instead of passing flags in a CI yaml nobody can lint.
const CFG_FILE = ".software-engineer.json"
const cfgRoot = json(CFG_FILE) || json("software-engineer.json") || {}
let verifyCfg = cfgRoot.verify || {}
if (configPath) {
  const raw = (() => {
    try {
      return JSON.parse(readFileSync(resolve(root, configPath), "utf8"))
    } catch (e) {
      console.error(`cannot read config ${configPath}: ${e.message}`)
      process.exit(3)
    }
  })()
  // Accept either { verify: {...} } or a bare verify block, so a --config file can be small.
  verifyCfg = raw.verify || raw
}

const timeoutMs = Number(opt("--timeout", 0)) || Number(verifyCfg.timeout) || 0
const ignoreDirs = (verifyCfg.ignore || []).map((s) => String(s).replace(/\\/g, "/"))
const failFast = verifyCfg.failFast === true

const isDir = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/* ---------- workspace layout ---------- */

// Minimal glob: `**` spans separators, `*` and `?` do not. Enough for workspace patterns,
// which are the only globs this needs to resolve.
function globToRe(glob) {
  const out = []
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out.push(".*")
        i++
        if (glob[i + 1] === "/") i++
      } else out.push("[^/]*")
    } else if (ch === "?") out.push("[^/]")
    else out.push(ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
  }
  return new RegExp("^" + out.join("") + "$")
}

// Expand `packages/*` against the filesystem. A workspace that declares a pattern matching
// nothing is a typo in someone's config; an empty list here surfaces as "single package",
// which is the wrong answer and needs to be visible.
function expand(rootGlob, exts) {
  const base = dirname(rootGlob) === "." ? "" : dirname(rootGlob)
  const pat = basename(rootGlob)
  const re = globToRe(pat)
  const out = []
  let entries = []
  try {
    entries = readdirSync(at(base), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue
    if (!re.test(e.name)) continue
    const rel = base ? `${base}/${e.name}` : e.name
    if (exts.some((x) => hasFile(rel, x))) out.push(rel)
  }
  return out
}
const basename = (p) => p.slice(p.lastIndexOf("/") + 1)

// A workspace member is identified by the manifest that makes it a buildable unit.
const UNIT = ["package.json", "go.mod", "Cargo.toml", "build.gradle", "build.gradle.kts", "pom.xml", "pyproject.toml"]

function workspaceGlobs() {
  const globs = []
  const pkg = json("package.json")
  const ws = pkg?.workspaces
  if (Array.isArray(ws)) globs.push(...ws)
  else if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages)
  const pnpm = read("pnpm-workspace.yaml")
  const inPkgs = pnpm.match(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)
  if (inPkgs) globs.push(...inPkgs.map((l) => l.replace(/^\s*-\s*/, "").replace(/["']/g, "").trim()).filter((g) => g && !g.startsWith("#")))
  const cargo = read("Cargo.toml")
  const members = cargo.match(/members\s*=\s*\[([^\]]*)\]/s)
  if (members) globs.push(...[...members[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]))
  const gowork = read("go.work")
  const use = gowork.match(/^\s*use\s+\(?\s*["']?([^"'\n)\]]+)/gm)
  if (use) globs.push(...use.map((l) => l.replace(/^\s*use\s+\(?\s*/, "").replace(/["']/g, "").trim()))
  const lerna = json("lerna.json")
  if (Array.isArray(lerna?.packages)) globs.push(...lerna.packages)
  return [...new Set(globs)].filter((g) => g && !g.startsWith("!") && g !== ".")
}

function detectUnits() {
  const globs = workspaceGlobs()
  if (!globs.length) return []
  const seen = new Set()
  const units = []
  for (const g of globs) {
    const dirs = g.includes("*") ? expand(g, UNIT) : isDir(at(g)) && UNIT.some((x) => hasFile(g, x)) ? [g] : []
    for (const d of dirs) {
      const key = d.replace(/\/$/, "")
      if (seen.has(key)) continue
      seen.add(key)
      const name = json(d, "package.json")?.name || key
      units.push({ dir: key, name })
    }
  }
  // Longest dir first so a nested unit wins over its parent when mapping changed files.
  return units.sort((a, b) => b.dir.length - a.dir.length)
}

/* ---------- changed files ---------- */

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null
}

function resolveBase() {
  if (base) return base
  const head = git("rev-parse", "--verify", "HEAD")
  if (!head) return null
  for (const cand of ["origin/main", "origin/master", "main", "master"]) {
    const merge = git("merge-base", "HEAD", cand)
    if (merge && merge[0]) return merge[0]
  }
  const prev = git("rev-parse", "--verify", "HEAD~1")
  return prev && prev[0] ? prev[0] : null
}

function changedFiles() {
  const files = new Set()
  const b = resolveBase()
  if (b) for (const f of git("diff", "--name-only", "--diff-filter=ACMR", `${b}...HEAD`) || []) files.add(f)
  for (const f of git("diff", "--name-only", "--diff-filter=ACMR", "HEAD") || []) files.add(f)
  for (const f of git("ls-files", "--others", "--exclude-standard") || []) files.add(f)
  return [...files].map((f) => f.replace(/\\/g, "/"))
}

// A change outside every unit (root config, CI yaml, lockfile, tooling) invalidates the whole
// repo's assumptions, so it pulls in every unit rather than silently skipping verification.
function affectedUnits(units, files) {
  const touched = new Set()
  let rootTouched = false
  for (const f of files) {
    const owner = units.find((u) => f === u.dir || f.startsWith(u.dir + "/"))
    if (owner) touched.add(owner.dir)
    else {
      rootTouched = true
      // Root-owned paths that every package inherits: config, lockfiles, toolchain pins.
      if (/^(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?)$/.test(f)) rootTouched = true
    }
  }
  return { touched: [...touched], rootTouched, all: rootTouched }
}

/* ---------- gate detection ---------- */

// Resolve a locally installed binary so neither Windows nor a global install is required.
const bin = (name) => {
  const rel = ["node_modules", ".bin", name]
  if (process.platform !== "win32") return hasFile(...rel) ? at(...rel) : name
  for (const ext of [".cmd", ".exe", ".bat", ""]) if (hasFile("node_modules", ".bin", name + ext)) return at("node_modules", ".bin", name + ext)
  return name
}

const pick = (obj, keys) => keys.find((k) => obj?.[k])
const add = (out, gate, cmd, source) => {
  if (Array.isArray(cmd) && cmd.length && !out[gate]) out[gate] = { cmd, source }
}

// Each detector contributes only the gates it is confident about; earlier detectors win.
// `dir` is the package root being inspected, so a monorepo member resolves against its own
// manifest rather than the repo root's.
function detect(dir) {
  const atd = (...p) => join(root, dir, ...p)
  const readd = (...p) => {
    try {
      return readFileSync(atd(...p), "utf8")
    } catch {
      return ""
    }
  }
  const hasd = (...p) => existsSync(atd(...p))
  const bind = (name) => {
    const rel = join(dir, "node_modules", ".bin", name)
    if (process.platform !== "win32") return hasd("node_modules", ".bin", name) ? join(root, rel) : name
    for (const ext of [".cmd", ".exe", ".bat", ""]) if (hasd("node_modules", ".bin", name + ext)) return join(root, "node_modules", ".bin", name + ext)
    return name
  }
  const out = {}

  if (hasd("Cargo.toml")) {
    add(out, "typecheck", ["cargo", "check", "--all-targets"], "Cargo.toml")
    add(out, "lint", ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], "Cargo.toml")
    add(out, "test", ["cargo", "test"], "Cargo.toml")
    add(out, "build", ["cargo", "build", "--release"], "Cargo.toml")
  }
  if (hasd("go.mod")) {
    add(out, "typecheck", ["go", "vet", "./..."], "go.mod")
    add(out, "lint", ["gofmt", "-l", "."], "gofmt")
    add(out, "test", ["go", "test", "./..."], "go.mod")
    add(out, "build", ["go", "build", "./..."], "go.mod")
  }
  const gradle = ["gradlew", "gradlew.bat", "mvnw", "mvnw.cmd"].find((f) => hasd(f))
  if (gradle) {
    const isMaven = gradle.startsWith("mvnw")
    const run = process.platform === "win32" && gradle.endsWith(".cmd") ? `.\\${gradle}` : `./${gradle}`
    add(out, "test", [run, "test"], gradle)
    add(out, "build", [run, isMaven ? "package" : "build"], gradle)
  }
  if (hasd("composer.json")) {
    add(out, "lint", ["composer", "validate", "--strict"], "composer.json")
    add(out, "test", ["composer", "test"], "composer.json")
  }
  if (hasd("Rakefile")) add(out, "test", ["rake", "test"], "Rakefile")
  if (hasd("tsconfig.json")) add(out, "typecheck", [bind("tsc"), "--noEmit"], "tsconfig.json")

  if (hasd("package.json")) {
    let pkg = null
    try {
      pkg = JSON.parse(readd("package.json"))
    } catch {
      pkg = null
    }
    const scripts = pkg?.scripts || {}
    const pm =
      (typeof pkg?.packageManager === "string" && pkg.packageManager.split("@")[0]) ||
      (hasd("pnpm-lock.yaml") ? "pnpm" : hasd("yarn.lock") ? "yarn" : hasd("bun.lockb") || hasd("bun.lock") ? "bun" : "npm")
    const run = (s) => [pm, "run", s]
    add(out, "typecheck", (s => (s ? run(s) : null))(pick(scripts, ["typecheck", "type-check", "check-types", "types", "tsc"])), "package.json")
    add(out, "lint", (s => (s ? run(s) : null))(pick(scripts, ["lint", "lint:check", "biome:lint", "check"])), "package.json")
    add(out, "test", (s => (s ? run(s) : null))(pick(scripts, ["test:ci", "test:unit", "test", "jest", "vitest", "mocha"])), "package.json")
    add(out, "build", (s => (s ? run(s) : null))(pick(scripts, ["build:prod", "build", "compile"])), "package.json")
  }

  if (hasd("Makefile")) {
    const targets = readd("Makefile").split("\n").map((l) => l.match(/^([a-zA-Z][\w.-]*):(?!=)/)?.[1]).filter(Boolean)
    const mk = (t) => (targets.includes(t) ? ["make", t] : null)
    add(out, "typecheck", mk("typecheck") || mk("type-check"), "Makefile")
    add(out, "lint", mk("lint"), "Makefile")
    add(out, "test", mk("test"), "Makefile")
    add(out, "build", mk("build"), "Makefile")
  }

  const pyproject = readd("pyproject.toml")
  const poetry = hasd("poetry.lock") ? "poetry" : "python"
  const py = (mod, ...args) => [poetry, "-m", mod, ...args]
  if (hasd("mypy.ini") || /mypy/.test(pyproject)) add(out, "typecheck", py("mypy", "."), "mypy")
  if (hasd(".flake8") || hasd("ruff.toml") || /ruff|flake8|black/.test(pyproject)) add(out, "lint", py("ruff", "check", "."), "ruff")
  if (hasd("pytest.ini") || hasd("tox.ini") || /pytest/.test(pyproject) || hasd("tests")) add(out, "test", py("pytest"), "pytest")
  if (hasd("setup.py")) add(out, "build", [poetry, "setup.py", "build"], "setup.py")

  return out
}

// Team overrides win over detection: a company that centralises gates in one config has a
// reason, and silently running something else produces a green that means nothing.
function applyOverrides(out) {
  const g = verifyCfg.gates
  if (!g || typeof g !== "object") return out
  for (const gate of GATES) {
    if (!(gate in g)) continue
    const v = g[gate]
    if (v === null || v === false) delete out[gate]
    else if (Array.isArray(v) && v.length) out[gate] = { cmd: v.map(String), source: CFG_FILE }
    else if (typeof v === "string") out[gate] = { cmd: splitCommand(v), source: CFG_FILE }
  }
  for (const [gate, v] of Object.entries(g)) {
    if (GATES.includes(gate) || !out[gate]) continue
    if (Array.isArray(v) && v.length) out[gate] = { cmd: v.map(String), source: CFG_FILE }
  }
  return out
}

function splitCommand(s) {
  const parts = s.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  return parts.map((p) => p.replace(/^["']|["']$/g, ""))
}

/* ---------- targets ---------- */

const units = detectUnits()
const plan = [] // { pkg, dir, gates }

function pushPlan(pkg, dir, gates) {
  const skip = ignoreDirs.some((g) => (dir === "" ? g === "" : dir.includes(g)))
  if (skip) return
  plan.push({ pkg, dir, gates })
}

if (changedOnly && units.length) {
  const files = changedFiles()
  const { touched, rootTouched } = affectedUnits(units, files)
  const b = resolveBase()
  if (format === "text") {
    console.log(bold(`\nverify  ${dim(root)}`))
    console.log(dim(`  base ${b ? b.slice(0, 8) : "none"} · ${files.length} file(s) changed · ${units.length} workspace unit(s)\n`))
  }
  // A root-owned change invalidates every package's assumptions, so it fans out rather than
  // narrowing: skipping the untouched packages here would produce a green that means nothing.
  if (rootTouched) pushPlan("(root)", "", applyOverrides(detect("")))
  for (const dir of rootTouched ? units.map((u) => u.dir) : touched) {
    const u = units.find((x) => x.dir === dir)
    pushPlan(u?.name || dir, dir, applyOverrides(detect(dir)))
  }
  if (!plan.length) {
    // Emptied before anything below is initialised, so this path cannot call emit(): the
    // reporting block reads `streamed`/`done`, which do not exist yet. A docs-only diff is the
    // common case in a monorepo, and a required check that stack-traces on it is worse than no
    // check at all. Report it here and stop.
    if (format === "text") {
      console.log(dim("\n  no unit has gates to run for this diff (docs or config-only change).\n"))
      console.log(dim("  Nothing was verified. If that is not what you expected, the gate for this\n  package is unconfigured - say so in the handoff rather than calling it a pass.\n"))
    } else if (format === "json") {
      console.log(JSON.stringify({ root, base: resolveBase(), summary: { pass: 0, fail: 0, missing: 0, total: 0 }, results: [], note: "no unit in this diff has a gate; this is not a pass" }, null, 2))
    } else if (format === "github") {
      console.log("0 failed, 0 passed: no unit in this diff has a configured gate")
    } else if (format === "sarif") {
      console.log(sarifEmpty("No unit in this diff has a configured gate. Nothing was verified."))
    }
    process.exit(0)
  }
} else {
  // Full mode means the whole workspace, not just the root. `ci-integration.md` makes a full
  // nightly run the second layer that catches packages the affected-graph mapping skipped, and
  // that layer silently did nothing until this was fixed: it ran only the root's gates and
  // reported green.
  pushPlan("(root)", "", applyOverrides(detect("")))
  for (const u of units) pushPlan(u.name, u.dir, applyOverrides(detect(u.dir)))
  if (format === "text") console.log(bold(`\nverify  ${dim(root)}${units.length ? dim(`  (root + ${units.length} workspace unit(s))`) : ""}\n`))
}

if (!plan.some((p) => Object.keys(p.gates).length)) {
  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          root,
          base: changedOnly ? resolveBase() : null,
          summary: { pass: 0, fail: 0, missing: 0, total: 0 },
          results: [],
          note: "no gates could be detected; this is not a pass",
        },
        null,
        2
      )
    )
  } else if (format === "sarif") {
    console.log(sarifEmpty("No gates could be detected in this project. Nothing was verified."))
  } else {
    console.log(yellow("No gates could be detected in this project."))
    console.log(dim("Run the real commands from package.json / Makefile / CI config by hand, and report the output.\n"))
  }
  process.exit(2)
}

/* ---------- run ---------- */

// Hoisted out of the reporting block because the empty-plan path needs it too: a function
// declaration is hoisted, so defining it here keeps one copy of the SARIF shape instead of
// two that can drift.
function sarifEmpty(note) {
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "software-engineer/verify", informationUri: "https://github.com/ngvantoan347-del/role-rest", rules: [] } },
          results: [],
          invocations: [{ executionSuccessful: true, toolExecutionNotifications: [{ level: "note", message: { text: note } }] }],
        },
      ],
    },
    null,
    2
  )
}

// Everything to execute, flattened. Each entry carries enough context to be reported on its
// own line, because in a monorepo "test passed" is meaningless without the package it ran in.
const tasks = []
for (const p of plan) {
  for (const gate of GATES) {
    if (only.length && !only.includes(gate)) continue
    const hit = p.gates[gate]
    tasks.push({ pkg: p.pkg, dir: p.dir, gate, hit, state: hit ? "pending" : "missing" })
  }
}
const runnable = tasks.filter((t) => t.hit)

// Serial runs stream straight to the terminal so a 20 minute suite shows progress. Parallel
// runs and machine-readable formats must capture instead: interleaved output is unreadable,
// and a stray line in the middle of JSON makes it unparseable.
const streamed = !dryRun && jobs === 1 && format === "text"

function runTask(t) {
  const cwd = join(root, t.dir)
  const t0 = process.hrtime.bigint()
  const opts = {
    cwd,
    stdio: streamed ? "inherit" : "pipe",
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // `npm run test` is npm -> sh -> node: three processes. Killing only the first leaves the
    // grandchild running, still holding the output pipe, burning CPU on a runner that has
    // already given up on the gate. A new process group makes the whole tree killable.
    detached: process.platform !== "win32",
  }
  if (timeoutMs) opts.timeout = timeoutMs
  const res = dryRun ? { status: 0, stdout: "", pid: undefined } : spawnSync(t.hit.cmd[0], t.hit.cmd.slice(1), opts)
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n)
  if (res.error && res.error.code === "ETIMEDOUT") {
    killTree(res.pid)
    return { ...t, state: "fail", ms, code: null, output: `timed out after ${timeoutMs}ms`, timedOut: true }
  }
  if (res.error) return { ...t, state: "fail", ms, code: null, output: String(res.error.message) }
  // A signal (null status alongside a signal) is a crash or a timeout kill, never a pass.
  const state = res.status === 0 && !res.signal ? "pass" : "fail"
  return { ...t, state, ms, code: res.status, signal: res.signal, output: res.stdout || "" }
}

// SIGTERM first so the gate can clean up, then SIGKILL for what ignores it. The negative pid
// targets the process group; a no-op when the group is already gone, which is the common case.
function killTree(pid) {
  if (!pid) return
  const signal = (sig) => {
    try {
      process.kill(-pid, sig)
    } catch {
      /* group already reaped */
    }
  }
  signal("SIGTERM")
  const hard = setTimeout(() => signal("SIGKILL"), 2000)
  hard.unref?.()
}

const results = []
if (dryRun) {
  for (const t of runnable) results.push({ ...t, state: "dry", ms: 0 })
} else if (jobs > 1) {
  // Independent packages only; the order they are reported in is still deterministic.
  const queue = [...runnable]
  const workers = Array.from({ length: Math.min(jobs, queue.length) }, () => {
    const out = []
    while (queue.length) out.push(runTask(queue.shift()))
    return out
  })
  for (const batch of workers) results.push(...batch)
  const order = new Map(tasks.map((t, i) => [`${t.dir}\u0000${t.gate}`, i]))
  results.sort((a, b) => (order.get(`${a.dir}\u0000${a.gate}`) ?? 0) - (order.get(`${b.dir}\u0000${b.gate}`) ?? 0))
} else {
  for (const t of runnable) {
    const r = runTask(t)
    results.push(r)
    if (failFast && r.state === "fail") break
  }
}

const done = [...results, ...tasks.filter((t) => t.state === "missing")]

/* ---------- report ---------- */

const failed = done.filter((r) => r.state === "fail")
const missing = done.filter((r) => r.state === "missing")
const passed = done.filter((r) => r.state === "pass")

// One boolean decides whether every row carries its package name, so the command list and the
// summary can never disagree about which package a line belongs to.
const showPkg = plan.length > 1 || plan.some((p) => p.dir !== "")
const pkgLabel = (p) => (p === "(root)" ? "root" : p)

function head(t) {
  const name = showPkg ? pkgLabel(t.pkg).padEnd(24) + " " : ""
  return `  ${name}${t.gate.padEnd(10)} ${dim(quoteArgs(t.hit.cmd))} ${dim(`(${t.hit.source})`)}`
}

// Quote only for display. spawnSync takes argv directly, so an argument containing spaces must
// stay one token - printing it unquoted would read as two and teach the wrong command.
const quoteArgs = (cmd) => cmd.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")

function tail(output, lines = 30) {
  if (!output) return []
  return output.replace(/\r/g, "").split("\n").filter((l, i, a) => l.trim() || i < a.length - 1).slice(-lines)
}

function textReport() {
  // The command list is printed up front so a reader knows what ran before the output arrives.
  // A streamed run has already written its output; a captured one prints its tail only if failed.
  if (streamed) {
    for (const r of done) if (r.state === "missing") console.log(`  ${showPkg ? pkgLabel(r.pkg).padEnd(24) + " " : ""}${r.gate.padEnd(10)} ${dim("not configured")}`)
  } else {
    for (const r of done) {
      console.log(r.hit ? head(r) : `  ${showPkg ? pkgLabel(r.pkg).padEnd(24) + " " : ""}${r.gate.padEnd(10)} ${dim("not configured")}`)
    }
  }
  console.log("")
  const icon = { pass: green("PASS"), fail: red("FAIL"), missing: yellow("MISSING"), dry: dim("DRY") }
  for (const r of done) {
    const extra = r.ms !== undefined ? dim(` ${r.ms}ms`) : ""
    const code = r.code ? dim(` exit=${r.code}`) : r.signal ? dim(` signal=${r.signal}`) : ""
    const pkg = showPkg && r.pkg !== "(root)" ? dim(` ${r.pkg}`) : ""
    console.log(`  ${icon[r.state]}  ${r.gate}${pkg}${extra}${code}`)
  }
  if (failed.length) {
    console.log("")
    for (const r of failed) {
      // Nothing captured means the gate streamed to the terminal and the operator already saw it.
      if (!r.output) continue
      const lines = tail(r.output)
      if (!lines.length) continue
      console.log(red(`  ${pkgLabel(r.pkg)} / ${r.gate} — last ${lines.length} line(s):`))
      for (const l of lines) console.log(dim(`    ${l}`))
    }
  }
  if (missing.length) console.log(dim(`\n  missing: ${missing.map((m) => `${m.pkg}/${m.gate}`).join(", ")} - not verified. State this in the handoff.`))
  if (failed.length) {
    console.log(red(`\n  ${failed.length} gate(s) failed. Fix the cause; do not weaken tests to go green.\n`))
  } else {
    console.log(green(`\n  all ${passed.length} detected gate(s) passed${missing.length ? `, ${missing.length} not configured` : ""}\n`))
  }
  if (!dryRun) {
    console.log(dim("  Gates prove the build behaves. They cannot tell whether it should behave that way."))
    console.log(dim("  A passing suite still leaves unverified: whether the right thing was built at all.\n"))
  }
}

function sarifReport(rs) {
  const level = (s) => (s === "fail" ? "error" : s === "missing" ? "warning" : "note")
  const results = rs
    .filter((r) => r.state === "fail" || r.state === "missing")
    .map((r) => ({
      ruleId: `verify/${r.gate}`,
      level: level(r.state),
      message: {
        text:
          r.state === "missing"
            ? `No ${r.gate} gate configured for ${r.pkg}; this dimension is unverified.`
            : `${r.pkg} ${r.gate} failed: ${quoteArgs(r.hit.cmd)}${r.timedOut ? " (timed out)" : ""}` +
              (r.output ? `\n${tail(r.output, 20).join("\n")}` : ""),
      },
      locations: [{ physicalLocation: { artifactLocation: { uri: r.hit ? r.hit.source : CFG_FILE } } }],
    }))
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "software-engineer/verify", informationUri: "https://github.com/ngvantoan347-del/role-rest", rules: [] } }, results }],
    },
    null,
    2
  )
}

function emit(ok, _extra) {
  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          root,
          base: changedOnly ? resolveBase() : null,
          summary: { pass: passed.length, fail: failed.length, missing: missing.length, total: done.length },
          results: done.map((r) => ({
            pkg: r.pkg,
            dir: r.dir,
            gate: r.gate,
            state: r.state,
            command: r.hit ? quoteArgs(r.hit.cmd) : undefined,
            source: r.hit?.source,
            ms: r.ms,
            exit: r.code,
            // Captured output travels with the result. A machine format that dropped the only
            // record of why a gate failed would leave CI with a red tick and nothing to read.
            output: r.output ? tail(r.output, 50).join("\n") : undefined,
          })),
        },
        null,
        2
      )
    )
  } else if (format === "sarif") console.log(sarifReport(done))
  else if (format === "github") {
    for (const r of failed) {
      console.log(`::error title=${r.gate} failed in ${r.pkg}::${quoteArgs(r.hit.cmd)} exited ${r.code ?? "aborted"}`)
      // A GitHub annotation carries a single line of text, so the gate's own output becomes
      // log lines. Without them the PR shows a red check nobody can act on.
      for (const l of tail(r.output, 20)) console.log(`  ${l}`)
    }
    for (const r of missing) console.log(`::warning title=${r.gate} not configured in ${r.pkg}::this dimension is unverified`)
    console.log(`${failed.length} failed, ${passed.length} passed, ${missing.length} not configured`)
  } else textReport()
}

emit()

// A signal-terminated gate is a failure even when exit status is absent, so failures gate the
// exit code; MISSING gates are reported loudly but do not fail the build, because a repo
// without a linter is a choice someone already made.
if (!dryRun && done.length && failed.length === 0 && passed.length === 0) {
  if (format === "text") {
    console.log(dim(`\n  nothing ran: every gate for this selection is unconfigured.\n`))
  }
  process.exit(2)
}
process.exit(failed.length ? 1 : 0)