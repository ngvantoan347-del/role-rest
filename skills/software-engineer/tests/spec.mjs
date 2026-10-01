#!/usr/bin/env node
/**
 * spec.mjs - validate SKILL.md against the Agent Skills format, and say which rule is which.
 *
 * Why this file exists: the failure it catches is invisible. A skill with a bad `name` does
 * not throw - it is simply never listed, so the repo looks healthy, the README promises a
 * working install, and the person who tries it gets nothing at load time.
 *
 * The rules come from two places that disagree, and confusing them wastes hours:
 *
 *   - The Agent Skills spec (agentskills.io, used by Claude Code and friends) REQUIRES
 *     `name` to be lowercase kebab-case, <=64 chars. It is not a display label there.
 *   - OpenCode V2 derives the skill ID from the FILE PATH and treats `name` as a display
 *     label only. It also supports V1-only fields like `slash`.
 *
 * A skill that wants to install anywhere has to satisfy both. This check enforces the
 * portable subset and reports which host each rule comes from, so a future edit does not
 * "fix" the name for one host and break the other.
 *
 * Exit: 0 valid, 1 invalid.
 */

import { readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const skillRoot = resolve(here, "..")
const skillPath = join(skillRoot, "SKILL.md")

// spec = the portable Agent Skills contract, enforced everywhere.
// opencode-v2 = real, supported by OpenCode V2 only, so reported but never fatal.
const SPEC_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"])
const V2_ONLY_FIELDS = new Set(["slash"])

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const errors = []
const notes = []

let raw
try {
  raw = readFileSync(skillPath, "utf8")
} catch {
  console.error(`cannot read ${skillPath}`)
  process.exit(1)
}

if (!raw.startsWith("---\n")) {
  console.error("SKILL.md does not start with YAML frontmatter")
  process.exit(1)
}
const end = raw.indexOf("\n---", 3)
if (end < 0) {
  console.error("SKILL.md frontmatter is never closed")
  process.exit(1)
}
const block = raw.slice(4, end)
const body = raw.slice(end + 4)

// A deliberately small reader. The frontmatter here is flat `key: value` plus nested maps,
// and pulling in a YAML parser would give this check its own install step.
const fields = new Map()
let currentMapKey = null
for (const line of block.split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue
  const m = line.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/)
  if (!m) {
    errors.push(`unparseable frontmatter line: ${JSON.stringify(line)}`)
    continue
  }
  const [, indent, key, value] = m
  if (indent && currentMapKey) {
    fields.get(currentMapKey).push(key)
    continue
  }
  if (value === "") {
    fields.set(key, [])
    currentMapKey = key
  } else {
    fields.set(key, value.trim())
    currentMapKey = null
  }
}

for (const key of fields.keys()) {
  if (SPEC_FIELDS.has(key)) continue
  if (V2_ONLY_FIELDS.has(key)) {
    notes.push(`"${key}" is an OpenCode V2 field; other hosts ignore it (spec: ignored, harmless)`)
    continue
  }
  notes.push(`unrecognised field "${key}" - ignored at load time, probably a typo`)
}

const name = fields.get("name")
const dirName = basename(skillRoot)
if (typeof name !== "string" || !name) {
  errors.push("`name` is missing or empty (required by the spec)")
} else {
  if (name.length > 64) errors.push(`name is ${name.length} chars; the spec limit is 64`)
  if (!NAME_RE.test(name)) errors.push(`name "${name}" is not lowercase kebab-case (spec requires ${NAME_RE})`)
  // Not fatal in OpenCode V2, which takes the ID from the path, but required by the spec and
  // it is what stops a host that trusts `name` from loading two skills under one ID.
  if (name !== dirName) errors.push(`name "${name}" does not match its directory "${dirName}" (spec requirement)`)
  if (name !== name.toLowerCase()) notes.push(`name "${name}" is not lowercase; OpenCode IDs are case-sensitive`)
}

const description = fields.get("description")
if (typeof description !== "string" || !description) {
  errors.push("`description` is missing or empty; without one the skill is not advertised to the model")
} else if (description.length > 1024) {
  errors.push(`description is ${description.length} chars; the spec limit is 1024`)
}

const compatibility = fields.get("compatibility")
if (typeof compatibility === "string" && compatibility.length > 500) {
  errors.push(`compatibility is ${compatibility.length} chars; the spec limit is 500`)
}

if (!body.trim()) errors.push("SKILL.md has frontmatter but no body")

// The body is loaded into every task that matches. Past a point the rules stop being read and
// start being paid for in tokens.
const bodyLines = body.split("\n").filter((l) => l.trim()).length
if (bodyLines > 400) notes.push(`body is ${bodyLines} non-empty lines; consider moving detail into references/`)

if (errors.length) {
  console.error("SKILL.md does not satisfy the Agent Skills spec:")
  for (const e of errors) console.error(`  ${e}`)
  for (const n of notes) console.error(`  note: ${n}`)
  process.exit(1)
}
for (const n of notes) console.log(`note: ${n}`)
// This is the check's own result, not leftover debug output.
// smells:allow debug-leftover -- the single line this script exists to print
console.log(`spec ok: name="${name}" dir="${dirName}" description=${description.length}/1024 chars, body ${bodyLines} lines`)