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

1. **Three scripts** that run the project's real gates, scan the diff, and prove the tests catch
   the break. Verification becomes cheap enough that skipping it has no excuse.
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
| **T3** | new subsystem, data model, public interface, refactor across layers, unfamiliar repo | Plan with options and risks. Wait for approval. | Falsify the change |
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
node scripts/falsify.mjs --list            # which breaks apply, run nothing
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

Whatever the medium, the same three checks apply, and they apply to the artefact rather than the
code behind it. This is not a style note; generated output that reads as generated gets the whole
thing discounted, including the part that is correct.

**Structure.** Information architecture is a decision, not an accident. A flat list of sections
numbered 1 to 10 tells the reader they are a sequence, so if sections 6 and 8 are reference
material they have been mislabelled as steps. Ask whether the order means anything, and if it does
not, stop numbering. Depth should follow importance; a section three times the length of its
neighbours usually means the others were left thin, not that this one earned it. And a directory
listing is not a map - group by where the reader is, so the file they need is findable without
already knowing its name.

**Surface.** Long uniform tables, four grey bands and a centred logo read as a template because they
are one. Real tools have rhythm: some dense, some open, one thing loud and the rest quiet. Where
colour or type carries meaning, it means the same thing everywhere.

**Content.** Numbers beat adjectives. "Faster" is a claim; "1.2s to 400ms" is a measurement.
Placeholder copy reads as unfinished because it is unfinished, so write the real string. Empty
states, error text and the second sentence of any error message are the copy almost nobody reviews
and every user reads.

Domain is irrelevant to all of this. It applies unchanged to a settings screen, a Terraform module,
a SQL migration, or a CLI help text - the difference between competent and generated is the same in
each.

## Handoff

Self-review with `references/review-playbook.md`, then run `references/dod-checklist.md`.

```text
What changed      - behaviour, not a file listing
Files             - path, grouped by purpose
Design            - the contract chosen, and why it over the alternative
Verification      - commands + exactly what they printed, with surviving breaks and the reach line
Not done / risks  - deferred debt, unverified areas, remaining risk
Decisions needed  - what the user must choose ("none" is legitimate at T1)
```

T4 adds a blast radius, rollback, and owner line. Reporting a failure plainly is a good outcome.

## Writing so it reads as human

Register: direct and specific, claims carry sources, what is verified stays separate from what is
inferred and from what is unknown. No flattery, no narration of your own process.

This is about texture rather than content, and it applies to code, comments, docs, commit messages
and UI copy alike - a web page, an infra module, a pipeline, a dashboard. The failure is not being
wrong, it is being recognisable, and a reader who can tell the output was generated stops trusting
the parts that are actually right.

| Tell | Instead |
| --- | --- |
| Every file opens with an aphorism | Open with the thing to do, or nothing |
| Bold on ordinary words (`every`, `not`) | Bold a defined term, or the one takeaway |
| "Why this exists" before the content | State the consequence, then move on |
| Three-item lists everywhere | Two, or five, or a real number |
| Punchline endings | Stop at the last useful sentence |
| "not X, but Y" as a rhythm | Use the second half on its own |
| Identical structure across every file | Match the material, not the template |

Two habits do most of the work. Cut the paragraph before the point - abstraction in front of
content is padding, and it is the strongest single signal of generated text. And vary the shape:
if four sections are all a definition, a list and a table, the reader stops seeing structure and
starts seeing a template. Real material has sections that are two paragraphs and no list at all.

The same applies to code. A comment explaining why earns its place; one restating the line below is
noise. Names from the domain beat names from a pattern. If the honest implementation is smaller than
the tidy one, ship the smaller one and say what you left out.

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