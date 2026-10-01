---
name: software-engineer
description: Verification discipline for AI coding agents. Use when a change edits source files or is being reviewed - bug fixes, features, refactors, migrations, integrations - and before handing work back. Provides the escalation and verification steps a capable agent will not reach for on its own - prove-it-red, delete-and-observe, mutation testing - plus three scripts that run the project's real gates, scan the diff, and prove the tests catch the break. Covers monorepos, distributed and multi-tenant systems, data and access boundaries, legacy migration, and review, so it holds up in a large engineering organisation.
license: MIT
compatibility: opencode, claude-code, codex, cursor, gemini-cli
metadata:
  audience: engineers
  workflow: any
  category: methodology
---

# Software Engineer

A capable model already finds serious bugs - a missing backoff, `retries: 0` resolving
`undefined`, an IDOR with no scope. This skill does not teach it that. It does exactly three
other things:

1. **Three scripts** that run the project's real gates, scan the diff, and prove the tests
   catch the break - so verification is cheap enough that skipping it has no excuse.
2. **A verification ladder** - the steps an agent will not reach for on its own, with a
   measured reason why each earns its cost.
3. **The escalation boundary** - when to proceed, when to ask once, when to stop.

The rest of engineering is already in the model.

## 1. Size the work

A heavy process on a one-line typo gets skipped, and then you have lost the process and the
trust. The tier sets **both the steps and the verification budget**:

| Tier | When | Process | Stop verifying at |
| --- | --- | --- | --- |
| **T1** | typo, comment, config value, no design decision | Fix, report. No plan. | The related test. A 20-minute full suite is not required. |
| **T2** | one feature or bug following an existing pattern | 5-7 line plan, implement, report | Prove-it-red |
| **T3** | new subsystem, data model, public interface, refactor across layers, unfamiliar repo | Plan with options and risks. **Wait for approval.** | Plus targeted mutation testing |
| **T4** | user data, money, permissions, shared infrastructure, an architectural decision | T3 plus: mark **T4**, blast radius, rollback, owning team | Everything, plus a **rollback that has actually been run** |

Measure by consequence, not by diff size. One line in an auth path is T3.

The last column is not "which gates exist" - it is "which step still changes your conclusion".

## 2. Do not stand in the wrong place

| Situation | Action |
| --- | --- |
| Reversible, local, follows an existing pattern, verifiable immediately | **Just do it.** No question. |
| You can verify it yourself by reading code or running a command | **Verify it yourself.** No question. |
| Not reversible: migration, data deletion, public API change, auth, billing, permissions | **Ask once**, with options and a recommendation. |
| A design fork with genuinely different costs | **Ask once**, with a recommendation. |
| The request contradicts current behaviour | **Name the contradiction**, propose the most reasonable reading. |
| The path belongs to **another team** (CODEOWNERS) | **Ask**, even if the change is small and reversible. The team that owns a path is the team on call for it. |

A question reads: *<specific question> - I lean toward <option> because <reason>.* Not "what would
you like me to do?"

## 3. Read before writing

- The **real gate command** lives in the CI config, not the README. `verify.mjs` finds it.
- In a repo with many users: read `CODEOWNERS` before you write anything.
- Copy the nearest existing example. Do not invent a style that already exists.
- When code looks wrong, ask `git log` / `git blame`. The redundant line is usually deliberate.
- Cite claims as `path:line`. No source means it is a hypothesis, and it must be called one.

## 4. Plan

Goal, **non-goals**, files, design, risks, how to verify. No code in a plan.

Non-goals are the real cause of scope creep: nobody asked for more, they just noticed the drift.
Never present a menu without a recommendation.

Drifted from an approved plan? **Stop and say so**: which assumption broke, the evidence, the
impact. Do not quietly widen. Template: `references/plan-template.md`.

## 5. Prove it, then report it

**Evidence, or it did not happen.** Never "it works now", "looks fine", "fixed" without a command
that ran and a result you saw.

```bash
# Relative to the directory holding this SKILL.md.
node scripts/ci.mjs                       # all three gates, one command - use this
node scripts/ci.mjs --no-proof            # skip mutation testing (the slowest gate)

# or run them individually:
node scripts/verify.mjs --changed          # the project's real gates, affected packages only
node scripts/smells.mjs --changed          # mechanical debt in the diff
node scripts/proof.mjs                     # do your tests actually catch the break?
```

Why `proof.mjs` exists: a green suite does **not** prove the tests ask anything. It breaks your
code the way a bug would, then requires the suite to go red. A mutation that survives is a branch
with no test - usually the branch you just touched. This is the step measured to be one an agent
does not take on its own: read the code, find it plausible, report "looks fine".

Report the commands you ran and exactly what they printed, errors included. A gate that does not
exist is **not verified**, not a pass. A failing test means you are not done: fix the cause, do not
weaken the test.

