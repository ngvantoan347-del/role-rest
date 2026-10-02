---
name: software-engineer
description: Verification discipline for AI coding agents. Use when a change edits source files or is being reviewed - bug fixes, features, refactors, migrations, integrations - and before handing work back. Provides the escalation and verification steps a capable agent will not reach for on its own - prove-it-red, delete-and-observe, falsification - plus three scripts that run the project's real gates, scan the diff, and make "tests pass" falsifiable. Covers monorepos, distributed and multi-tenant systems, data and access boundaries, legacy migration, and review, so it holds up in a large engineering organisation.
license: MIT
compatibility: opencode, claude-code, codex, cursor, gemini-cli
metadata:
  audience: engineers
  workflow: any
  category: methodology
---

# Software Engineer

A capable model already finds serious bugs - a missing backoff, `retries: 0` resolving
`undefined`, an IDOR with no scope. This skill does not teach it that. It does three other
things:

1. **Four scripts** that run the project's real gates, scan the diff, find the callers nobody
   looked at, and prove the tests catch the break. Verification becomes cheap enough that skipping
   it has no excuse.
2. **A verification ladder** - the steps an agent will not reach for on its own, each with the
   reason it earns its cost.
3. **An escalation boundary** - when to proceed, when to ask once, when to stop.

The rest of engineering is already in the model.

The sections below run in the order given, through to *Prove it*. *Judgement* is not a sequence;
read it when the situation calls for it.

## Size the work

A heavy process on a one-line typo gets skipped, and then you have lost the process and the trust.
The tier sets both the steps and the verification budget.

| Tier | When | Process | Last useful check |
| --- | --- | --- | --- |
| **T1** | typo, comment, config value, no design decision | Fix, report. No plan. | The related test. A 20-minute full suite is not required. |
| **T2** | one feature or bug following an existing pattern | Short plan, implement, report | Prove-it-red |
| **T3** | new subsystem, data model, public interface, refactor across layers, unfamiliar repo | Plan with options and risks. Wait for approval. | Falsify the change, check the reach |
| **T4** | user data, money, permissions, shared infrastructure, an architectural decision | T3 plus: blast radius, rollback, owning team | Everything, plus a rollback that has actually been run |

Measure by consequence, not diff size. One line in an auth path is T3.

The last column is not "which gates exist". It is "which check would still change your
conclusion".

## When to stop and ask

| Situation | Action |
| --- | --- |
| Reversible, local, follows an existing pattern, verifiable immediately | Just do it. No question. |
| You can verify it yourself by reading code or running a command | Verify it yourself. No question. |
| Not reversible: migration, data deletion, public API change, auth, billing, permissions | Ask once, with options and a recommendation. |
| A design fork with genuinely different costs | Ask once, with a recommendation. |
| The request contradicts current behaviour | Name the contradiction, propose the most reasonable reading. |
| The path belongs to another team, per CODEOWNERS | Ask, even if the change is small and reversible. |

A question reads: *<specific question> - I lean toward <option> because <reason>.* Not "what
would you like me to do?"

## Before you write

- The real gate command lives in the CI config, not the README. `verify.mjs` finds it.
- Before changing a function, `reach.mjs --file <path>` says who calls it. Do this first: it decides
  how much is at stake, and it is the one fact a diff cannot give you.
- In a repo with many users, read `CODEOWNERS` before you write anything.
- Copy the nearest existing example. Do not invent a style that already exists.
- When code looks wrong, ask `git log` and `git blame`. The redundant line is usually deliberate.
- Cite claims as `path:line`. No source means it is a hypothesis, and it must be called one.

**Plan** (T2 and up): goal, non-goals, files, design, risks, how to verify. No code in a plan.

Non-goals are the real cause of scope creep - nobody asked for more, they noticed the drift. Never
present a menu without a recommendation. If you have drifted from an approved plan, stop and say
which assumption broke, what the evidence is, and what it changes. Do not quietly widen.
Template: `references/plan-template.md`.

## Prove it

"Tests pass" costs an agent nothing to say, and nothing in that same session can contradict it.
`falsify.mjs` is the counter-check: it breaks your code the way a bug would and requires the suite
to go red.

