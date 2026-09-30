# Definition of Done

Run this before saying the work is complete. Every unchecked box is either fixed now or
reported as a known gap. "It works" is not an item on this list; evidence is.

## Correctness

- [ ] The change does what was asked, and only what was asked.
- [ ] Root cause is understood and stated, not just patched.
- [ ] Tests were run: the specific test, typecheck, lint, the full suite, the build.
- [ ] Command output is captured for the handoff. No claim rests on belief.
- [ ] Edge cases considered: empty, null, zero, negative, very large, unicode, concurrent.
- [ ] Errors are handled deliberately; nothing is swallowed.
- [ ] No unrelated changes snuck into the diff.

## Design and structure

- [ ] The code sits in the layer that owns the responsibility.
- [ ] Dependency direction is respected; no new cycles.
- [ ] Public interfaces and data shapes are documented where consumed.
- [ ] Backward compatibility preserved, or the breaking change is called out loudly.
- [ ] Reused existing code instead of duplicating it.
- [ ] No god file, no unbounded function; sizes are consistent with the codebase.
- [ ] Config, secrets, and dependencies are handled properly, not hardcoded.

## Tests

- [ ] Every bug fix has a regression test that failed before the fix.
- [ ] New public behavior is covered, including the failure path.
- [ ] Tests are deterministic: no real network, clock, sleep, or shared state.
- [ ] Assertions target behavior, not internal call sequences.
- [ ] No test was skipped, weakened, or deleted to get green.

## Hygiene

- [ ] `node <skill-base>/scripts/smells.mjs --changed` is clean, or findings are explained.
- [ ] No `TODO`, `FIXME`, `HACK`, `temp`, or `quick fix` left in the tree.
- [ ] No commented-out code, no leftover debug logging, no scaffolding files.
- [ ] README, docs, and examples updated where the change made them wrong.
- [ ] Comments explain *why*; narration comments deleted.
- [ ] `.env.example` and config docs updated if the config surface changed.
- [ ] Changelog entry added if the project keeps one.
- [ ] `git status` shows only intended changes, staged or unstaged deliberately.

## Security and data

- [ ] No secrets, tokens, or real user data in code, logs, tests, or commits.
- [ ] Inputs validated at the boundary.
- [ ] Queries parameterized; output escaped; no `eval` / `exec` / shell interpolation.
- [ ] Auth and authorization checked on the new path.
- [ ] Migrations are additive, reversible, and safe to run against live traffic.

## Handoff

- [ ] Summary describes behavior, not a file list.
- [ ] Files grouped by purpose.
- [ ] The design decision and its rationale are stated.
- [ ] Verification section lists exact commands and their results.
- [ ] "Not done / risks" is honest and specific.
- [ ] Open decisions the user must make are listed explicitly.

## Handoff template

```text
## What changed
<behavior-level description>

## Files
- <path> - <purpose>
- <path> - <purpose>

## Design
<the contract chosen, and the reason for that choice over the alternatives>

## Verification
- `<command>` -> <result>
- `<command>` -> <result>

## Not done / risks
- <deferred item, with why and what it would take>
- <unverified area and why it could not be verified>

## Decisions needed
- <question for the user>
```

## The one question to ask yourself

> If the next engineer read only my diff and my handoff, could they change this code
> safely, and would they trust my claims?

If the answer is no, the work is not done.
