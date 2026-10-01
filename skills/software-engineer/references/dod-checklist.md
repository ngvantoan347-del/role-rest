# Definition of Done

Any box you have not ticked is either fixed now or reported as a known gap. **"It works" is
not an item on this list - evidence is.**

Filter criterion: this checklist is only useful if you actually run it, not read it for the
appearance. Skipped items must be **reported** too, because silence is the worst form of
silence.

## Correctness

- [ ] Does the requested thing, and **only** the requested thing.
- [ ] The root cause is understood and stated, not just patched around.
- [ ] The gates ran: specific tests, typecheck, lint, full suite, build - output kept.
- [ ] Edge cases considered: empty, null, 0, negative, very large, unicode, concurrent.
- [ ] Errors are handled deliberately; nothing is swallowed.
- [ ] No out-of-scope changes in the diff.

## Design

- [ ] Sits at the layer that owns the responsibility; one-way dependency; no new cycles.
- [ ] The public interface and data shape are documented where they are consumed.
- [ ] Backward compatibility is preserved, or the breaking change is said out loud.
- [ ] Existing code is reused instead of duplicated.
- [ ] No god files, no unbounded functions; consistent with project conventions.

## Test

- [ ] Every bug fix has a regression test that **fails before the fix**.
- [ ] New public behavior has tests, including the error branch.
- [ ] Deterministic: no real network, no real clock, no `sleep`, no shared state.
- [ ] Nothing is skipped, loosened, or deleted to get green.

## Hygiene

- [ ] `node scripts/smells.mjs --changed` is clean, or the findings are explained.
- [ ] `node scripts/falsify.mjs` ran, and every surviving break is either covered by a new
      test **or** explicitly recorded in the handoff as an unverified gap.
- [ ] The `reach` line was read, not skimmed. It bounds what the result means: a clean run on a
      file where the checker could only construct two breaks out of forty decision points is
      "nothing found", not "nothing wrong".
- [ ] No `TODO`/`FIXME`/`HACK`/`temp`/`quick fix` left in the tree.
- [ ] No commented-out code, debug logging, or scaffolding files.
- [ ] README, docs, examples, `.env.example` updated wherever the change made them wrong.
- [ ] Comments explain **why**; noise comments are deleted. Changelog entry if there is one.
- [ ] `git status` shows only the intended changes.

**Reminder:** the `smells.mjs` item above is only a fraction. This checklist does not replace
the judgment in `references/anti-patterns.md`. A green script is **not** done.

## Security and data

- [ ] No secrets, tokens, or real user data in code, logs, tests, or commits.
- [ ] Input validated at the boundary; queries parameterized; output escaped.
- [ ] Auth and authorization are checked on the new paths.
- [ ] Migrations additive, reversible, safe against live traffic.
- [ ] Tenant id present in **every** query, cache key, and log - not just the main endpoint.
- [ ] New dependency: lockfile updated, license compatible, audit has no high severity.

## Scale and organization

Only tick what is genuinely relevant; deliberately leaving the rest blank is better than
ticking blindly.

- [ ] Think in N: N+1 queries, pagination, connections, queues, caches all have limits.
- [ ] Think in parallel: two requests at once, retries, idempotency key, transaction.
- [ ] Blast radius stated: who else runs this, and who has to be told.
- [ ] Rollback is specific, not "revert commit" when it requires writing data back.
- [ ] Feature flag if any: has an owner, has a removal date.
- [ ] This path belongs to another team: asked or notified.
- [ ] In a monorepo: the gate ran for the affected package, not just the edited one.

## Handoff

- [ ] The summary describes **behavior**, not a file list; group files by purpose.
- [ ] Design decisions and their reasons are stated.
- [ ] The specific commands and their results are listed.
- [ ] "Not done / risks" is honest and specific.
- [ ] Open decisions the user has to make are stated explicitly.

```text
## What changed
## Files          - <path> - <purpose>
## Design         - <the contract you chose, and why it over the alternatives>
## Verification   - `<command>` -> <result>
## Not done / risks
## Decisions needed
```

## One question only

> If the next engineer reads only your diff and your handoff - can they safely change this
> code, and will they believe you?

If not, it is not done.
