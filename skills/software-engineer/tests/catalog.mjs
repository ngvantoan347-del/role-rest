#!/usr/bin/env node
/**
 * catalog.mjs - check that the HTTP catalog manifest matches what is on disk.
 *
 * The manifest is what an install from a URL actually downloads. A reference file or a script
 * missing from it produces an install that looks fine and then fails at the moment the agent
 * tries to run a command the skill told it to run - a failure that shows up on someone else's
 * machine, with no error pointing back here.
 *
 * Exit: 0 in sync, 1 out of sync.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
// <repo>/skills/<name>/tests -> skillRoot is the skill directory, repoRoot is <repo>.
const skillRoot = resolve(here, "..")
const repoRoot = resolve(skillRoot, "..", "..")

// The HTTP catalog manifest moved with the skill from `catalog/` to `skills/`, because the
// vercel-labs CLI - which is how most people install a skill - discovers `skills/<name>/`
// but has no idea a `catalog/` directory exists. Probed rather than hardcoded so the error
// message can name whichever path is missing.
const candidates = [join("skills", "index.json"), "index.json", join("catalog", "index.json")]
const manifestPath = candidates.map((p) => join(repoRoot, p)).find((p) => {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
})
if (!manifestPath) {
  // Absence here is usually not an error. `npx skills add` copies the skill directory and nothing
  // else, so an installed copy has no manifest above it and this check has nothing to say.
  // Exiting 1 would make a correct installation look broken - and a check that fires on healthy
  // state is a check people learn to skip, which costs more than the check was worth.
  //
  // Guessing from the directory name does not work: a checkout puts the skill in `<repo>/skills/`
  // and an install puts it in `<host>/skills/`, so both parents are called `skills`. The only
  // reliable signal is a positive one - files that exist in the source repo and in no install.
  const SOURCE_REPO_MARKERS = ["package.json", "demo.sh", ".software-engineer.json", "CONTRIBUTING.md"]
  const looksLikeSourceRepo = SOURCE_REPO_MARKERS.some((f) => existsSync(join(repoRoot, f)))

  if (looksLikeSourceRepo) {
    console.error(
      `no catalog manifest found in the source repo; looked for: ${candidates.join(", ")}\n` +
        `  (relative to ${repoRoot}). An HTTP catalog install would fetch a skill with no files.`,
    )
    process.exit(1)
  }
  console.log("catalog ok: installed copy, no manifest here to check (expected outside the source repo)")
  process.exit(0)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
} catch (e) {
  console.error(`cannot read ${relative(repoRoot, manifestPath)}: ${e.message}`)
  process.exit(1)
}

if (!Array.isArray(manifest.skills)) {
  console.error(`${relative(repoRoot, manifestPath)} has no \`skills\` array`)
  process.exit(1)
}

// Never descend into these: .git holds a full copy of every blob, and node_modules holds
// hundreds of thousands of files. Walking either turns a 10ms check into a 30s one.
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "vendor", "target"])

// `base` is threaded through explicitly rather than recomputed per call: deriving it from the
// current directory silently rebases every recursive call, which turns all paths into bare
// filenames and makes every manifest entry look missing.
function walk(dir, base, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    // Plugin manifests live in dot-directories, so hidden entries cannot be skipped wholesale.
    if (e.name.startsWith(".") && !/^\.(claude|codex|cursor)-plugin$/.test(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else if (statSync(p).isFile()) out.push(relative(base, p).replace(/\\/g, "/"))
  }
  return out
}

// An HTTP catalog is a base URL plus this manifest, and OpenCode resolves every entry as
// `<base-url>/<skill-name>/<file>`. So manifest paths are relative to the directory holding
// index.json - not to the skill directory - and a path written the other way silently 404s
// at install time on someone else's machine.
const catalogDir = dirname(manifestPath)
const catalogRoot = resolve(catalogDir)
const skillName = basename(skillRoot)

const onDisk = new Set(walk(catalogDir, catalogRoot))
// The manifest describes what to download; it is not itself downloaded.
onDisk.delete(relative(catalogRoot, manifestPath).replace(/\\/g, "/"))
const listed = new Set()
const problems = []
const notes = []

for (const skill of manifest.skills) {
  if (!skill.name) problems.push("a skill entry has no name")
  if (!Array.isArray(skill.files)) {
    problems.push(`skill "${skill.name}": files must be an array`)
    continue
  }
  const entry = `${skill.name}/SKILL.md`
  if (!skill.files.includes(entry)) problems.push(`skill "${skill.name}": ${entry} is not listed`)
  for (const f of skill.files) {
    if (listed.has(f)) problems.push(`listed twice: ${f}`)
    listed.add(f)
    if (!onDisk.has(f)) problems.push(`listed but not on disk: ${f}`)
    // Must stay inside the catalog: a leading `..` or an absolute path escapes the base URL
    // and OpenCode rejects the whole entry.
    if (f.startsWith("/") || f.split("/").includes("..")) problems.push(`path escapes the catalog: ${f}`)
  }
}
for (const f of onDisk) {
  if (!listed.has(f)) problems.push(`on disk but not listed: ${f}`)
}

// A cross-reference that resolves to nothing is a dead end in the middle of a task. Paths in
// prose are relative to the skill directory, while manifest paths are relative to the
// catalog, so this check resolves them against the file they appear in.
for (const f of [...onDisk].filter((p) => p.startsWith(`${skillName}/references/`))) {
  const text = readFileSync(join(catalogRoot, f), "utf8")
  for (const m of text.matchAll(/`(references\/[a-z0-9._-]+\.md)`/g)) {
    if (!onDisk.has(`${skillName}/${m[1]}`)) problems.push(`${f} links to a missing file: ${m[1]}`)
  }
}

// A script referenced with an absolute path breaks the moment the skill is installed
// anywhere but this repository.
for (const f of [...onDisk].filter((p) => p.startsWith(`${skillName}/`) && !p.endsWith(".json"))) {
  const text = readFileSync(join(catalogRoot, f), "utf8")
  for (const m of text.matchAll(/`\/[\w./-]+\.(mjs|ts|js|sh)`/g)) {
    notes.push(`${f} contains an absolute path: ${m[0]} - it will not resolve after install`)
  }
}

// Version drift is the quietest install failure: a host that caches by version keeps serving
// the old files, the change "did not take", and the only clue is a stale behaviour nobody can
// reproduce. Every manifest that states a version has to agree with the catalog.
const PLUGIN_RE = /^\.(claude|codex|cursor)-plugin\/plugin\.json$/
const versionFiles = walk(repoRoot, repoRoot).filter((p) => PLUGIN_RE.test(p))
const catalogVersion = manifest.skills[0]?.version
for (const vf of versionFiles) {
  let v
  try {
    v = JSON.parse(readFileSync(join(repoRoot, vf), "utf8")).version
  } catch (e) {
    problems.push(`cannot parse ${vf}: ${e.message}`)
    continue
  }
  if (!v) problems.push(`${vf} has no version; a host that caches by version cannot update`)
  else if (catalogVersion && !String(catalogVersion).startsWith(String(v).split(".")[0])) {
    problems.push(`version mismatch: ${vf} says ${v}, ${relative(repoRoot, manifestPath)} says ${catalogVersion}`)
  }
}
// The plugin manifests point at the skills root. If that directory moves, `skills: "./skills/"`
// resolves to nothing on every host that reads them - an install that succeeds and loads air.
for (const vf of versionFiles) {
  const spec = JSON.parse(readFileSync(join(repoRoot, vf), "utf8")).skills
  if (!spec) {
    problems.push(`${vf} has no "skills" field; the plugin advertises no skills`)
    continue
  }
  const resolved = resolve(repoRoot, spec)
  if (!existsSync(resolved)) problems.push(`${vf} points at "${spec}", which does not exist`)
}

if (problems.length) {
  console.error("catalog is out of sync:")
  for (const p of problems) console.error(`  ${p}`)
  for (const n of notes) console.error(`  note: ${n}`)
  process.exit(1)
}
for (const n of notes) console.log(`note: ${n}`)
console.log(`catalog ok: ${relative(repoRoot, manifestPath)}, ${manifest.skills.length} skill(s), ${listed.size} files, all references resolve`)