# Definition of Done

Every unchecked box is fixed now or reported as a known gap. "It works" is not an item on
this list; evidence is.

## Correctness

- [ ] Does what was asked, and only what was asked.
- [ ] Root cause understood and stated, not just patched.
- [ ] Gates run: specific test, typecheck, lint, full suite, build - output captured.
- [ ] Edge cases considered: empty, null, zero, negative, very large, unicode, concurrent.
- [ ] Errors handled deliberately; nothing swallowed.
- [ ] No unrelated changes in the diff.

## Design

- [ ] Sits in the layer that owns the responsibility; dependencies one-way; no new cycles.
- [ ] Public interfaces and data shapes documented where consumed.
- [ ] Compatibility preserved, or the break called out loudly.
- [ ] Reused existing code rather than duplicating it.
- [ ] No god file, no unbounded function; consistent with codebase norms.

## Tests

- [ ] Every bug fix has a regression test that failed before the fix.
- [ ] New public behavior covered, including the failure path.
- [ ] Deterministic: no real network, clock, sleep, or shared state.
- [ ] Nothing skipped, weakened, or deleted to get green.

## Hygiene

- [ ] `node <skill-base>/scripts/smells.mjs --changed` clean, or findings explained.
- [ ] No `TODO`/`FIXME`/`HACK`/`temp`/`quick fix` left in the tree.
- [ ] No commented-out code, debug logging, or scaffolding files.
- [ ] README, docs, examples, `.env.example` updated where the change made them wrong.
- [ ] Comments explain why; narration deleted. Changelog entry if the project keeps one.
- [ ] `git status` shows only intended changes.

## Security and data

- [ ] No secrets, tokens, or real user data in code, logs, tests, or commits.
- [ ] Inputs validated at the boundary; queries parameterized; output escaped.
- [ ] Auth and authorization checked on the new path.
- [ ] Migrations additive, reversible, safe against live traffic.

## Handoff

- [ ] Summary describes behavior, not a file list; files grouped by purpose.
- [ ] The design decision and its rationale are stated.
- [ ] Exact commands and their results are listed.
- [ ] "Not done / risks" is honest and specific.
- [ ] Open decisions the user must make are explicit.

```text
## What changed
## Files          - <path> - <purpose>
## Design         - <contract chosen, and why over the alternatives>
## Verification   - `<command>` -> <result>
## Not done / risks
## Decisions needed
```

## The one question

> If the next engineer read only my diff and my handoff, could they change this code safely,
> and would they trust my claims?

If not, it is not done.
