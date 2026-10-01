#!/usr/bin/env node
/**
 * fixture.mjs - materialise an eval case's fixture files into a real repo on disk.
 *
 * An eval prompt that references a file the agent cannot find measures nothing: both arms
 * answer "that file does not exist" and the skill's actual claim goes untested. So every case
 * declares `fixture` files, and this writes them into a throwaway git repo the agent can read.
 *
 * Usage: node tests/fixture.mjs <eval-name> <dest-dir>
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(here, "evals", "evals.json"), "utf8")).evals

const [name, destArg] = process.argv.slice(2)
const found = cases.find((c) => c.eval_name === name)
if (!found) {
  console.error(`unknown case: ${name}\navailable: ${cases.map((c) => c.eval_name).join(", ")}`)
  process.exit(1)
}

const dest = destArg ? resolve(destArg) : mkdtempSync(join(process.env.TMPDIR || "/tmp", "se-eval-"))
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

for (const [p, content] of Object.entries(found.fixture)) {
  const full = join(dest, p)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

const git = (...a) => spawnSync("git", a, { cwd: dest, stdio: "ignore" })
git("init", "-q")
git("config", "user.email", "eval@example.com")
git("config", "user.name", "eval")
git("add", "-A")
git("commit", "-qm", "fixture")

// The path on stdout is this script's product: the caller reads it to know where to work.
console.log(dest) // smells:allow debug-leftover -- the path is this script's output