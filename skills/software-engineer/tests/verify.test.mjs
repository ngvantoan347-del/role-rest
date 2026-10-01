#!/usr/bin/env node
/**
 * verify.test.mjs - tests for scripts/verify.mjs.
 *
 * verify.mjs makes claims that only fail when something is wrong: a scanner that reports a
 * configured linter as MISSING, a monorepo gate that runs 200 packages to verify a one-line
 * change, a machine format that stops being parseable because a child process printed
 * something. Those are cheap to check here and expensive to discover in someone's CI.
 *
 * The runner and fixtures live in harness.mjs.
 *
 * Usage: node tests/verify.test.mjs
 * Exit:  0 all tests passed, 1 a test failed.
 */

import { SMELLS, VERIFY, cleanup, createRunner, eq, findings, has, hasNot, ids, ok, repo, run } from "./harness.mjs"

const { test, runAll } = createRunner("verify.mjs")

/* ---------- verify: gate detection ---------- */

test("verify: detects package.json gates and runs them", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "x", scripts: { lint: "exit 0", test: "exit 0" } }),
  })
  const res = run(VERIFY, ["--format", "json"], r.dir)
  eq(res.code, 0, "should pass")
  const j = JSON.parse(res.out)
  const byGate = Object.fromEntries(j.results.map((x) => [x.gate, x.state]))
  eq(byGate.lint, "pass", "lint ran")
  eq(byGate.test, "pass", "test ran")
  // A gate that does not exist is unverified, never silently green.
  eq(byGate.typecheck, "missing", "typecheck reported missing")
})

test("verify: a failing gate exits 1 and reports the gate by name", () => {
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 3" } }) })
  const res = run(VERIFY, ["--only", "test"], r.dir)
  eq(res.code, 1, "failing gate must fail the run")
  has(res.out, "FAIL", "failure shown")
  has(res.out, "test", "gate named")
})

test("verify: no detectable gates exits 2, not 0", () => {
  const r = repo({ "README.md": "hi" })
  const res = run(VERIFY, [], r.dir)
  eq(res.code, 2, "nothing detectable is not a pass")
  has(res.out, "No gates", "explains why")
})

test("verify: MISSING gates are named in the report, not folded into pass", () => {
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 0" } }) })
  const res = run(VERIFY, [], r.dir)
  has(res.out, "missing:", "missing summary printed")
  has(res.out, "lint", "missing gate named")
  hasNot(res.out, "all 4 detected", "must not claim four passed")
})

/* ---------- verify: monorepo scoping ---------- */

const MONOREPO = {
  "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { test: "exit 0" } }),
  "packages/a/package.json": JSON.stringify({ name: "pkg-a", scripts: { test: "exit 0" } }),
  "packages/b/package.json": JSON.stringify({ name: "pkg-b", scripts: { test: "exit 0" } }),
  "packages/a/index.ts": "export const a = 1\n",
  "packages/b/index.ts": "export const b = 1\n",
}

test("verify: --changed scopes gates to the packages the diff touches", () => {
  const r = repo(MONOREPO)
  r.write("packages/a/index.ts", "export const a = 2\n")
  const res = run(VERIFY, ["--changed", "--format", "json"], r.dir)
  const pkgs = new Set(JSON.parse(res.out).results.map((x) => x.pkg))
  ok(pkgs.has("pkg-a"), "touched package runs")
  ok(!pkgs.has("pkg-b"), "untouched package does not run: " + [...pkgs].join(","))
})

test("verify: --changed fans out to every package when a root file changes", () => {
  const r = repo(MONOREPO)
  // A root lockfile change invalidates every package's assumptions, so skipping packages here
  // would be a green that means nothing.
  r.write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { test: "exit 0" }, dependencies: { left: "pad" } }))
  const res = run(VERIFY, ["--changed", "--format", "json"], r.dir)
  const pkgs = new Set(JSON.parse(res.out).results.map((x) => x.pkg))
  ok(pkgs.has("pkg-a") && pkgs.has("pkg-b"), "both packages run on a root change: " + [...pkgs].join(","))
})

