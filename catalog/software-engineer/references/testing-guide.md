# Testing Guide

Testing is not coverage theater. It is the cheapest way to make a change safe to make and
safe to keep.

## What earns a test

| Change | Test |
| --- | --- |
| Bug fix | Regression test: fails before the fix, passes after |
| New public behavior | One test per documented behavior, including the failure case |
| Refactor | None. The existing suite proves behavior is unchanged |
| Migration | Up, down, and the post-migration shape |
| Typo, comment, log message | None |

Never test private internals, getters that return what you just set, the framework, or a
mock's return value. A test that breaks on every refactor while behavior is unchanged is a
cost with no benefit.

## Trustworthiness

- One behavior per test, named as a statement: `rejects orders after expiry`, not `test 3`.
- Deterministic: no real network, clock, `sleep`, or randomness without a fixed seed; no
  execution-order or shared-state dependence.
- Assert on behavior and contracts - returned value, persisted row, emitted event, HTTP
  response - not on which private method ran.
- Once per test, check that deleting the feature makes the test fail. If it still passes, the
  test is worthless.
- No silent passes from a misconfigured assertion library. Clean up temp dirs, rows, env
  vars, global state, and timers.

## Pyramid

Unit: fast, pure, no IO. Integration: real boundaries (db, fs, queue, handler) - fewer and
slower, and where wiring bugs actually live. E2E: critical user paths only. Most speed comes
from keeping unit tests IO-free; most bugs come from the boundaries.

## Doubles

Fake the slow and unstable, never the thing under test. Prefer an in-memory fake over a
mock coupled to call counts. If a fake replaces a real dependency in tests, it must pass the
same contract suite, or it drifts into a second and wrong implementation. Inject the clock;
time-dependent tests are the flakiest in any suite. Pin timezone and locale. Snapshot only
large stable structures.

## Coverage

A discovery tool, not a target. Use it to find untested branches. 100% produces tests that
assert the language. What matters is that changed lines stay covered.

## Red suites

1. Confirm the failure predates your change (`git stash` and re-run, or read its history).
2. Do not skip, delete, weaken, or `.only` anything to make it green.
3. Report it: the failing test, the command, and whether your change is implicated.
4. If it blocks verification, say verification is blocked and why.

A green suite obtained by weakening tests is a lie, and one that survives to production.

Run gates narrow to wide - specific test, typecheck, lint, full suite, build - then
`node <skill-base>/scripts/smells.mjs --changed`. An unrun suite is an unverified claim, and
unverified claims are not acceptable output.
