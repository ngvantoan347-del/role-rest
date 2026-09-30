#!/usr/bin/env node
/**
 * verify.mjs - discover and run this project's engineering gates.
 *
 * Gates: typecheck, lint, test, build. Detects the real commands from the project's own
 * config (package.json scripts, Makefile targets, pyproject/tox/nox, Cargo, go, Gradle,
 * dotnet, composer, Rakefile), prints what it found, runs what exists, and reports pass /
 * fail / missing with a non-zero exit code when a gate fails.
 *
 * Usage:
 *   node verify.mjs                 # detect and run all gates
 *   node verify.mjs --only test     # run just one gate (repeatable)
 *   node verify.mjs --dry-run       # print the commands without running them
 *   node verify.mjs --no-color
 *
 * Exit codes: 0 all run gates passed, 1 a gate failed, 2 no gate could be detected.
 * Missing gates are reported, never silently passed.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const only = argv.reduce((acc, a, i) => (a === "--only" ? [...acc, argv[i + 1]] : acc), [])
const dryRun = has("--dry-run")
const color = !has("--no-color") && process.stdout.isTTY !== false
const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const bold = (s) => c("1", s)
const green = (s) => c("32", s)
const red = (s) => c("31", s)
const yellow = (s) => c("33", s)
const cyan = (s) => c("36", s)

const root = process.cwd()
const GATES = ["typecheck", "lint", "test", "build"]

/* ---------- detection ---------- */

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

// Resolve a locally installed binary so Windows/Unix both work without global installs.
function localBin(name) {
  if (process.platform === "win32") {
    for (const ext of [".cmd", ".exe", ".bat", ""]) {
      const p = join(root, "node_modules", ".bin", name + ext)
      if (existsSync(p)) return p
    }
    return name
  }
  const p = join(root, "node_modules", ".bin", name)
  return existsSync(p) ? p : name
}

function pmRunner(pkg) {
  const pm = pkg?.packageManager
  if (typeof pm === "string") return pm.split("@")[0]
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(root, "yarn.lock"))) return "yarn"
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun"
  return "npm"
}

function fromPackageJSON() {
  const path = join(root, "package.json")
  if (!existsSync(path)) return {}
  const pkg = readJSON(path)
  if (!pkg) return {}
  const scripts = pkg.scripts || {}
  const pm = pmRunner(pkg)
  const run = (s) => [pm, "run", s]
  const out = {}

  const find = (candidates) => candidates.find((c) => scripts[c])

  const tc = find(["typecheck", "type-check", "check-types", "tsc", "types"])
  if (tc) out.typecheck = { cmd: run(tc), source: `package.json:${tc}` }

  const lint = find(["lint", "eslint", "lint:check", "biome:lint", "check"])
  if (lint) out.lint = { cmd: run(lint), source: `package.json:${lint}` }

  const test = find(["test", "test:unit", "test:ci", "jest", "vitest", "mocha"])
  if (test) out.test = { cmd: run(test), source: `package.json:${test}` }

  const build = find(["build", "compile", "build:prod"])
  if (build) out.build = { cmd: run(build), source: `package.json:${build}` }

  // tsconfig without a typecheck script is still a real typecheck gate.
  if (!out.typecheck && existsSync(join(root, "tsconfig.json"))) {
    out.typecheck = { cmd: [localBin("tsc"), "--noEmit"], source: "tsconfig.json" }
  }
  return out
}

function fromMakefile() {
  const path = join(root, "Makefile")
  if (!existsSync(path)) return {}
  const targets = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.match(/^([a-zA-Z][\w.-]*):(?!=)/)?.[1])
    .filter(Boolean)
  const has = (t) => targets.includes(t)
  const out = {}
  if (has("type-check") || has("typecheck")) out.typecheck = { cmd: ["make", has("typecheck") ? "typecheck" : "type-check"], source: "Makefile" }
  if (has("lint")) out.lint = { cmd: ["make", "lint"], source: "Makefile" }
  if (has("test")) out.test = { cmd: ["make", "test"], source: "Makefile" }
  if (has("build")) out.build = { cmd: ["make", "build"], source: "Makefile" }
  return out
}

function fromPython() {
  const out = {}
  const py = existsSync(join(root, "poetry.lock")) ? "poetry" : "python"
  if (existsSync(join(root, "mypy.ini")) || existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "setup.cfg"))) {
    if (existsSync(join(root, "mypy.ini")) || /mypy/.test(safeRead(join(root, "pyproject.toml")))) {
      out.typecheck = { cmd: [py === "poetry" ? "poetry" : "python", "-m", "mypy", "."], source: "mypy" }
    }
  }
  if (existsSync(join(root, ".flake8")) || existsSync(join(root, "ruff.toml")) || /ruff|flake8|black/.test(safeRead(join(root, "pyproject.toml")))) {
    out.lint = { cmd: [py === "poetry" ? "poetry" : "python", "-m", "ruff", "check", "."], source: "ruff" }
  }
  if (existsSync(join(root, "pytest.ini")) || existsSync(join(root, "tox.ini")) || /pytest/.test(safeRead(join(root, "pyproject.toml"))) || existsSync(join(root, "tests"))) {
    out.test = { cmd: [py === "poetry" ? "poetry" : "python", "-m", "pytest"], source: "pytest" }
  }
  if (existsSync(join(root, "setup.py"))) out.build = { cmd: [py === "poetry" ? "poetry" : "python", "setup.py", "build"], source: "setup.py" }
  return out
}

