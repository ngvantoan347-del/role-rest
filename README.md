# software-engineer

[![skills.sh](https://img.shields.io/badge/skills.sh-directory-111111)](https://skills.sh)
[![spec](https://img.shields.io/badge/SKILL.md-agent%20skills%20format-f59e0b)](skills/software-engineer/tests/spec.mjs)
[![evals](https://img.shields.io/badge/A%2FB-4%20tasks%2C%20published%20results-111111)](eval-runs/RESULTS.md)

**An agent saying "tests pass" costs it nothing to say. Nothing in that same session can
contradict it.**

This repo makes that claim falsifiable.

```bash
./demo.sh    # builds a real repo, runs a real suite, prints what it finds. No install.
```

```
$ node skills/software-engineer/scripts/falsify.mjs

falsify  /srv/checkout-service

  baseline: suite green. Now breaking it on purpose.

  caught   swallow-error 1/3  src/checkout.js:2      a failure reported as success
  SURVIVED swallow-error 2/3  src/checkout.js:4      a failure reported as success
  SURVIVED unguard 2/3        src/checkout.js:4      a guard clause that no longer guards
  caught   unguard 1/3        src/checkout.js:2      a guard clause that no longer guards

  4 break(s) survived in 1 file(s). Those lines have no test.

    src/checkout.js
      :4     swallow-error, unguard
```

`npm test` was green. The suite cannot tell the difference between "the insufficient-balance guard
is tested" and "someone wrote it and nothing checks it", because a test that never exercises a
branch and a test that does are both green.

`falsify.mjs` deletes one throw, one guard, one comparison, one await - **one line at a time** -
and requires the suite to go red for each. A break that survives is a line nobody is testing, and
the report names the line.

Applying every mutation at once would be faster and would lie: one covered guard would stand in
for the two untested ones next to it and the file would come back clean. That is the more
flattering failure, and the more common one.

## Why this is not just Stryker

Mutation testing is 30 years old and nobody runs it. Not because it is a bad idea - because it
costs a config file, a working directory, and minutes, so it never fits between reading a diff and
answering.

| | Stryker / PITest | `falsify.mjs` |
| --- | --- | --- |
| Setup | config file, per language | none |
| Scope | the whole codebase, on demand | the diff you are reviewing |
| Time | minutes | about a second per break |
| Output | one number | the file and **line** with no test |
| Survives an agent's attention | no | it runs in the same loop as the answer |

An agent will run `npm test`. It will not run Stryker. That gap is the entire opportunity.

## What the A/B runs found

We ran the same four tasks twice: once with this skill loaded, once with nothing. Outputs are in
`eval-runs/`.

The honest result: **the skill found no bug the baseline missed.** Both arms independently found
the missing backoff, the `retries: 0` resolving `undefined`, the off-by-one counting attempts
instead of retries, the IDOR with no tenant scope. A capable model does not need to be taught
serious bugs.

What the skill added was one step: it asked whether the tests could catch the break. On one case
the with-skill run made the flag branch unreachable and watched the suite stay green, then fixed
the flag as a contract with a CI-enforced expiry. The baseline noticed the two flows were
identical, and stopped.

That step is the product. `falsify.mjs` mechanises it. `verification-techniques.md` is the rest
of the ladder.

Read `eval-runs/RESULTS.md` before adopting - including the limits: one model, one run per arm,
no comparison against a competing skill.

## Install

```bash
npx skills add ngvantoan347-del/role-rest
```

Works with **OpenCode, Claude Code, Codex, Cursor, Gemini CLI**, and anything reading the
[Agent Skills](https://agentskills.io) format.

<details>
<summary>Manual install, and OpenCode's HTTP catalog</summary>

**Per project** - copy it in and commit it, so the whole team gets it the same way:

```bash
mkdir -p .opencode/skills
cp -r role-rest/skills/software-engineer .opencode/skills/
```

**HTTP catalog** - OpenCode downloads and caches it, no clone:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["https://raw.githubusercontent.com/ngvantoan347-del/role-rest/main/skills/"]
}
```

</details>

## The three scripts

```bash
node skills/software-engineer/scripts/ci.mjs        # all three, one command
```

**`falsify.mjs`** - the one an agent will not run on its own. Breaks the changed code the way a
bug would, one line at a time, then requires the suite to go red. Reports survivors by file and
line, because that is the only version a reader can act on without going back to grep. States its
own reach, so a clean report on a file full of branches is not mistaken for a clean bill. Restores
the working tree byte for byte, and verifies it did - a falsification tool that corrupts
uncommitted work is worse than none.

**`verify.mjs`** - detects the project's real gates from its own config (`package.json`,
`Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `mvnw`, and friends) and runs them. Reads
workspace layouts so `--changed` runs affected packages, not the whole tree. A gate it cannot
find is reported `MISSING`, never as passing. `--format json|sarif|github` for CI.

**`smells.mjs`** - audits the diff for mechanical residue: debt markers, hardcoded secrets,
swallowed exceptions, disabled tests, lint suppressions, stub functions, merge conflicts, unsafe
deserialization, disabled TLS verification, shell injection, string-built SQL, non-deterministic
tests.

All three read `.software-engineer.json`, so a company centralises its own gates and rules in a
file that gets reviewed like anything else:

```json
{
  "verify": { "gates": { "test": ["npm", "run", "test:ci"] }, "ignore": ["packages/legacy-*"] },
  "smells": {
    "maxWarnings": 0,
    "rules": [
      { "id": "internal-legacy-client", "severity": "error", "pattern": "\\bv1_legacy\\b", "message": "use @internal/sdk v2" }
    ]
  }
}
```

Keeping a finding? Suppress that one rule inline, and say why. An allow with no `-- reason` is
itself reported - a suppression nobody can explain is a deleted rule.

## Beyond one repo

Most skill libraries stop at "write good code in this repo". This one goes where the work
actually goes at scale:

| Area | Covers |
| --- | --- |
| Monorepo | Affected-graph verification, shared packages as internal public APIs, blast radius of a config change |
| Distributed | At-least-once delivery and what it forces on consumers, dual-write, idempotency keys, clock skew |
| Multi-tenant | Tenant scope in every query, cache key, and log - the cross-tenant leak no scanner finds |
| Migration | Strangler fig, expand-contract, resumable backfills, API deprecation windows, code with no tests |
| Compliance | Data classification, audit trail fields, authZ as code, retention and deletion, SBOM, dependency provenance |
| Review | Reading order for a diff, the questions that find real defects, comments that get acted on |
| CI | Wiring the scripts in, and which exit code means what |

## Contents

```
demo.sh                                one command, reproduces the claim above
CONTRIBUTING.md                        the two things a first PR here gets wrong
skills/
├── index.json                          HTTP catalog manifest
└── software-engineer/
    ├── SKILL.md                        the discipline: tiers, ladder, escalation
    ├── references/                     loaded on demand, not on activation
    │   ├── verification-techniques.md  the ladder: prove-it-red, delete-and-observe, breaking
    │   ├── discovery-playbook.md       reading an unfamiliar repo, finding seams
    │   ├── enterprise-standards.md     CODEOWNERS, company rules, ADRs, branch protection
    │   ├── stack-commands.md           gates for the ecosystems verify.mjs has no detector for
    │   ├── ci-integration.md          wiring the scripts into a pipeline, exit codes
    │   ├── plan-template.md            T2/T3/T4 plan formats, plan-drift handling
    │   ├── design-guide.md             boundaries, contracts, data shapes, security
    │   ├── scale-and-architecture.md   monorepo, services, events, multi-tenant, rollout
    │   ├── migration-and-legacy.md     untested code, strangler fig, expand-contract
    │   ├── compliance-and-data.md      PII, authorization, audit trail, retention, SBOM
    │   ├── testing-guide.md            what to test, test doubles, red suites
    │   ├── anti-patterns.md            judgment smells no regex can catch
    │   ├── git-workflow.md             commits, PRs, secrets, history recovery
    │   ├── review-playbook.md          reviewing a change, self-review before handoff
    │   └── dod-checklist.md            Definition of Done + handoff template
    ├── scripts/
    │   ├── ci.mjs                      all three gates, one command
    │   ├── falsify.mjs                 break the change, require the suite to catch it
    │   ├── verify.mjs                  detect and run the project's real gates
    │   └── smells.mjs                  audit a diff for mechanical debt
    └── tests/
        ├── harness.mjs                 temp-repo fixtures and assertions
        ├── run.mjs                     runs every suite
        ├── falsify.test.mjs            9 tests, including tree restoration
        ├── verify.test.mjs             22 tests
        ├── smells.test.mjs             32 tests
        ├── ci.test.mjs                 5 tests
        ├── eval.mjs                    A/B harness against a no-skill baseline
        ├── fixture.mjs                 materialise an eval case's fixture repo
        ├── evals/evals.json            the cases and their assertions
        ├── spec.mjs                    SKILL.md vs the Agent Skills format
        └── catalog.mjs                 manifest and cross-reference integrity
```

## Developing on this repo

```bash
npm test          # 75 tests across 4 suites
npm run gate      # the skill's own gates, run on itself
npm run spec      # SKILL.md satisfies the Agent Skills format
npm run catalog   # skills/index.json matches disk, all references resolve
npm run lint      # smells.mjs scanning this repo, strict, zero-warning budget
```

`npm run spec` is not ceremony. A skill whose frontmatter is malformed is **not rejected
anywhere** - it is simply never listed, so the repo looks healthy and the person installing it
gets silence. Invisible to every other check here, which is exactly why it needs its own.

### Language

Everything committed here is in English, including the discussion inside the skill. Vietnamese is
fine in issues and pull requests; it does not belong in files that ship to users of other agents.

## Contributing

Open an issue describing a rule you want added, with the failure it prevents. Changes follow the
discipline the skill teaches: small diff, tests for the scripts, and evidence the skill still
loads and installs.

## License

MIT