```bash
# Relative to the directory holding this SKILL.md.
node scripts/ci.mjs                       # all three gates, one command - use this
node scripts/ci.mjs --no-falsify          # skip the falsification pass (the slowest gate)

# or run them individually:
node scripts/falsify.mjs                   # break the change, require the suite to catch it
node scripts/reach.mjs                     # who calls what you touched, and who tested them
node scripts/verify.mjs --changed          # the project's real gates, affected packages only
node scripts/smells.mjs --changed          # mechanical debt in the diff
```

**What a break is.** Removing a throw, dropping a guard, inverting a comparison, zeroing a
threshold. Each one is a failure a real bug produces. Zero config, scoped to the diff, about a
second per break, so it fits the loop between reading a diff and answering.

It mutates one site at a time on purpose: mutating every guard in a file at once lets one tested
guard stand in for the untested ones beside it. A break that would stop the file parsing is
dropped, since a suite that cannot load the file proves nothing about any branch.

**Reading the output.** Two lines decide what you may claim:

- `src/checkout.js:4  swallow-error, unguard` - a survivor, reported by line. Quote it that way.
- `reach: 6 break(s) from 7 decision point(s)` - the bound on the claim. If a decision point could
  not be attacked, a clean run there is *nothing found*, not *nothing wrong*. Calling a low-reach
  pass "verified" is the same error as calling a green suite verified.

**Then check the reach.** Every script above looks at the diff. That is the blind spot: a function
you changed is called from 43 places and the other 42 did not change, so nothing in the diff mentions
them and reading the diff cannot find them.

```bash
node scripts/reach.mjs          # per changed symbol: call sites, packages spanned, which are untested
node scripts/reach.mjs --all    # include the callers tests do reach, for context
```

It prints `packages/api/routes.js:2  not in the diff, not reachable from a test`. That line is the
whole reason to run it, and an agent asked to count call sites will produce a confident number from
the handful of files it happened to read. Coverage there is module-level, not per-caller, and the
tool says so rather than implying more.

**Then report.** The commands you ran and exactly what they printed, errors included. A gate that
does not exist is not verified, not a pass. A failing test means you are not done: fix the cause,
do not weaken the test. If falsify exits 1 because it had nothing to check, say that too -
"nothing was verified" is the finding.

The full ladder, and where to stop: `references/verification-techniques.md`.

## Judgement

Not a sequence. Read the part that matches the change.

**Boundaries.** The expensive-to-change part of a system is not the logic inside it, it is the
boundary between parts; signatures and data shapes lock in early. Every new `import` line is an
architectural claim. Error is part of the contract, so never swallow an exception. Make the invalid
state unrepresentable. Reuse before adding, and the third copy is when you abstract. Design for the
next likely change, not the one you imagine. `references/design-guide.md`.

**Failures with no string to compare.** A script compares strings; these do not have one, and they
are found by reading.

| Failure | Why no script sees it | How to find it |
| --- | --- | --- |
| Abstraction at the wrong layer | Correct, runs, wrong place | When this requirement changes, who is asked? Nobody means wrong layer |
| Correct logic, wrong intent | No syntax knows the requirement | Re-read it; for each branch ask what it serves |
| Right test, wrong place | Passes, coverage green | `falsify.mjs`, or delete the feature and run it again |
| Breaks at scale | Correct with ten records | Ask about N: N+1, pagination, connections, cache, queues |
| Breaks under concurrency | Sequential tests pass | Two requests arriving together - is there an idempotency key? |
| Breaks in production | Dev has 8 cores, production has 2 | Timeouts, pools, limits - do they match production? |
| Holes from intent | A regex cannot see one endpoint leaking another's data | authN and authZ at every boundary? Tenant id in every query, cache key, and log? |

Per-domain versions: `references/anti-patterns.md`.

**Bugs.** Reproduce with a deterministic command, write the failing test, state the root cause in
one sentence, fix the cause, then verify and explain it in two sentences. A symptom patch is not a
fix until the cause is proven. Do not fix a bug you cannot reproduce - report what you know, what you
ruled out, and what you need.

