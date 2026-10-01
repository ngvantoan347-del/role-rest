#!/usr/bin/env node
/**
 * run.mjs - run every test suite for this skill.
 *
 * Separate entry point so `npm test` stays one command as suites are added. Each suite builds
 * its own throwaway repos and cleans up after itself; a suite that throws is reported and the
 * run continues, because one broken suite should not hide the state of the others.
 *
 * Usage: node tests/run.mjs
 * Exit:  0 everything passed, 1 a suite failed or could not start.
 */

import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

const suites = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
if (!suites.length) {
  console.error(`no *.test.mjs suites found in ${here}`)
  process.exit(1)
}

let failed = 0
for (const s of suites) {
  const r = spawnSync(process.execPath, [join(here, s)], { encoding: "utf8", stdio: "inherit", maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    failed++
    console.error(`  suite failed: ${s}`)
  }
}

console.log(`\n  ${suites.length - failed}/${suites.length} suites green`)
process.exit(failed ? 1 : 0)