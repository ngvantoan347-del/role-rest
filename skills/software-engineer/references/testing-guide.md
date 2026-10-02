# Testing Guide

Tests are not a coverage ritual. They are the cheapest way to make a change safe to ship and
safe to keep.

Filter criterion: keep only what decides **whether to test** and **whether a test is
trustworthy**. You look up framework syntax faster than you read it here.

## What deserves a test

| Change | Test |
| --- | --- |
| Bug fix | Regression test: fails before the fix, passes after |
| New public behavior | One test per documented behavior, **including the error branch** |
| Refactor | None. The existing suite proves behavior did not change |
| Migration | Up, down, and the shape after the migration |
| Perf fix | A benchmark or a measurement in the PR, **not** a timing assertion in a test |
| Typo, comment, log message, formatting | None |

Do not test: private internals, a getter returning what you just set, the framework itself,
or a mock's return value.

A test that breaks on every refactor while behavior is unchanged is **pure cost**. That test
is protecting the code instead of the behavior - and when the behavior really breaks, it is
still green.

## Trustworthy tests

- **One behavior per test.** The name is a proposition: `rejects orders after expiry` beats
  `test order 3`. When a test fails, the name has to say where the bug is.
- **Deterministic.** No real network, no real clock, no `sleep`, no unseeded randomness, no
  dependence on run order, no shared state between tests. A flaky test is worse than no test:
  it teaches the team to ignore the whole suite.
- **Assert on behavior and contract** - return values, stored rows, emitted events, HTTP
  responses - not on which private method got called.
- **Once per test:** delete the feature, does the test fail? If it is still green, the test
  is useless. `node scripts/falsify.mjs` does exactly this mechanically, and does it for
  every branch in the diff instead of one spot you remembered.
- **Explicit assertions.** No silent passes from a misconfigured assertion library.
- **Cleanup.** Every test leaves the system as it found it: temp dir, DB rows, env vars,
  global state, timers.

## The pyramid

- **Unit** - fast, pure, no IO. One behavior per test.
- **Integration** - real edges: database, filesystem, queue, HTTP handler. Fewer, slower, and
  where real wiring bugs live. Most bugs sit at the edge, so integration tests pay back best.
- **End-to-end** - only the critical user path. Expensive and flaky; keep the count small and
  the selectors stable.

Most of the speed comes from unit tests not touching IO. Most bugs come from the edges. That
is why you do not buy speed here by cutting integration tests.

## Test doubles

**Fake what is slow and unstable. Never fake the thing under test.**

- Prefer **fakes** over mocks: an in-memory implementation that behaves like the real thing
  survives refactoring; mocks tied to call counts do not.
- If a fake replaces a real dependency in a test, it has to pass the **same contract suite**
  - otherwise it drifts into a second implementation, which is wrong.
- **Inject the clock.** Tests that depend on "now" are the flakiest tests in any suite.
- Pin timezone and locale in the test env. An unpinned timezone produces bugs that only appear
  on one contributor's machine.
- Snapshots only for large, stable structures. Small snapshots change on every refactor and
  nobody reads them closely.

## Coverage

Coverage is an exploration tool, not a goal.

- Use it to find **untested branches**, not to chase a percentage.
- Aiming for 100% produces tests that assert the programming language, not behavior.
- The number worth tracking is coverage on **the lines you just changed**: a drop there is a
  real finding.

## The suite is red

1. Confirm the failure predates your change (`git stash` and run again, or read that test's
   history).
2. **Do not make it disappear.** No skipping, no deleting, no loosening, no `.only`.
3. Report: which test fails, which command, and whether your change is related.
4. If it blocks your verification, say clearly that verification is blocked and why.

A suite that is green because you loosened the tests is a lie, and that lie ships to
production.

## Running the gate

Narrow to wide - the specific tests, typecheck, lint, the full suite, build - then
`node scripts/smells.mjs --changed` (relative to the directory containing `SKILL.md`).

A suite you have not run is an unverified claim, and an unverified claim is not an
acceptable output.
