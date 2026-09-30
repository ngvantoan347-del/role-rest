# Plan Templates

The plan is a contract with the user, not a rehearsal. It states what will change, what
will not, how it will be proven, and what could go wrong. It contains no code.

## T2 - standard task (inline, 5-7 lines)

```text
Plan
- Goal: <observable behavior change, one sentence>
- Approach: <2-3 sentences on the design and where it lives>
- Files: <paths you expect to touch>
- Verify: <exact commands and the expected result>
- Risk: <the one thing most likely to surprise us>
```

Proceed after presenting it unless the task touches a risky path. Do not wait for
ceremonial approval on a small, well-understood change.

## T3 - deep task (structured, then stop for approval)

```markdown
## Problem
<What is actually wrong or missing, in the user's terms, with evidence: file:line, logs, docs.>

## Goal
<One sentence. The world after this change.>

## Non-goals
<Explicitly out of scope, so it stays out of scope.>

## Current state
<How the system works today: entry point, the module that owns this behavior, the
existing pattern, what the tests currently assert.>

## Options
| # | Option | How | Cost | Risk |
|---|--------|-----|------|------|
| 1 | <name> | <mechanism> | <effort, blast radius> | <what could break> |
| 2 | <name> | <mechanism> | <effort, blast radius> | <what could break> |

Recommend: <option> because <reason tied to the goal and the constraints>.

## Design
<Interfaces and contracts: signatures, data shapes, error cases, config surface.
Dependency direction: who may call what.>

## Data and migrations
<Schema changes, backfill, backward compatibility window, rollback plan.>

## Implementation steps
1. <step that is independently verifiable>
2. <step>
3. <step>

## Verification
- <command> -> <expected result>
- <command> -> <expected result>
- <manual/observable check> -> <expected result>

## Risks and mitigations
- <risk> -> <mitigation>

## Open questions
- <question the user must answer before or during step N>
```

## Plan quality bar

A plan is ready when each of these is true:

- **Verifiable goal.** Someone else can tell whether it was achieved without asking you.
- **Explicit non-goals.** The most common cause of scope creep is an unstated boundary.
- **Named files.** Not "update the backend" but `src/auth/session.ts`, `src/api/routes/auth.ts`.
- **Design, not vibes.** The contract is written down: input, output, failure, ownership.
- **Real verification.** Commands that exist in this project, with the result you expect.
- **Honest risks.** Name the thing you are least sure about. A plan with no risks is
  incomplete, not excellent.
- **No dead alternatives.** Present options, then commit to one with a reason. Do not
  hand the user a menu with no recommendation.

## Plan drift

Reality changes the plan. When it happens:

1. Stop. Do not continue on the old plan while the new assumption loads.
2. State what changed: the assumption, the evidence, and the impact on scope and risk.
3. Present the delta, not a full rewrite of the plan.
4. For T3, wait for re-approval. For T2, state the delta and continue.

```text
Plan update: <what changed>
Impact: <files, risk, timeline>
Revised step N: <old> -> <new>
Continuing unless you say stop.
```

Silent drift is the failure mode this section exists to prevent.
