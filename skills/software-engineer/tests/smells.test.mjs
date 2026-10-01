#!/usr/bin/env node
/**
 * smells.test.mjs - tests for scripts/smells.mjs.
 *
 * Every rule here is a claim about what must and must not be reported. The "must not" half
 * matters more: a scanner that cries wolf gets disabled, and a disabled scanner is worse than
 * no scanner, so the exemptions are tested as carefully as the detections.
 *
 * The runner and fixtures live in harness.mjs.
 *
 * Usage: node tests/smells.test.mjs
 * Exit:  0 all tests passed, 1 a test failed.
 */

import { SMELLS, cleanup, createRunner, eq, findings, has, hasNot, ids, ok, repo, run } from "./harness.mjs"

const { test, runAll } = createRunner("smells.mjs")

/* ---------- smells: core rules ---------- */

test("smells: finds a secret in source and in a config file", () => {
  const r = repo({
    "src/a.ts": 'const apiKey = "sk-1234567890abcdefgh"\n',
    "deploy.yaml": 'password: "hunter2hunter2"\n',
  })
  const res = run(SMELLS, ["--format", "json"], r.dir)
  eq(res.code, 1, "secrets exit 1")
  const f = findings(res.out)
  ok(f.some((x) => x.id === "hardcoded-secret"), "source secret found")
  ok(f.some((x) => x.file === "deploy.yaml" && x.id === "hardcoded-secret"), "config secret found too")
})

test("smells: a clean repo exits 0", () => {
  const r = repo({ "src/a.ts": "export const add = (a: number, b: number) => a + b\n" })
  const res = run(SMELLS, ["--format", "json"], r.dir)
  eq(res.code, 0, "clean repo passes")
  eq(findings(res.out).length, 0, "no findings")
})

test("smells: an env secret with a placeholder default is not a finding", () => {
  // The whole point of the exemption: `process.env` fallbacks are idiomatic, and flagging
  // every one of them teaches people to delete the check rather than fix it.
  const r = repo({ "src/a.ts": 'const key = process.env.API_KEY || "your-api-key-here"\n' })
  eq(run(SMELLS, ["--format", "json"], r.dir).code, 0, "placeholder default exempt")
})

test("smells: an env secret with a real default is a finding", () => {
  const r = repo({ "src/a.ts": 'const key = process.env.API_KEY || "aK9mQ2xR7bT4vW8zL0pY"\n' })
  const res = run(SMELLS, ["--format", "json"], r.dir)
  ok(ids(res.out).includes("env-default-secret"), "hardcoded fallback found")
})

test("smells: catches the enterprise rules a unit test would not", () => {
  const r = repo({
    "src/net.py": 'import requests, pickle, subprocess\nrequests.get(u, verify=False)\nsubprocess.run(cmd, shell=True)\npickle.loads(b)\n',
    "src/q.sql": 'SELECT * FROM t WHERE id = " + i\n',
  })
  const got = ids(run(SMELLS, ["--format", "json"], r.dir).out)
  for (const want of ["tls-verify-off", "shell-injection", "unsafe-deserialize", "sql-string-build"]) {
    ok(got.includes(want), `${want} reported; got ${got.join(",")}`)
  }
})

test("smells: flags a committed merge conflict", () => {
  const r = repo({ "src/a.ts": "<<<<<<< HEAD\nexport const a = 1\n=======\nexport const a = 2\n>>>>>>> other\n" })
  ok(ids(run(SMELLS, ["--format", "json"], r.dir).out).includes("merge-marker"), "merge marker found")
})

test("smells: non-deterministic tests are flagged only in test files", () => {
  const r = repo({
    "src/a.ts": "export const t = () => Date.now()\n",
    "tests/a.test.ts": "test('x', () => { expect(Date.now()).toBeGreaterThan(0) })\n",
  })
  const f = findings(run(SMELLS, ["--format", "json"], r.dir).out)
  const inTest = f.filter((x) => x.id === "nondeterministic-test")
  eq(inTest.length, 1, "one finding, in the test only")
  ok(inTest[0].file.startsWith("tests/"), "the test file is the one flagged")
})

