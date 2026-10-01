# CI Integration

The scripts that ship with this skill are built to run **in a company's CI**, not only on a
developer's machine. This page is the seam: how to wire them in, how to read the exit codes,
and the places it is easy to wire them wrong.

Why this file exists: a script that works on a laptop but breaks in CI is worse than no script,
because it turns a gate into a false pass. The most common reasons are reading `MISSING` as
`PASS`, and copying a command without running it on the same image.

Filter: only what concerns these three scripts. How to organise a pipeline, branch protection,
and release trains are in `references/enterprise-standards.md`.

## Exit codes are the contract

Read this table correctly. Mapping `2` to `success` means you have invented a gate that does not
exist.

The two scripts disagree, and this table is **measured**, not inferred:

| Script | Code | Means | In CI |
| --- | --- | --- | --- |
| both | `0` | Within budget | Green |
| `verify` | `1` | A gate failed | Red - the point |
| `smells` | `1` | Errors, **or** over `--max-warnings` | Red |
| `verify` | `2` | No gate could be detected to run | Red. This is not a pass |
| `smells` | `2` | Bad flag, broken config, invalid rule pattern | Red - a configuration error |
| `verify` | `3` | Bad `--format`, or unreadable `--config` | Red - a configuration error |

The last two rows are the easy ones to get wrong: `verify` uses `3` for **both** kinds of
configuration error, while `smells` uses `2`. A pipeline that treats the two as one script and maps
a single code for both will fail silently in one of the two branches.

The easiest mistake: reading `verify`'s `2` as "the repo has nothing to run". A repo with no linter
is someone's decision; a repo where the script **cannot find** a linter is a configuration error.
Do not conflate them, and do not let CI treat `2` as green.

## Three places to wire it in

| Where | Command | Why there |
| --- | --- | --- |
| Pre-commit | `smells.mjs --staged` | Cheap, runs in milliseconds, blocks secrets and disabled tests before they enter history |
| Required check per PR | `ci.mjs --no-proof` | This is the definition of "done" people are actually blocked by |
| Nightly / main | `verify.mjs` (no `--changed`) | Runs the root **and every workspace unit**, catching packages the affected map skipped |

`ci.mjs` runs `verify --changed`, `smells --changed`, then `proof`. Drop `--no-proof` on a PR to
get mutation testing - the slowest gate, and the only one that catches an untested branch.

### Mutation testing in CI

`proof.mjs` rewrites files and restores them, so it must **not** run alongside another job on the
same checkout, and must not run on `pull_request_target` (a fork can edit your workflow). Give it
its own job:

```yaml
proof:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: npm ci
    - run: node .opencode/skills/software-engineer/scripts/proof.mjs
```

That job re-runs the suite N times, once per mutation, so it is slow. Keep it as a required check
if the team can afford it; otherwise run it nightly and report the result - but **do not report a
pass** if it has never run.

The "Why" column matters more than intuition: `--changed` on a PR and a full run on main are two
different layers. With only `--changed`, a bug in the package mapping lives forever; with only the
full run, nobody runs it because it is too slow. You need both.

## GitHub Actions

```yaml
- name: Gate
  run: |
    node .opencode/skills/software-engineer/scripts/verify.mjs --changed --format github
    node .opencode/skills/software-engineer/scripts/smells.mjs --changed \
      --base origin/${{ github.base_ref }} --max-warnings 20 --format github
```

`--format github` prints workflow commands (`::error file=...,line=...`), so findings appear in
the **Checks** tab on the right line.

`--base` is optional: without it the script auto-detects a `merge-base` against `origin/main`,
`origin/master`, `main`, `master`. It is only needed when the repo has none of those branches -
and the cause is almost always a **shallow checkout**, see condition 3 below.

With code scanning on, `smells.mjs --format sarif` emits SARIF 2.1.0 to upload. `verify.mjs
--format sarif` does too, so a missing gate shows up as a warning instead of silence.

```yaml
- run: node .../smells.mjs --changed --format sarif > smells.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: smells.sarif }
```

## GitLab CI

```yaml
gate:
  script:
    - node .opencode/skills/software-engineer/scripts/verify.mjs --changed
    # --json goes to stdout, so redirect it: the script never writes a file on its own, and an
    # artifacts path pointing at a file nobody created fails every job that tries to upload it.
    - node .opencode/skills/software-engineer/scripts/smells.mjs --changed --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --format json > smells.json
  artifacts:
    when: always
    paths: [smells.json]
    expire_in: 1 week
```

