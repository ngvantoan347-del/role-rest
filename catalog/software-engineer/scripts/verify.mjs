#!/usr/bin/env node
/**
 * verify.mjs - discover and run this project's real engineering gates.
 *
 * Detection order mirrors OpenCode's own config precedence: the project's own scripts and
 * CI-shaped files win over generic defaults. A gate that cannot be detected is reported as
 * MISSING, never as passing, so a missing linter is never mistaken for a clean one.
 *
 * Usage:
 *   node verify.mjs                # detect and run all gates
 *   node verify.mjs --only test    # one gate (repeatable)
 *   node verify.mjs --dry-run      # print commands without running them
 *   node verify.mjs --no-color
 *
 * Exit: 0 all run gates passed, 1 a gate failed, 2 nothing detected.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const only = argv.reduce((a, v, i) => (v === "--only" ? [...a, argv[i + 1]] : a), [])
const dryRun = has("--dry-run")
const color = !has("--no-color") && process.stdout.isTTY !== false
const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const bold = (s) => c("1", s)
const green = (s) => c("32", s)
const red = (s) => c("31", s)
const yellow = (s) => c("33", s)

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

// Resolve a locally installed binary so neither Windows nor a global install is required.
const bin = (name) => {
  if (process.platform !== "win32") return hasFile("node_modules", ".bin", name) ? at("node_modules", ".bin", name) : name
  for (const ext of [".cmd", ".exe", ".bat", ""]) if (hasFile("node_modules", ".bin", name + ext)) return at("node_modules", ".bin", name + ext)
  return name
}

const pick = (obj, keys) => keys.find((k) => obj[k])
const add = (out, gate, cmd, source) => {
  if (cmd && !out[gate]) out[gate] = { cmd, source }
}

/* ---------- detectors ---------- */

