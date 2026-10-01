# software-engineer

An engineering discipline skill for AI coding agents. It stops the most predictable failure
mode of AI-assisted development: the diff looks fine, the demo works, and the repo quietly
fills with `quick fix`, `temp`, `add later`, and `idk but it works`.

Works with **OpenCode, Claude Code, Codex, Cursor, Gemini CLI**, and anything else that reads
the [Agent Skills](https://agentskills.io) format.

## Install

```bash
npx skills add ngvantoan347-del/role-rest
```

That is the whole install. The CLI detects your agent and writes the skill where it looks for
it. To install for one agent only:

```bash
npx skills add ngvantoan347-del/role-rest --agent opencode
```

<details>
<summary>Manual install, and OpenCode's HTTP catalog</summary>

**Per project** - copy it in and commit it, so the whole team gets it the same way:

```bash
mkdir -p .opencode/skills
cp -r role-rest/skills/software-engineer .opencode/skills/
```

**HTTP catalog** - OpenCode downloads and caches it, no clone. `skills/index.json` is the
manifest; every entry resolves as `<base-url>/<skill-name>/<file>`:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["https://raw.githubusercontent.com/ngvantoan347-del/role-rest/main/skills/"]
}
```

</details>

## What it does

Sizes the work first, so it never slows down a one-line fix:

| Tier | Applies to | Process |
| --- | --- | --- |
| T1 trivial | typo, config value, one-line fix | Edit, run one check, report |
| T2 standard | one feature or bug following existing patterns | Short plan, implement, verify |
| T3 deep | new subsystem, data model, public interface | Full plan with options and risks, **waits for approval** |
| T4 org-wide | user data, money, permissions, shared infra, architectural decision | T3 plus blast radius, rollback, and owning team |

Every rule carries its reasoning, because a rule without a reason is one the model asks about
or routes around when the task gets hard. The load-bearing ones:

- **Evidence or it did not happen.** No "it should work now" - the handoff names the commands
  that ran and what they printed. Consequence-based, not threshold-based: a one-line change to
  auth is T3.
- **Don't stand in the wrong place.** A table for when to proceed silently, when to verify
  yourself, and when to ask once. Guessing wrong and asking constantly cost more than the
  process saves.
- **No deferred debt.** A `TODO` left in the tree needs an owner and a tracked issue.
- **No placeholders in shipped paths.** `return null`, empty bodies, fake data.
- **No unverified bugs.** Reproduce, failing test, root cause, fix the cause, explain it.
- **No silent scope changes.** If reality diverges from the plan, it stops and says so.
- **No secrets, ever.** Not in code, not in logs, not in commits.
- **Blast radius is part of the answer.** T4 work names who else runs it, how to roll it back,
  and which team owns it - not just what changed.

## Beyond one repo

Most skill libraries stop at "write good code in this repo". This one goes where the work
actually goes at scale:

| Area | What it covers |
| --- | --- |
| Monorepo | Affected-graph verification, shared packages as internal public APIs, blast radius of a config change |
| Distributed | At-least-once delivery and what it forces on consumers, dual-write, idempotency keys, clock skew, distributed correctness |
| Multi-tenant | Tenant scope in every query, cache key, and log - the cross-tenant leak no scanner finds |
| Migration | Strangler fig, expand-contract, resumable backfills, API deprecation windows, code with no tests |
| Compliance | Data classification, audit trail fields, authZ as code, retention and deletion, SBOM, dependency provenance |
| Review | Reading order for a diff, the questions that find real defects, comments that get acted on |
| CI | Wiring the scripts into a pipeline, and which exit code means what |

## Scripts

Two dependency-free Node scripts ship with the skill. The agent runs them, and so can you.

```bash
# discover this project's real typecheck / lint / test / build commands and run them
node skills/software-engineer/scripts/verify.mjs

# monorepo: run only the gates of the packages your diff touches
node skills/software-engineer/scripts/verify.mjs --changed --jobs 4

