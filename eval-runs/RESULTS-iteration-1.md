# Eval results — iteration 1

Five tasks, run twice each: once with the skill loaded, once with no skill. One model, one run
per arm. Outputs are committed under `iteration-1/<case>/<arm>/output.md`.

## What these runs actually measured

Less than intended, and the reason is worth more than the numbers.

Two of the five prompts referenced files that did not exist in this repository (`src/parser.js`,
an invoices table). Both baselines caught it:

> `src/parser.js` doesn't exist in this repository. ... The only trace of `src/parser.js` on
> disk is the eval fixture quoting this exact prompt.

That is correct behaviour, and it is also **a measurement of nothing**. The task reduced to
"notice the prompt references a non-existent file", which both arms did equally well. The skill's
actual claims were never under test.

`evals.json` has been rewritten with `fixture` blocks that write a real codebase into a
throwaway repo before the run, so the cases test the claims they name. Those runs are not in
this directory yet.

## What the surviving three cases show

| Case | With skill | Baseline | Read |
| --- | --- | --- | --- |
| `pushes-back-on-impossible-request` | Names the contradiction; three readings with costs; **T4 blast radius, rollback, owner**; cites its own reference files by line | Names the contradiction; two milestones; asks 5 questions; cites reference lines | Both correct. Skill adds the T4 block and sequencing; baseline is already good |
| `flags-multi-tenant-leak` | Catches the missing scope; plan with non-goals and risks; **4 decisions with a lean**; states rollback | Catches the leak; required elements; points at tenant scope | Both catch it. Neither is worse |
| `does-not-invent-a-test-command` | Refuses to fabricate; reports the handoff block; explains why | Refuses to fabricate; greps for evidence | Effectively identical |

**The honest read: on these tasks, the baseline model was already strong enough that the skill's
marginal contribution is real but modest.** That is not a failure of the skill. It is the
expected result for a well-specified task that a frontier model can reason about unaided — the
skill mostly supplies structure (T4 fields, non-goals, blast radius) rather than insight.

Where a rule-heavy skill could plausibly cost more than it saves: both skill-loaded answers are
noticeably longer. On `pushes-back-on-impossible-request` the with-skill output runs about 60%
longer than the baseline's. For a real user that is a cost paid on every T3/T4 task.

## What this does not establish

- No variance estimate. One run per arm; a close case is a coin flip, not a small effect.
- No second model, so nothing about portability of the effect.
- No comparison against a well-written `CLAUDE.md` or a competing skill, which is the actual
  alternative a team is choosing between.
- Three cases is too few for an aggregate, and no aggregate is given here for that reason.

## The cases that should decide whether this skill earns its place

Rewritten into `tests/evals/evals.json` as fixtures, each chosen because a competent model
plausibly gets it wrong without help:

- `uses-the-projects-real-gate` — can it quote real output from the repo's real test command?
- `adds-a-test-for-a-new-behaviour` — a function named "backoff" that has none.
- `keeps-a-flag-from-becoming-permanent-debt` — "we can clean it up later."
- `does-not-leave-scaffolding-behind` — a green suite asserting a stub that accepts forged
  webhooks. This is the case the skill claims to exist for.