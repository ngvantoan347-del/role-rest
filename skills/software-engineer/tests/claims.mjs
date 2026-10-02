#!/usr/bin/env node
/**
 * claims.mjs - assert that the skill's prose describes the scripts it ships.
 *
 * Why this file exists, from a real incident: `falsify.mjs` was rewritten to report survivors by
 * line, to state its own reach, and to take `--list`. SKILL.md kept describing the old version for
 * two commits, because nothing compared the two. An agent reads SKILL.md and never opens the .mjs,
 * so every fix was invisible to the only consumer that matters - and the exact failure this repo
 * exists to prevent was committed in the repo that prevents it.
 *
 * Documentation drift is not a style problem here. The prose is the interface the agent actually
 * uses, so prose that lies about a script produces wrong work, not a wrong-looking README.
 *
 * What it checks:
 *   1. Every `scripts/*.mjs` path mentioned in prose exists on disk, and every shipped script is
 *      mentioned somewhere. A script nobody can find, or one shipped but undocumented, are the
 *      same bug pointed in opposite directions.
 *   2. Every flag prose attributes to a script is accepted by that script.
 *   3. Every output string prose quotes as something a script prints is really printed.
 *   4. Every mutation id prose names exists in the rule table.
 *   5. Exit codes documented in prose match the codes the scripts actually return.
 *   6. No shipped source file contains a raw NUL or other control byte. That one is not
 *      hypothetical: `verify.mjs` shipped three NUL bytes inside template literals, which made grep
 *      treat the file as binary and silently return nothing for any search. The audit that should
 *      have caught a stale flag name was itself blinded by it.
 *
 * Usage: node tests/claims.mjs
 * Exit:  0 every claim matches the code, 1 at least one does not.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const skill = join(here, "..")
const SCRIPTS = join(skill, "scripts")

const read = (p) => readFileSync(p, "utf8")
const problems = []
const fail = (msg) => problems.push(msg)

/* ---------- 1. every shipped script is documented, every documented script exists ---------- */

const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs"))
const proseFiles = [join(skill, "SKILL.md"), ...readdirSync(join(skill, "references")).map((f) => join(skill, "references", f))]

const prose = new Map(proseFiles.map((p) => [p, read(p)]))
const allProse = [...prose.values()].join("\n")

for (const f of scripts) {
  const mentioned = proseFiles.some((p) => prose.get(p).includes(f))
  if (!mentioned) fail(`${f} is shipped but no prose file mentions it. An agent cannot invoke what it cannot find.`)
}
for (const mentioned of new Set(allProse.match(/scripts\/[\w.-]+\.mjs/g) || [])) {
  const name = mentioned.replace("scripts/", "")
  if (!scripts.includes(name)) fail(`prose references ${mentioned}, which does not exist in scripts/`)
}

/* ---------- 2. flags prose attributes to a script are accepted by it ---------- */

// Extract flags from the script's own source. This is a superset of what it accepts - git
// pass-throughs like --exclude-standard appear here too - which is the safe direction: the check
// fires when prose names a flag the script dropped, and stays quiet when prose omits one that is
// merely internal.
const flagSource = new Map(scripts.map((f) => [f, read(join(SCRIPTS, f))]))

for (const [path, text] of prose) {
  // `<script>.mjs --flag` and `--flag` on a line that names a script.
  const attributed = text.matchAll(/(verify|smells|falsify|ci)\.mjs\s+(--[\w-]+)/g)
  for (const [, script, flag] of attributed) {
    const src = flagSource.get(`${script}.mjs`)
    if (!src) continue
    if (!src.includes(flag)) {
      fail(`${relative(skill, path)}: says \`${script}.mjs ${flag}\`, but ${script}.mjs has no \`${flag}\``)
    }
  }
}

/* ---------- 3. output strings prose quotes really get printed ---------- */

// Only strings that read like program output are held to the code. Looking for the token as a
// quoted literal matters: a plain substring search is satisfied by a variable of the same name, so
// renaming a printed marker while leaving `const unchecked = []` behind would pass a check whose
// whole job is to catch exactly that.
const OUTPUTS = [
  { text: "reach:", script: "falsify" },
  { text: "SURVIVED", script: "falsify" },
  { text: "caught", script: "falsify" },
  { text: "unchecked", script: "falsify" },
  { text: "decision point", script: "falsify" },
  { text: "MISSING", script: "verify" },
  { text: "smells:allow", script: "smells" },
]
// A marker can sit anywhere inside a printed string, including the middle of a template literal
// like `  reach: ${n} break(s) ...`, so the token is looked for inside the literals rather than at
// the start of one.
//
// Comments are stripped first, and literals are read one line at a time. Both details are load
// bearing. A naive whole-file literal regex happily matches from a template literal, across a
// `//` comment, and into the next string - so a marker that only survives in a comment would look
// printed, and the check would pass on the exact drift it exists to catch. Matching per line keeps
// each span bounded to real code.
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
const stringLiterals = (src) => {
  const out = []
  for (const line of withoutComments(src).split("\n")) {
    const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g
    let m
    while ((m = re.exec(line))) out.push(m[2])
  }
  return out
}
const literalsOf = new Map(scripts.map((f) => [f, stringLiterals(flagSource.get(f))]))