# scan the diff for the mechanical residue of vibe coding
node skills/software-engineer/scripts/smells.mjs --changed --base origin/main
```

**`verify.mjs`** detects the project's real gates from its own config - `package.json`,
`Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `mvnw`, and friends - then runs them. A
gate it cannot find is reported `MISSING`, never as passing, so a repo with no linter is never
mistaken for a clean one. Exit `2` means it found nothing to run, which is not a pass.

It reads workspace layouts (`workspaces`, `pnpm-workspace.yaml`, Cargo members, `go.work`,
`lerna.json`) so `--changed` runs affected packages instead of the whole tree, and emits
`--format json|sarif|github` for CI.

**`smells.mjs`** audits a diff for mechanical residue: debt markers, hardcoded secrets,
swallowed exceptions, disabled tests, type and lint suppressions, stub functions, commented-out
code, unresolved merge conflicts, unsafe deserialization, disabled TLS verification, shell
injection, string-built SQL, and non-deterministic tests.

Both read `.software-engineer.json` at the repo root, so a company centralises its own gates
and rules in a file that gets reviewed like anything else:

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

When a finding is real and you are keeping it anyway, suppress that one rule inline and say
why. An allow with no `-- reason` is itself reported, because a suppression nobody can explain
is a deleted rule:

```ts
const key = process.env.API_KEY // smells:allow env-default-secret -- platform team owns this, PLAT-4821
```

**The scripts are a safety net, not the review.** A regex compares strings. It cannot know
what the requirement was, which module owns a behavior, or what breaks at ten thousand
records. Both print a reminder saying so on every run. The failures that actually cause
incidents - wrong abstraction, correct code doing the wrong thing, breakage under concurrency,
holes that come from intent - are found by reading.

## Contents

```
skills/
├── index.json                          HTTP catalog manifest
└── software-engineer/
    ├── SKILL.md                        the discipline: tiers, loop, non-negotiables
    ├── references/                     loaded on demand, not on activation
    │   ├── discovery-playbook.md       reading an unfamiliar repo, finding seams
    │   ├── enterprise-standards.md     CODEOWNERS, company rules, ADRs, branch protection
    │   ├── stack-commands.md           real gates per ecosystem
    │   ├── ci-integration.md          wiring the scripts into a pipeline, exit codes
    │   ├── plan-template.md            T2/T3/T4 plan formats, plan-drift handling
    │   ├── design-guide.md             boundaries, contracts, data, migrations, security
    │   ├── scale-and-architecture.md   monorepo, services, events, multi-tenant, rollout
    │   ├── migration-and-legacy.md     untested code, strangler fig, expand-contract
    │   ├── compliance-and-data.md      PII, authorization, audit trail, retention, SBOM
    │   ├── testing-guide.md            what to test, test doubles, red suites
    │   ├── anti-patterns.md            judgment smells no regex can catch
    │   ├── git-workflow.md             commits, PRs, secrets, history recovery
    │   ├── review-playbook.md          reviewing a change, self-review before handoff
    │   └── dod-checklist.md            Definition of Done + handoff template
    ├── scripts/
    │   ├── verify.mjs                  detect and run the project's real gates
    │   └── smells.mjs                  audit a diff for mechanical debt
    └── tests/
        ├── harness.mjs                 temp-repo fixtures and assertions
        ├── verify.test.mjs             17 tests for verify.mjs
        ├── smells.test.mjs             23 tests for smells.mjs
        ├── run.mjs                     runs every suite
        ├── spec.mjs                    SKILL.md vs the Agent Skills format
        └── catalog.mjs                 manifest and cross-reference integrity
```

## Developing on this repo

```bash
npm test          # 40 tests across both scripts
npm run spec      # SKILL.md satisfies the Agent Skills format
npm run catalog   # skills/index.json matches disk, all references resolve
npm run lint      # smells.mjs scanning this repo, strict, zero-warning budget
```

`npm run spec` is not ceremony. A skill whose frontmatter is malformed is **not rejected
anywhere** - it is simply never listed, so the repo looks healthy and the person installing it
gets silence. That failure is invisible to every other check in this file, which is exactly
why it needs its own.

## Contributing

Open an issue describing a rule you want added, with the failure it prevents. Changes follow
the discipline the skill teaches: small diff, tests for the scripts, and evidence the skill
still loads and installs.

## License

MIT