Where to stop, and the five techniques in full: `references/verification-techniques.md`.

## 6. Boundaries

The hardest part of a system to change is not the logic inside it, but the **boundary** between
parts. Function signatures and data shapes are locked in very early.

- **One-way dependency.** Every new `import` line is an architectural claim - read them before
  committing.
- **Error is part of the contract.** Never swallow an exception.
- **Make the invalid state unrepresentable** - an enum instead of a string, non-empty instead of
  nullable.
- **Reuse before adding.** The third copy is when you abstract.
- **Do not over-engineer.** Design for the next change that is likely, not the one you imagine.

`references/design-guide.md` - beyond one process: `references/scale-and-architecture.md` -
schema and old code running side by side: `references/migration-and-legacy.md` -
data, permissions, audit: `references/compliance-and-data.md`.

## 7. What no tool catches

A script compares strings. The most dangerous failures have no string to compare, and they are
found by reading:

| Failure | Why no script sees it | How to find it |
| --- | --- | --- |
| **Abstraction at the wrong layer** | The code is correct, runs, is simply in the wrong place | Ask: when this requirement changes, who gets asked? Nobody -> wrong layer |
| **Correct logic, wrong intent** | No syntax knows what the requirement was | Re-read the requirement; for each branch ask "what does this branch serve?" |
| **Right test, wrong place** | Passes, coverage is green | `proof.mjs`, or delete the feature and run it again |
| **Breaks at scale** | Correct with ten records | Always ask about N: N+1, pagination, connections, cache, queues |
| **Breaks under concurrency** | Sequential tests all pass | What happens when two requests arrive together? Idempotency key? |
| **Breaks in production** | Dev has 8 cores, production has 2 | Timeouts, pools, limits - do they match production? |
| **Holes from intent** | A secret regex cannot see an endpoint leaking another user's data | authN + authZ at every boundary? Tenant id in every query, cache key, and log? |
| **Docs drifting from code** | Both "run" | After every change: which doc is now wrong? |

Per-domain versions: `references/anti-patterns.md`.

## 8. Bugs

Reproduce with a deterministic command -> failing test -> the root cause in one sentence -> fix
the **cause** -> verify and explain it in two sentences.

A symptom patch is not a fix until the cause is proven. Do not fix a bug you cannot reproduce -
report what you know, what you ruled out, and what you need.

## 9. Docs are part of the change

Wrong docs are more dangerous than missing docs: they make a newcomer trust something false. Update
the README, API docs, examples, `.env.example` that your change makes wrong - in that change, not
in a later ticket.

## 10. Handoff

Self-review with `references/review-playbook.md`, then run `references/dod-checklist.md`.

```text
What changed      - behaviour, not a file listing
Files             - path, grouped by purpose
Design            - the contract chosen, and why it over the alternative
Verification      - the specific commands + exactly what they printed, including surviving mutations
Not done / risks  - deferred debt, unverified areas, remaining risk
Decisions needed  - what the user must choose ("none" is a legitimate answer at T1)
```

T4: add a **Blast radius / Rollback / Owner** line. Report failures plainly - "this is broken, and
here is why" is a good outcome.

## Language

Direct and specific. Claims carry sources. Separate what is verified from what is inferred from
what is unknown. No flattery, no narration of your own process.

## Reference map

Read by situation. Each file has its own filter; reading the wrong one costs more time than
reading none.

| File | Use when |
| --- | --- |
| `references/verification-techniques.md` | **After the fix** - the next verification step, and where to stop |
| `references/discovery-playbook.md` | Unfamiliar repo: discovery order, finding seams, evidence table |
| `references/enterprise-standards.md` | Repo with many users: CODEOWNERS, company rules, ADRs, branch protection |
| `references/ci-integration.md` | Wiring the scripts into a pipeline, exit codes, shared repo config |
| `references/plan-template.md` | T2/T3/T4 plans, handling plan drift |
| `references/design-guide.md` | Boundaries, contracts, data shapes, security |
| `references/scale-and-architecture.md` | Monorepo, services, events, multi-tenant, concurrency, rollout |
| `references/migration-and-legacy.md` | Untested code, strangler fig, expand-contract, API versioning |
| `references/compliance-and-data.md` | PII, authorization, audit trail, retention, SBOM, provenance |
| `references/testing-guide.md` | What to test, test doubles, a red suite |
| `references/anti-patterns.md` | Smells needing judgement - what a regex cannot catch |
| `references/git-workflow.md` | Commits, branches, PRs, secrets, history recovery |
| `references/review-playbook.md` | Reviewing someone else's change, and self-review before handoff |
| `references/dod-checklist.md` | Definition of Done + the handoff template |
| `references/stack-commands.md` | Gate commands per ecosystem, when `verify.mjs` finds none |