test("verify: without --changed the whole workspace is visible", () => {
  const r = repo(MONOREPO)
  const res = run(VERIFY, ["--dry-run", "--format", "json"], r.dir)
  has(res.out, "(root)", "root gates detected")
})

/* ---------- verify: config override ---------- */

test("verify: repo config replaces a detected gate and can disable one", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 1", lint: "exit 1" } }),
    ".software-engineer.json": JSON.stringify({
      verify: { gates: { test: ["node", "-e", "process.exit(0)"], lint: null } },
    }),
  })
  const res = run(VERIFY, ["--format", "json"], r.dir)
  const j = JSON.parse(res.out)
  eq(j.results.find((x) => x.gate === "test").state, "pass", "config gate replaces the failing script")
  eq(j.results.find((x) => x.gate === "lint").state, "missing", "null disables the gate")
})

test("verify: a config command keeps a quoted argument as one token", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "x", scripts: {} }),
    ".software-engineer.json": JSON.stringify({ verify: { gates: { test: "node -e \"process.exit(0)\"" } } }),
  })
  const res = run(VERIFY, ["--format", "json"], r.dir)
  eq(JSON.parse(res.out).results.find((x) => x.gate === "test").state, "pass", "quoted -e argument survives")
})

test("verify: verify config lives beside the smells config without collision", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 1" } }),
    ".software-engineer.json": JSON.stringify({
      verify: { gates: { test: ["node", "-e", "process.exit(0)"] } },
      smells: { maxWarnings: 0 },
    }),
  })
  eq(run(VERIFY, [], r.dir).code, 0, "verify block applied")
})

/* ---------- verify: output formats ---------- */

test("verify: --format github emits annotations and a summary line", () => {
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 1", lint: "exit 0" } }) })
  const res = run(VERIFY, ["--format", "github"], r.dir)
  has(res.out, "::error", "error annotation")
  has(res.out, "::warning", "missing gate is a warning")
  has(res.out, "1 failed", "summary line")
})

test("verify: a signal-terminated gate fails even without an exit code", () => {
  // Some runners report a killed gate as a signal with no status. Treating that as anything but
  // a failure would report a crashed test suite as green.
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "kill -TERM $$" } }) })
  const res = run(VERIFY, ["--only", "test"], r.dir)
  eq(res.code, 1, "signal kill is a failure")
  has(res.out, "signal=SIGTERM", "the signal is named so the cause is not a mystery")
})

test("verify: --format sarif is valid JSON with the failing gate as a result", () => {
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 1" } }) })
  const res = run(VERIFY, ["--format", "sarif", "--only", "test"], r.dir)
  const j = JSON.parse(res.out)
  eq(j.version, "2.1.0", "sarif version")
  const rules = j.runs[0].results.map((x) => x.ruleId)
  ok(rules.includes("verify/test"), "failing gate appears as a result")
})

test("verify: machine-readable formats stay parseable when a gate is noisy", () => {
  const r = repo({
    // A failing gate, because a passing gate has nothing to explain: the question here is
    // whether the captured reason survives the trip through each machine format.
    "package.json": JSON.stringify({ name: "x", scripts: { test: "echo NOISE_MARKER; exit 1" } }),
  })
  for (const fmt of ["json", "sarif", "github"]) {
    const res = run(VERIFY, ["--format", fmt], r.dir)
    if (fmt !== "github") {
      // A stray line from the child process breaks JSON.parse here, which is the whole point.
      try {
        JSON.parse(res.out)
      } catch (e) {
        throw new Error(`${fmt} must be pure JSON: ${e.message}`)
      }
    }
    has(res.out, "NOISE_MARKER", `${fmt} still captured output`)
  }
})

test("verify: an unknown --format is a usage error, not a run", () => {
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 0" } }) })
  eq(run(VERIFY, ["--format", "nope"], r.dir).code, 3, "bad usage exits 3")
})

