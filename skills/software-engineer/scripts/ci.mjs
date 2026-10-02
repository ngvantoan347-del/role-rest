#!/usr/bin/env node
/**
 * ci.mjs - one command that runs every gate this skill defines.
 *
 * Two jobs. First: run the gates so a developer or a pipeline has a single answer instead of
 * remembering three script invocations. Second: report which gate owns which failure, because
 * "exit 1" from a three-command script tells a person nothing about where to look.
 *
 * It is a wrapper, not an orchestrator: each gate keeps its own exit code and its own output,
 * and this only decides the order and the final verdict. A wrapper that swallowed a gate's
 * output would be worse than no wrapper.
 *
 * Usage:
 *   node scripts/ci.mjs                  # verify --changed, smells, reach, falsify
 *   node scripts/ci.mjs --no-falsify     # skip falsification and reach (the two slowest gates)
 *   node scripts/ci.mjs --format json
 *
 * Exit: 0 all gates green, 1 at least one gate failed.
 */

import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const color = !has("--no-color") && process.stdout.isTTY !== false
const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c("2", s)
const red = (s) => c("31", s)
const green = (s) => c("32", s)
const bold = (s) => c("1", s)

// Order is cheapest-and-most-blocking first, so a developer sees the fatal problem before
// scrolling past a diff scan. `reach` and `falsify` run last because each walks the tree.
// `falsify` goes after `reach`: reach is a read, falsify rewrites files.
const GATES = [
  { id: "verify", script: "verify.mjs", args: ["--changed"], owns: "did the project's own gates pass" },
  { id: "smells", script: "smells.mjs", args: ["--changed"], owns: "mechanical debt in the diff" },
  { id: "reach", script: "reach.mjs", args: [], owns: "which callers you never looked at", optional: true },
  { id: "falsify", script: "falsify.mjs", args: [], owns: "whether your tests would catch the break", optional: true },
]

const selected = has("--no-falsify") ? GATES.filter((g) => !g.optional) : GATES
const json = argv.includes("--format") && argv[argv.indexOf("--format") + 1] === "json"

console.log(bold(`\nci  ${dim(process.cwd())}\n`))
const results = []
for (const g of selected) {
  const args = g.optional && has("--no-falsify") ? [] : [...g.args, ...(json ? ["--format", "json"] : ["--no-color"])]
  process.stdout.write(`  ${g.id.padEnd(8)} ${dim(g.owns)}\n`)
  const r = spawnSync(process.execPath, [join(here, g.script), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
  const out = `${r.stdout || ""}${r.stderr || ""}`
  // Pass through the gate's own report verbatim. A wrapper that reformats output hides the one
  // line the reader needs, which is the whole reason the gate prints anything.
  if (!json && out.trim()) process.stdout.write(out.replace(/^/gm, "    "))
  results.push({ id: g.id, code: r.status, owns: g.owns })
  console.log("")
}

const failed = results.filter((r) => r.code !== 0)
if (json) {
  console.log(JSON.stringify({ results, summary: { pass: results.length - failed.length, fail: failed.length } }, null, 2))
} else {
  for (const r of results) console.log(`  ${r.code === 0 ? green("PASS") : red("FAIL")}  ${r.id.padEnd(8)} ${dim(`exit ${r.code}`)}`)
  if (failed.length) {
    console.log(red(`\n  ${failed.length} gate(s) failed:\n`))
    for (const r of failed) console.log(`    ${r.id} — ${r.owns}`)
    console.log(dim("\n  Fix the cause. Do not weaken a test or a lint rule to go green.\n"))
  } else {
    console.log(green("\n  all gates green\n"))
  }
}
process.exit(failed.length ? 1 : 0)