function fromOthers() {
  const out = {}
  if (existsSync(join(root, "Cargo.toml"))) {
    out.typecheck = { cmd: ["cargo", "check", "--all-targets"], source: "Cargo.toml" }
    out.lint = { cmd: ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], source: "Cargo.toml" }
    out.test = { cmd: ["cargo", "test"], source: "Cargo.toml" }
    out.build = { cmd: ["cargo", "build", "--release"], source: "Cargo.toml" }
  }
  if (existsSync(join(root, "go.mod"))) {
    out.typecheck = { cmd: ["go", "vet", "./..."], source: "go.mod" }
    out.lint = { cmd: ["gofmt", "-l", "."], source: "gofmt" }
    out.test = { cmd: ["go", "test", "./..."], source: "go.mod" }
    out.build = { cmd: ["go", "build", "./..."], source: "go.mod" }
  }
  const gradle = ["gradlew", "gradlew.bat", "mvnw", "mvnw.cmd"].find((f) => existsSync(join(root, f)))
  if (gradle) {
    const w = process.platform === "win32" && gradle.endsWith(".cmd")
    const r = w ? `.\\${gradle}` : `./${gradle}`
    const t = gradle.startsWith("gradle")
    out.test = { cmd: [r, ...(t ? ["test"] : ["test"])], source: gradle }
    out.build = { cmd: [r, ...(t ? ["build"] : ["package"])], source: gradle }
  }
  if (existsSync(join(root, "composer.json"))) {
    out.lint = { cmd: ["composer", "validate", "--strict"], source: "composer.json" }
    out.test = { cmd: ["composer", "test"], source: "composer.json" }
  }
  if (existsSync(join(root, "Rakefile"))) {
    out.test = { cmd: ["rake", "test"], source: "Rakefile" }
  }
  return out
}

function safeRead(p) {
  try {
    return existsSync(p) ? readFileSync(p, "utf8") : ""
  } catch {
    return ""
  }
}

const detect = () => ({
  ...fromOthers(),
  ...fromPackageJSON(),
  ...fromMakefile(),
  ...fromPython(),
})

/* ---------- run ---------- */

const found = detect()
const targets = only.length ? GATES.filter((g) => only.includes(g)) : GATES

console.log(bold(`\nverify  ${dim(root)}\n`))
if (Object.keys(found).length === 0) {
  console.log(yellow("No gates could be detected in this project."))
  console.log(dim("Add the real commands to package.json / Makefile / CI config, or run them manually and report the output.\n"))
  process.exit(2)
}

const results = []
for (const gate of targets) {
  const hit = found[gate]
  if (!hit) {
    results.push({ gate, state: "missing" })
    continue
  }
  const line = `  ${gate.padEnd(10)} ${dim(hit.cmd.join(" "))} ${dim(`(${hit.source})`)}`
  if (dryRun) {
    console.log(line)
    results.push({ gate, state: "dry-run" })
    continue
  }
  process.stdout.write(line + "\n")
  const started = process.hrtime.bigint()
  const res = spawnSync(hit.cmd[0], hit.cmd.slice(1), {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  const ms = Number((process.hrtime.bigint() - started) / 1000000n)
  const ok = res.status === 0
  results.push({ gate, state: ok ? "pass" : "fail", ms, code: res.status })
}

console.log("")
const icon = { pass: green("PASS"), fail: red("FAIL"), missing: yellow("MISSING"), "dry-run": dim("DRY") }
for (const r of results) {
  const t = r.ms !== undefined ? dim(` ${r.ms}ms`) : ""
  console.log(`  ${icon[r.state]}  ${r.gate}${t}${r.code ? dim(` exit=${r.code}`) : ""}`)
}
const failed = results.filter((r) => r.state === "fail")
const missing = results.filter((r) => r.state === "missing")

if (missing.length) {
  console.log(dim(`\n  missing: ${missing.map((m) => m.gate).join(", ")} - not verified. State this in the handoff.`))
}
if (failed.length) {
  console.log(red(`\n  ${failed.length} gate(s) failed. Fix the cause; do not weaken tests to go green.\n`))
  process.exit(1)
}
console.log(green("\n  all detected gates passed\n"))