for (const { text, script } of OUTPUTS) {
  if (!allProse.includes(text)) continue // not claimed anywhere; nothing to hold to
  // A missing script is already reported by rule 1, with a better message. Continuing into the
  // lookup below would throw a TypeError, and a stack trace is not a finding - it reads as the
  // check being broken rather than the repo being wrong.
  if (!literalsOf.has(`${script}.mjs`)) continue
  if (!literalsOf.get(`${script}.mjs`).some((lit) => lit.includes(text))) {
    fail(`prose quotes \`${text}\` as ${script}.mjs output, but ${script}.mjs never prints it`)
  }
}

/* ---------- 4. mutation ids named in prose exist in the rule table ---------- */

// Every rule reads its target defensively and bails out when the file is gone. A missing script is
// rule 1's finding, reported once with the clearest message; crashing here instead turns a real
// defect into a stack trace, which reads as the checker being broken rather than the repo being
// wrong - and a checker that crashes on the input it exists to diagnose is one people stop running.
const falsify = flagSource.get("falsify.mjs")
const ruleIds = new Set(falsify ? [...falsify.matchAll(/id:\s*"([\w-]+)"/g)].map((m) => m[1]) : [])

// Candidate names come from a fixed vocabulary rather than from the live rule table. Deriving them
// from the code would make the check vacuous: delete a rule and the check would stop looking for it,
// so the stale prose reference would pass.
//
// The direction this catches is a **removed** rule, because that is the drift that actually occurs:
// prose is written after the code, so a rule gets renamed or merged and the docs keep the old name.
// A brand-new id invented in prose is not caught, because telling an invented `\w+-\w+` apart from a
// flag like `--no-falsify` needs prose context this check does not have. Stated here rather than
// implied, so nobody assumes more coverage than exists.
const CANDIDATES = [
  "swallow-error", "unguard", "unguard-colon", "invert-boundary", "invert-equality", "invert-inequality",
  "drop-await", "and-to-or", "or-to-and", "off-by-one", "swap-arms", "negate-return",
  "zero-out-literal", "drop-argument", "fire-and-forget",
]
if (falsify) {
  for (const m of allProse.matchAll(new RegExp(`\\b(${CANDIDATES.join("|")})\\b`, "g"))) {
    if (!ruleIds.has(m[1])) fail(`prose names mutation \`${m[1]}\`, which is not in falsify.mjs's rule table`)
  }
}

/* ---------- 5. exit codes in prose match reality ---------- */

// Read every digit inside the argument of an exit call, including a ternary's branches. Both
// verify.mjs and smells.mjs return their failure through `process.exit(cond ? 1 : 0)`, and a regex
// matching only literal `exit(1)` reports a published exit code as unreachable - which is a check
// that cries wolf, and one that cries wolf gets switched off, costing more than it was worth.
const usedExit = (src) =>
  new Set(
    [...src.matchAll(/\bexit\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/\d/g)].map((n) => Number(n[0]))),
  )

// The contract is the table in ci-integration.md, read rather than restated. A copy in this file
// would be the same fact written twice, and one of the two would drift - which is the class of
// problem this file exists to end. The table covers verify and smells; falsify and ci are also
// run from a pipeline, so their codes have to be written down there too.
const exitTable = read(join(skill, "references", "ci-integration.md"))
const documented = (script) => {
  const codes = new Set(
    [...exitTable.matchAll(new RegExp(`\`${script}\`\\s*\\|\\s*\`(\\d)\``, "g"))].map((m) => Number(m[1])),
  )
  // The table states `0` once, on a row labelled `both`, because every script returns it.
  if (/\|?\s*`?both`?\s*\|\s*`0`/.test(exitTable)) codes.add(0)
  return codes
}
const TABLE_COVERS = ["verify", "smells", "falsify", "ci"]

for (const script of TABLE_COVERS) {
  // Same reason as above: a missing script is rule 1's finding, reported once with a clearer
  // message. Reading it here would produce a TypeError instead.
  if (!flagSource.has(`${script}.mjs`)) continue
  const used = usedExit(flagSource.get(`${script}.mjs`))
  const doc = documented(script)
  if (!doc.size) {
    fail(`ci-integration.md's exit table never mentions \`${script}\`, which exits ${[...used].sort().join("/")}. An undocumented exit code is a trap for whoever wires CI.`)
    continue
  }
  for (const c of used) {
    if (!doc.has(c)) fail(`\`${script}\` can exit ${c}, which ci-integration.md does not document`)
  }
  // The reverse direction, because a documented code the code cannot produce is the same lie in
  // the other direction - someone wires `verify: 3 means bad format` and gets a green build.
  for (const c of doc) if (!used.has(c)) fail(`ci-integration.md documents \`${script}\` exiting ${c}, but the script never does`)
}

/* ---------- 6. no control bytes in shipped source ---------- */

for (const f of scripts) {
  const buf = readFileSync(join(SCRIPTS, f))
  const bad = [...buf].filter((b) => b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32) || b === 127)
  if (bad.length) {
    fail(
      `${f} contains ${bad.length} raw control byte(s). That makes grep treat it as binary and ` +
        `return nothing for any search, and makes GitHub refuse to render a diff. Use an escape.`,
    )
  }
}

/* ---------- report ---------- */

if (problems.length) {
  console.error(`\nclaims  ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error("\n  The prose is the interface the agent uses. A stale flag name produces wrong\n  work, not a wrong-looking README.\n")
  process.exit(1)
}

console.log(
  `claims ok: ${scripts.length} scripts, ${proseFiles.length} prose files, ` +
    `${ruleIds.size} mutation rules, exit contracts 0/1/2/3 held`,
)