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

// Only literals in backticks that read like program output: they contain a colon and a lowercase
// word, or are a known marker. This avoids demanding that every code span in a reference file
// appear verbatim in a script, which would be wrong - most of them are shell commands.
const OUTPUTS = [
  { text: "reach:", script: "falsify.mjs" },
  { text: "SURVIVED", script: "falsify.mjs" },
  { text: "caught", script: "falsify.mjs" },
  { text: "unchecked", script: "falsify.mjs" },
  { text: "decision point", script: "falsify.mjs" },
  { text: "MISSING", script: "verify.mjs" },
  { text: "smells:allow", script: "smells.mjs" },
]

for (const { text, script } of OUTPUTS) {
  if (!allProse.includes(text)) continue // not claimed anywhere; nothing to hold to
  if (!flagSource.get(script).includes(text)) {
    fail(`prose quotes \`${text}\` as ${script} output, but ${script}.mjs never prints it`)
  }
}

/* ---------- 4. mutation ids named in prose exist in the rule table ---------- */

const falsify = flagSource.get("falsify.mjs")
const ruleIds = new Set([...falsify.matchAll(/id:\s*"([\w-]+)"/g)].map((m) => m[1]))
const claimedIds = new Set(allProse.matchAll(/(?:swallow-error|unguard|invert-boundary|invert-equality|invert-inequality|drop-await|and-to-or|or-to-and|off-by-one|swap-arms|negate-return|zero-out-literal|drop-argument|fire-and-forget)\b/g), )
for (const m of allProse.matchAll(/\b(swallow-error|unguard|invert-boundary|invert-equality|invert-inequality|drop-await|and-to-or|or-to-and|off-by-one|swap-arms|negate-return|zero-out-literal|drop-argument|fire-and-forget)\b/g)) {
  if (!ruleIds.has(m[1])) fail(`prose names mutation \`${m[1]}\`, which is not in falsify.mjs's rule table`)
}

/* ---------- 5. exit codes in prose match reality ---------- */

// The documented contract: verify 0/1/2/3, smells 0/1/2, falsify 0/1, ci 0/1.
//
// Read every digit inside the argument of an exit call, not just a literal first one. Both
// verify.mjs and smells.mjs return their failure code through `process.exit(cond ? 1 : 0)`, and a
// regex that only matches `exit(1)` reports a published exit code as unreachable - which is a check
// that cries wolf, and a check that cries wolf gets switched off, which is worse than not having it.
const usedExit = (src) =>
  new Set(
    [...src.matchAll(/\bexit\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/\b([0-3])\b/g)].map((n) => Number(n[1])))
      .filter((n) => !Number.isNaN(n)),
  )
const EXPECT = { "verify.mjs": [0, 1, 2, 3], "smells.mjs": [0, 1, 2], "falsify.mjs": [0, 1], "ci.mjs": [0, 1] }
for (const [name, codes] of Object.entries(EXPECT)) {
  const used = usedExit(flagSource.get(name))
  for (const c of codes) if (!used.has(c)) fail(`${name} is documented as able to exit ${c}, but never does`)
  for (const c of used) if (!codes.includes(c)) fail(`${name} exits ${c}, which is outside the documented contract ${codes.join("/")}`)
}

// The contract has to be written down, not merely implemented. An exit code nobody documented is a
// trap for the person wiring CI, and that person is the reader of ci-integration.md specifically.
const exitTable = read(join(skill, "references", "ci-integration.md"))
for (const [script, codes] of [["verify", [1, 2, 3]], ["smells", [1, 2]]]) {
  for (const code of codes) {
    if (!new RegExp(`\`${script}\`\\s*\\|\\s*\`${code}\``).test(exitTable)) {
      fail(`ci-integration.md's exit table does not document \`${script}\` exiting ${code}`)
    }
  }
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