/* ---------- verify: timeout ---------- */

test("verify: a gate that hangs is killed and reported as failed", () => {
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: 'node -e "setTimeout(()=>{},60000)"' } }) })
  const res = run(VERIFY, ["--only", "test", "--timeout", "1200"], r.dir)
  eq(res.code, 1, "timeout is a failure, never a pass")
  has(res.out, "timed out", "reason reported")
})

test("verify: the timeout also kills the gate's children, not just the runner", () => {
  // `npm run` is npm -> sh -> node. If only npm dies, the grandchild keeps the output pipe
  // open and the caller blocks for the gate's full runtime - which in CI looks like a hung
  // job on a runner that already moved on. The elapsed time is the actual assertion here.
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: 'node -e "setTimeout(()=>{},60000)"' } }) })
  const t0 = Date.now()
  run(VERIFY, ["--only", "test", "--timeout", "1500"], r.dir)
  const elapsed = Date.now() - t0
  ok(elapsed < 20000, `returned promptly, took ${elapsed}ms: an orphan child is holding the pipe open`)
})


test("verify: full mode runs every workspace unit, not just the root", () => {
  // ci-integration.md makes a full run the second layer that catches packages the affected
  // mapping skipped. It only ever ran the root, so the layer reported green having tested
  // one package out of all of them.
  const r = repo({
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { test: "exit 0" } }),
    "packages/a/package.json": JSON.stringify({ name: "pkg-a", scripts: { test: "exit 0" } }),
    "packages/b/package.json": JSON.stringify({ name: "pkg-b", scripts: { test: "exit 0" } }),
  })
  const pkgs = new Set(JSON.parse(run(VERIFY, ["--dry-run", "--format", "json"], r.dir).out).results.map((x) => x.pkg))
  ok(pkgs.has("pkg-a") && pkgs.has("pkg-b"), "both packages scheduled: " + [...pkgs].join(","))
})

test("verify: a full run still works when the root has no scripts", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "pkg-a", scripts: { test: "exit 0" } }),
  })
  const pkgs = new Set(JSON.parse(run(VERIFY, ["--dry-run", "--format", "json"], r.dir).out).results.map((x) => x.pkg))
  ok(pkgs.has("pkg-a"), "package gates found without a root script")
})

test("verify: a diff with no gates reports it in every format and never stack-traces", () => {
  // The empty-plan path used to call emit() before its reporting state existed, so a
  // docs-only PR in a monorepo turned a required check red with a ReferenceError.
  for (const fmt of ["text", "json", "sarif", "github"]) {
    const r = repo({
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({ name: "pkg-a" }),
      "packages/a/f.txt": "x\n",
      "README.md": "# docs\n",
    })
    r.write("packages/a/f.txt", "y\n")
    const res = run(VERIFY, ["--changed", "--format", fmt], r.dir)
    ok(!/ReferenceError|Cannot access/.test(res.err + res.out), `${fmt}: no crash, got ${res.err.slice(0, 120)}`)
    if (fmt === "json") {
      eq(JSON.parse(res.out).note !== undefined, true, "json says the dimension is unverified")
    }
  }
})

test("verify: an unreadable --config is exit 3, not 2", () => {
  // ci-integration.md publishes an exit-code table that pipelines copy verbatim. verify uses 3
  // for configuration errors while smells uses 2, and the table must say which is which.
  const r = repo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 0" } }) })
  eq(run(VERIFY, ["--config", "/nope.json"], r.dir).code, 3, "bad config is a usage error")
})

test("verify: --config is documented as taking precedence over detection", () => {
  const r = repo({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "exit 1" } }),
    ".software-engineer.json": JSON.stringify({ verify: { gates: { test: ["node", "-e", "process.exit(0)"] } } }),
  })
  eq(run(VERIFY, ["--only", "test"], r.dir).code, 0, "repo config overrides the detected script")
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