Switch `--format json` to `sarif` if your GitLab has code quality enabled. The artifact keeps the
result for debugging a pipeline that has already been deleted.

## Three conditions for a correct result

These three are the cause of every "the script was green and it should not have been".

1. **The same image as the pipeline.** Node here must be node there. A different version is a
   different toolchain and a different result, and you will debug the wrong thing.
2. **Toolchain installed, or deliberately not.** The scripts install nothing. In a clean
   container `cargo` or `go` may be absent; that is a setup failure, not a verify result. Install
   dependencies in an earlier step, and if you skip one on purpose report it `MISSING` rather
   than pretending it passed.
3. **Enough `fetch` depth.** `verify.mjs --changed` needs `origin/main` to compute a diff.
   GitHub Actions' default checkout is shallow at one commit, so `merge-base` has nothing to
   compare against - the script falls back to "no base" and reports scanning zero files. Fix with
   `fetch-depth: 0`.

Condition 3 is the quietest one: the script runs, exits 0, and scans nothing. If your pipeline uses
a shallow checkout, verify it **once** by deliberately breaking a file in a PR and checking that
the script notices.

## Shared repo config

Commit `.software-engineer.json` at the root; one file for all three scripts:

```json
{
  "verify": {
    "gates": { "test": ["npm", "run", "test:ci"] },
    "ignore": ["packages/legacy-*"],
    "timeout": 900000
  },
  "smells": {
    "ignore": ["packages/legacy-*/**"],
    "maxWarnings": 0,
    "rules": [
      {
        "id": "internal-legacy-client",
        "severity": "error",
        "pattern": "\\bv1_legacy_client\\b",
        "message": "the legacy client is decommissioned; use @internal/sdk v2"
      }
    ]
  }
}
```

Why company rules live in this file rather than in a fork of `smells.mjs`: that rule is your
policy, it changes with policy, and it deserves review like any other change. Forking the script is
a reliable way to guarantee it has drifted from the policy two sprints later.

`disable` and `severity` are for when the company already has a linter doing that work: `disable`
removes the rule entirely, `severity` drops it to `warn` so it stays visible without blocking.

### Every config key

Most flags have a config equivalent, and the config wins when a repo has both. This table exists so
you do not have to read the code to learn a name:

| Flag | Key | Default |
| --- | --- | --- |
| `--only <gate>` (repeatable) | - | all gates |
| `--jobs <n>` | - | `1` |
| `--timeout <ms>` | `verify.timeout` | unlimited |
| `--base <ref>` | - | auto-detected merge-base |
| `--format` | - | `text` |
| `--config <path>` | - | `.software-engineer.json` at the root |
| - | `verify.gates.<gate>` | auto-detected; set `null` to disable |
| - | `verify.ignore[]` | glob of directories to skip |
| - | `verify.failFast` | `false` |
| `--max-lines` | `smells.maxLines` | `500` |
| `--max-func-lines` | `smells.maxFuncLines` | `80` |
| `--long-line` | `smells.longLine` | `160` |
| `--max-warnings` | `smells.maxWarnings` | unlimited |
| `--ignore <glob>` | `smells.ignore[]` | empty |
| `--strict` | - | off; adds `any`, non-null assertions, long lines |
| - | `smells.disable[]` | rule ids to turn off |
| - | `smells.severity.<id>` | `error` or `warn` |

Repo-supplied rules in `smells.rules[]` take three more fields: `not` (an exemption regex),
`test: true` (only in test files), and `config: true` (also in config files - by default only
secret rules run there).

## Pre-commit hook

```bash
#!/usr/bin/env sh
node .opencode/skills/software-engineer/scripts/smells.mjs --staged --max-warnings 999 || exit 1
```

`--max-warnings 999` in the hook is deliberate: block errors immediately but let warnings through,
because the hook runs on every commit and a single warning is enough to make a whole team ignore
it. The real budget belongs in CI. Do not use `--no-verify` to skip it - that is written into the
skill's own non-negotiables.

## When the scripts do not fit your repo

If a script cannot find your gates, **configure it** with `gates` in the config, or leave it and
run the pipeline's real command by hand. Do not write `|| true` to make it green: that is the
fastest way to turn a gate into decoration, and decoration outlives every engineering ticket you
will ever open.

## Questions to ask before trusting CI

- If I throw away all of my changes, is the script still green? If so, it is not guarding
  anything.
- Have I seen it go red, or only green? A gate that has never failed is an unverified gate.
- Does the file count it reports match the diff? A mismatch means the scope is wrong.