test("smells: re-ranking an error to a warning keeps the finding", () => {
  // A TODO usually lives in a comment, and warnings are skipped inside comments. Downgrading
  // the rule without this would delete findings rather than prioritise them.
  const r = repo({
    "src/a.ts": "// TODO: revisit\n",
    ".software-engineer.json": JSON.stringify({ smells: { severity: { "debt-marker": "warn" } } }),
  })
  const f = findings(run(SMELLS, ["--format", "json"], r.dir).out)
  const todo = f.filter((x) => x.id === "debt-marker")
  eq(todo.length, 1, "still reported")
  eq(todo[0].sev, "warn", "re-ranked")
})

test("smells: a disabled rule stops reporting", () => {
  const r = repo({
    "src/a.ts": 'const k = "ghp_abcdefghijklmnopqrstuvwxyz0123"\n',
    ".software-engineer.json": JSON.stringify({ smells: { disable: ["github-token"] } }),
  })
  const got = ids(run(SMELLS, ["--format", "json"], r.dir).out)
  ok(!got.includes("github-token"), "disabled: " + got.join(","))
})

test("smells: a repo-defined rule is applied", () => {
  const r = repo({
    "src/a.ts": "import { v1_fetch } from '@internal/legacy'\n",
    ".software-engineer.json": JSON.stringify({
      smells: { rules: [{ id: "internal-legacy", severity: "error", pattern: "v1_fetch", message: "blocked by the platform team" }] },
    }),
  })
  const f = findings(run(SMELLS, ["--format", "json"], r.dir).out)
  ok(f.some((x) => x.id === "internal-legacy" && x.sev === "error"), "custom rule applied")
})

test("smells: an invalid repo pattern fails loudly instead of being skipped", () => {
  const r = repo({
    "src/a.ts": "export const a = 1\n",
    ".software-engineer.json": JSON.stringify({ smells: { rules: [{ id: "bad", pattern: "[unclosed" }] } }),
  })
  const res = run(SMELLS, [], r.dir)
  eq(res.code, 2, "usage error")
  has(res.err, "invalid pattern", "names the problem")
})

test("smells: the scanner's own rule table is not its own finding", () => {
  // A scanner spells out what a secret looks like. Flagging itself trains people to ignore it.
  const r = repo({
    "scripts/smells.mjs": 'const SECRET = new Set(["github-token", "aws-key"])\n',
    "scripts/lint-rules.ts": 'export const RULES = [/password/, /secret/i]\n',
  })
  const res = run(SMELLS, ["--format", "json"], r.dir)
  eq(findings(res.out).length, 0, "rule tables are exempt")
})

test("smells: a scanner's test harness is exempt, but an ordinary test file is not", () => {
  // The harness exists to hold planted secrets and real timers. Exempting it stops the
  // scanner teaching people to ignore it. Exempting every test file would hide the one place
  // a leaked real credential actually turns up, so the exemption has to be earned.
  const r = repo({
    "tests/run.mjs": '// harness for smells.mjs\nconst f = \'const k = "ghp_zzzzzzzzzzzzzzzzzzzzzzzzzz01"\'\n',
    "tests/plain.test.ts": 'const t = "ghp_abcdefghijklmnopqrstuvwxyz01"\n',
    "src/app.ts": 'const t = "ghp_abcdefghijklmnopqrstuvwxyz01"\n',
  })
  const files = new Set(findings(run(SMELLS, ["--format", "json"], r.dir).out).map((f) => f.file))
  ok(!files.has("tests/run.mjs"), "harness exempt")
  ok(files.has("tests/plain.test.ts"), "ordinary test file still scanned")
  ok(files.has("src/app.ts"), "source still scanned")
})

/* ---------- smells: budgets and scoping ---------- */

// A warning has to live in real code, not a comment: warnings are skipped inside comments, so
// a fixture built from a commented-out TODO would report zero warnings and prove nothing. It
// also cannot be `console.log("x")`, which is exempted as a CLI's intentional output - only an
// interpolated argument counts as leftover debug.
const WARN_FILE = "export const f = (x: number) => {\n  console.log(x)\n  return 1\n}\n"

test("smells: a scanning harness can silence findings without disabling them repo-wide", () => {
  // The skill's own scripts are scanned by the skill's own scanner, so the harness needs a
  // way to keep a planted-secret fixture readable rather than deleting the fixture.
  const r = repo({
    "tests/run.mjs": '// harness for smells.mjs\nconst t = "ghp_abcdefghijklmnopqrstuvwxyz01" // smells:allow github-token -- planted fixture for the test below\n',
  })
  const got = ids(run(SMELLS, ["--format", "json"], r.dir).out)
  ok(!got.includes("github-token"), "inline allow works inside a harness: " + got.join(","))
})

