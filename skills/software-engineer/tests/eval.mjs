#!/usr/bin/env node
/**
 * eval.mjs - run the skill against itself: does following it produce better output?
 *
 * The honest answer to "is this useful" cannot come from the skill's own author, because the
 * author is the party with the most to lose from a bad answer. So this runs the comparison the
 * way the Agent Skills ecosystem does it: the same task, twice, once with the skill and once
 * without, then graded on assertions written before the runs are read.
 *
 * What this script does and does not prove:
 *   - It CAN show the skill changes behaviour, and in which direction.
 *   - It CANNOT prove the skill is better than a different skill, or better than a good CLAUDE.md,
 *     or that its quality survives a different model. One model, one run per arm, no variance
 *     estimate. A single run is a demonstration, not a benchmark.
 *
 * Read the per-eval output, not just the score. A mean that hides one arm failing is worse
 * than no mean at all.
 *
 * Usage:
 *   node tests/eval.mjs                     # list the cases and exit
 *   node tests/eval.mjs --run              # emit the spawn instructions (needs a driver)
 *   node tests/eval.mjs --grade <dir>      # grade runs saved under <dir>
 *
 * Exit: 0 as designed (this script orchestrates; it does not itself call a model).
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const skillRoot = resolve(here, "..")
const EV = join(here, "evals", "evals.json")

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d
}

const cases = JSON.parse(readFileSync(EV, "utf8")).evals

// ---------- list ----------
if (!has("--run") && !has("--grade")) {
  console.log(`\n  ${cases.length} eval cases in ${EV}\n`)
  for (const c of cases) {
    console.log(`  [${c.eval_id}] ${c.eval_name}`)
    // `checks` are the mechanical assertions; `judgement` is what regex cannot decide.
    console.log(`      checks: ${(c.checks || []).map((k) => k.name).join("; ") || "none"}`) // smells:allow debug-leftover -- this script only prints a report
    console.log(`      prompt: ${c.prompt.slice(0, 100).replace(/\n/g, " ")}...`) // smells:allow debug-leftover -- this script only prints a report
    console.log("")
  }
    console.log(`  Run with --run to emit spawn instructions, --grade <dir> to grade saved runs.`)
  console.log(`  A driver is required; this script deliberately has none,`) // smells:allow debug-leftover -- this script only prints a report
  console.log(`  grading its own author's output is not a test.\n`) // smells:allow debug-leftover -- this script only prints a report
  process.exit(0)
}

// ---------- run ----------
if (has("--run")) {
  const out = resolve(opt("--out", "./eval-runs"))
  console.log(`\n  Spawn these ${cases.length * 2} runs concurrently, then save each under:`)
  console.log(`  ${out}/<eval-name>/<with_skill|without_skill>/`)
  console.log(`\n  Skill path (with-skill arm only): ${skillRoot}\n`)
  for (const c of cases) {
    console.log(`  eval ${c.eval_id} - ${c.eval_name}`)
    console.log(`    WITH   : ${c.prompt}`)
    console.log(`    WITHOUT: ${c.prompt}`)
    console.log("")
  }
  process.exit(0)
}

// ---------- grade ----------
const dir = resolve(opt("--grade"))
if (!existsSync(dir)) {
  console.error(`no such directory: ${dir}`)
  process.exit(1)
}

/**
 * Grading is mechanical wherever it can be, because a hand-graded assertion is a self-graded
 * one. Each case declares a `checks` list: a regex that must appear in the output, or one that
 * must not. Anything requiring judgement is left to a human with the case's `judgement` notes.
 */
const results = []
for (const c of cases) {
  const row = { id: c.eval_id, name: c.eval_name, arms: {} }
  for (const arm of ["with_skill", "without_skill"]) {
    const p = join(dir, c.eval_name, arm, "output.md")
    if (!existsSync(p)) {
      row.arms[arm] = { present: false }
      continue
    }
    const text = readFileSync(p, "utf8")
    const checks = (c.checks || []).map((k) => ({
      name: k.name,
      passed: k.forbid ? !k.pattern.test(text) : k.pattern.test(text),
    }))
    row.arms[arm] = { present: true, chars: text.length, checks }
  }
  results.push(row)
}

let wins = 0
let losses = 0
let ties = 0
for (const r of results) {
  const w = r.arms.with_skill
  const b = r.arms.without_skill
  if (!w.present || !b.present) {
    console.log(`  ${r.name}: incomplete (with=${w.present} without=${b.present})`)
    continue
  }
  const wc = w.checks.filter((c) => c.passed).length
  const bc = b.checks.filter((c) => c.passed).length
  const verdict = wc > bc ? "skill better" : wc < bc ? "skill WORSE" : "tie"
  if (wc > bc) wins++
  else if (wc < bc) losses++
  else ties++
  console.log(`  ${r.name}: with=${wc}/${w.checks.length} without=${bc}/${b.checks.length}  ${verdict}`)
  for (const c of w.checks) if (!c.passed) console.log(`      with-skill missed: ${c.name}`)
  for (const c of b.checks) if (!c.passed) console.log(`      baseline also missed: ${c.name}`)
}
console.log(`\n  ${wins} better / ${losses} worse / ${ties} tie, out of ${results.length} cases`)
console.log(`  Read the outputs before believing this line. One run per arm is a demonstration,`)
console.log(`  not a benchmark: it cannot estimate variance or rule out luck.\n`)