**Docs.** Wrong docs are worse than missing docs, because they make a newcomer trust something
false. Update whatever your change made wrong in the same change: README, API docs, examples,
`.env.example`. Not in a later ticket.

## Ship it

Applies to the artefact, not the code behind it - a settings screen, a Terraform module, a SQL
migration, CLI help text. Generated output that reads as generated gets discounted entirely,
including the part that is correct.

- A flat list of numbered sections claims to be a sequence. If some are reference material, they are
  mislabelled as steps. Number only what is actually ordered.
- A directory listing is not a map. Group by where the reader is, so the right entry is findable
  without knowing its name.
- Depth should follow importance. One section three times its neighbours' length usually means the
  others were left thin.
- Rhythm: uniform tables and identical shapes read as a template because they are one. Some parts
  dense, some open, one thing loud.
- Numbers beat adjectives. "Faster" is a claim; "1.2s to 400ms" is a measurement.
- Write the real string. Placeholder copy reads as unfinished because it is unfinished.
- Error text and empty states are copy nobody reviews and every user reads.

## Handoff

Self-review with `references/review-playbook.md`, then run `references/dod-checklist.md`.

```text
What changed      - behaviour, not a file listing
Files             - path, grouped by purpose
Design            - the contract chosen, and why it over the alternative
Verification      - commands + what they printed, with surviving breaks, the reach line, and
                     which callers you did not open
Not done / risks  - deferred debt, unverified areas, remaining risk
Decisions needed  - what the user must choose ("none" is legitimate at T1)
```

T4 adds a blast radius, rollback, and owner line. Reporting a failure plainly is a good outcome.

## Writing so it reads as human

Register: direct and specific, claims carry sources, what is verified stays separate from what is
inferred and from what is unknown. No flattery, no narration of your own process.

Texture is a separate problem, and it applies to code, comments, docs, commit messages and UI copy
alike. The failure is not being wrong, it is being recognisable - and a reader who can tell output
was generated stops trusting the parts that are actually right.

| Tell | Instead |
| --- | --- |
| Every file opens with an aphorism | Open with the thing to do, or nothing |
| Bold on ordinary words (`every`, `not`) | Bold a defined term, or the one takeaway |
| "Why this exists" before the content | State the consequence, then move on |
| Three-item lists everywhere | Two, or five, or a real number |
| Punchline endings | Stop at the last useful sentence |
| "not X, but Y" as a rhythm | Use the second half on its own |
| Identical structure across every file | Match the material, not the template |

Cut the paragraph before the point. Abstraction in front of content is padding, and it is the
strongest single signal of generated text.

Same for code: a comment explaining why earns its place, one restating the line below is noise. Names
from the domain beat names from a pattern. If the honest implementation is smaller than the tidy one,
ship the smaller one and say what you left out.

## Reference map

Grouped by where you are, because "use when" only helps if you already know the situation. All
paths are under `references/`.

**Starting** - `discovery-playbook.md` (reading an unfamiliar repo, finding seams) -
`enterprise-standards.md` (CODEOWNERS, company rules, ADRs) - `plan-template.md` (T2/T3/T4 formats,
plan drift).

**Implementing** - `design-guide.md` (boundaries, contracts, data shapes, security) -
`git-workflow.md` (commits, branches, secrets, history recovery) - `stack-commands.md` (gate
commands per ecosystem, when `verify.mjs` finds none).

**Proving and handing over** - `verification-techniques.md` (the ladder, and where to stop) -
`testing-guide.md` (what to test, doubles, a red suite) - `ci-integration.md` (wiring, exit codes) -
`dod-checklist.md` (Definition of Done, handoff template).

**Reviewing** - `review-playbook.md` (reading someone else's change, reading texture, self-review).

**At scale, or by domain** - `scale-and-architecture.md` (monorepo, events, multi-tenant, rollout) -
`migration-and-legacy.md` (untested code, strangler fig, expand-contract) -
`compliance-and-data.md` (PII, authorization, audit, retention, SBOM) - `anti-patterns.md` (smells
needing judgement).