test("smells: an inline allow with a reason silences exactly that rule", () => {
  const r = repo({
    "src/a.ts": [
      'const key = process.env.API_KEY || "aK9mQ2xR7bT4vW8zL0pY" // smells:allow env-default-secret -- fixed in PLAT-4821',
      'const t = "ghp_abcdefghijklmnopqrstuvwxyz01"',
    ].join("\n"),
  })
  const got = ids(run(SMELLS, ["--format", "json"], r.dir).out)
  ok(!got.includes("env-default-secret"), "the allowed rule is silenced: " + got.join(","))
  ok(got.includes("github-token"), "an unrelated rule on another line still fires")
})

test("smells: an allow without a reason is itself reported", () => {
  // The reason is the whole point: a bare suppression is a rule nobody can challenge.
  const r = repo({ "src/a.ts": 'const t = "ghp_abcdefghijklmnopqrstuvwxyz01" // smells:allow github-token\n' })
  const got = ids(run(SMELLS, ["--format", "json"], r.dir).out)
  ok(got.includes("bare-suppression"), "bare suppression flagged: " + got.join(","))
  ok(!got.includes("github-token"), "and it still silences the rule it names")
})

test("smells: an allow on its own line covers the next line", () => {
  const r = repo({
    "src/a.ts": "// smells:allow debt-marker -- tracked in ISSUE-9\nexport const TODO = 1\n",
  })
  const got = ids(run(SMELLS, ["--format", "json"], r.dir).out)
  ok(!got.includes("debt-marker"), "next line suppressed: " + got.join(","))
  ok(!got.includes("bare-suppression"), "and the reason was given")
})

test("smells: --max-warnings turns warnings into a build failure", () => {
  const r = repo({ "src/a.ts": WARN_FILE })
  eq(run(SMELLS, ["--format", "json"], r.dir).code, 0, "warnings alone do not fail")
  eq(run(SMELLS, ["--format", "json", "--max-warnings", "0"], r.dir).code, 1, "budget of 0 fails")
})

test("smells: maxWarnings from config is honoured", () => {
  const r = repo({
    "src/a.ts": WARN_FILE,
    ".software-engineer.json": JSON.stringify({ smells: { maxWarnings: 0 } }),
  })
  eq(run(SMELLS, ["--format", "json"], r.dir).code, 1, "config budget applies")
})

test("smells: --ignore accepts globs, not just substrings", () => {
  const r = repo({
    "src/a.ts": "// TODO: x\n",
    "vendor/b.ts": "// TODO: x\n",
  })
  const f = findings(run(SMELLS, ["--format", "json", "--ignore", "vendor/**"], r.dir).out)
  ok(f.some((x) => x.file === "src/a.ts"), "kept the real one")
  ok(!f.some((x) => x.file.startsWith("vendor/")), "ignored vendor")
})

test("smells: --base scopes the scan to a branch diff", () => {
  const r = repo({ "src/old.ts": "export const a = 1\n" })
  r.write("src/new.ts", "// TODO: new\n")
  r.git("add", "-A")
  r.git("commit", "-qm", "second")
  const f = findings(run(SMELLS, ["--format", "json", "--changed", "--base", "HEAD~1"], r.dir).out)
  ok(f.some((x) => x.file === "src/new.ts"), "new file scanned")
  ok(!f.some((x) => x.file === "src/old.ts"), "file outside the diff is not scanned")
})

test("smells: source changes with no test change are reported", () => {
  const r = repo({ "src/old.ts": "export const a = 1\n" })
  r.write("src/new.ts", "export const b = 2\n")
  ok(ids(run(SMELLS, ["--format", "json", "--changed"], r.dir).out).includes("no-test-change"), "flagged")
})

test("smells: the synthetic finding has no line, and github format survives that", () => {
  const r = repo({ "src/old.ts": "export const a = 1\n" })
  r.write("src/new.ts", "export const b = 2\n")
  const res = run(SMELLS, ["--format", "github", "--changed"], r.dir)
  has(res.out, "::warning title=no-test-change", "annotation without a file location")
  hasNot(res.out, "file=<changed files>", "must not invent a file path")
})

/* ---------- run ---------- */

const cleanupAndRun = async () => {
  try {
    await runAll()
  } finally {
    cleanup()
  }
}

await cleanupAndRun()