// Each detector contributes only the gates it is confident about; earlier detectors win.
function detect() {
  const out = {}

  // Rust, Go, JVM, PHP, Ruby, TypeScript: unambiguous manifests, so check them first.
  if (hasFile("Cargo.toml")) {
    add(out, "typecheck", ["cargo", "check", "--all-targets"], "Cargo.toml")
    add(out, "lint", ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], "Cargo.toml")
    add(out, "test", ["cargo", "test"], "Cargo.toml")
    add(out, "build", ["cargo", "build", "--release"], "Cargo.toml")
  }
  if (hasFile("go.mod")) {
    add(out, "typecheck", ["go", "vet", "./..."], "go.mod")
    add(out, "lint", ["gofmt", "-l", "."], "gofmt")
    add(out, "test", ["go", "test", "./..."], "go.mod")
    add(out, "build", ["go", "build", "./..."], "go.mod")
  }
  const gradle = ["gradlew", "gradlew.bat", "mvnw", "mvnw.cmd"].find((f) => hasFile(f))
  if (gradle) {
    const isMaven = gradle.startsWith("mvnw")
    const run = process.platform === "win32" && gradle.endsWith(".cmd") ? `.\\${gradle}` : `./${gradle}`
    add(out, "test", [run, "test"], gradle)
    add(out, "build", [run, isMaven ? "package" : "build"], gradle)
  }
  if (hasFile("composer.json")) {
    add(out, "lint", ["composer", "validate", "--strict"], "composer.json")
    add(out, "test", ["composer", "test"], "composer.json")
  }
  if (hasFile("Rakefile")) add(out, "test", ["rake", "test"], "Rakefile")
  if (hasFile("tsconfig.json")) add(out, "typecheck", [bin("tsc"), "--noEmit"], "tsconfig.json")

  if (hasFile("package.json")) {
    let pkg = null
    try {
      pkg = JSON.parse(read("package.json"))
    } catch {
      pkg = null
    }
    const scripts = pkg?.scripts || {}
    const pm = (typeof pkg?.packageManager === "string" && pkg.packageManager.split("@")[0]) ||
      (hasFile("pnpm-lock.yaml") ? "pnpm" : hasFile("yarn.lock") ? "yarn" : hasFile("bun.lockb") || hasFile("bun.lock") ? "bun" : "npm")
    const run = (s) => [pm, "run", s]
    add(out, "typecheck", (s => (s ? run(s) : null))(pick(scripts, ["typecheck", "type-check", "check-types", "types", "tsc"])), "package.json")
    add(out, "lint", (s => (s ? run(s) : null))(pick(scripts, ["lint", "lint:check", "biome:lint", "check"])), "package.json")
    add(out, "test", (s => (s ? run(s) : null))(pick(scripts, ["test:ci", "test:unit", "test", "jest", "vitest", "mocha"])), "package.json")
    add(out, "build", (s => (s ? run(s) : null))(pick(scripts, ["build:prod", "build", "compile"])), "package.json")
  }

  if (hasFile("Makefile")) {
    const targets = read("Makefile").split("\n").map((l) => l.match(/^([a-zA-Z][\w.-]*):(?!=)/)?.[1]).filter(Boolean)
    const mk = (t) => (targets.includes(t) ? ["make", t] : null)
    add(out, "typecheck", mk("typecheck") || mk("type-check"), "Makefile")
    add(out, "lint", mk("lint"), "Makefile")
    add(out, "test", mk("test"), "Makefile")
    add(out, "build", mk("build"), "Makefile")
  }

  const pyproject = read("pyproject.toml")
  const poetry = hasFile("poetry.lock") ? "poetry" : "python"
  const py = (mod, ...args) => [poetry, "-m", mod, ...args]
  if (hasFile("mypy.ini") || /mypy/.test(pyproject)) add(out, "typecheck", py("mypy", "."), "mypy")
  if (hasFile(".flake8") || hasFile("ruff.toml") || /ruff|flake8|black/.test(pyproject)) add(out, "lint", py("ruff", "check", "."), "ruff")
  if (hasFile("pytest.ini") || hasFile("tox.ini") || /pytest/.test(pyproject) || hasFile("tests")) add(out, "test", py("pytest"), "pytest")
  if (hasFile("setup.py")) add(out, "build", [poetry, "setup.py", "build"], "setup.py")

  return out
}

/* ---------- run ---------- */

const found = detect()
console.log(bold(`\nverify  ${dim(root)}\n`))

if (!Object.keys(found).length) {
  console.log(yellow("No gates could be detected in this project."))
  console.log(dim("Run the real commands from package.json / Makefile / CI config by hand, and report the output.\n"))
  process.exit(2)
}

const results = []
for (const gate of GATES.filter((g) => !only.length || only.includes(g))) {
  const hit = found[gate]
  if (!hit) {
    results.push({ gate, state: "missing" })
    continue
  }
  const label = `  ${gate.padEnd(10)} ${dim(hit.cmd.join(" "))} ${dim(`(${hit.source})`)}`
  if (dryRun) {
    console.log(label)
    results.push({ gate, state: "dry" })
    continue
  }
  process.stdout.write(label + "\n")
  const t0 = process.hrtime.bigint()
  const res = spawnSync(hit.cmd[0], hit.cmd.slice(1), { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n)
  results.push({ gate, state: res.status === 0 ? "pass" : "fail", ms, code: res.status })
}

console.log("")
const icon = { pass: green("PASS"), fail: red("FAIL"), missing: yellow("MISSING"), dry: dim("DRY") }
for (const r of results) {
  console.log(`  ${icon[r.state]}  ${r.gate}${r.ms !== undefined ? dim(` ${r.ms}ms`) : ""}${r.code ? dim(` exit=${r.code}`) : ""}`)
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
if (!dryRun) {
  console.log(dim("  Gates prove the build behaves. They cannot tell whether it should behave that way."))
  console.log(dim("  A passing suite still leaves unverified: whether the right thing was built at all.\n"))
}
