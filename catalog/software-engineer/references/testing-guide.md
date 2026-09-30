# Testing Guide

Testing is not coverage theater. It is the cheapest way to make a change safe to make and
safe to keep. This guide decides **what deserves a test**, and what a trustworthy test
looks like.

## What to test

| Change | Required test |
| --- | --- |
| Bug fix | Regression test that fails before the fix, passes after |
| New public function / endpoint / component behavior | One test per documented behavior, including the failure case |
| Refactor | No new tests; the existing suite proves behavior is unchanged |
| Data model / migration | Migration up, migration down, and a test on the post-migration shape |
| Performance fix | A benchmark or measurement recorded in the PR, not a test with a timing assertion |
| Typo, comment, log message, formatting | None |

Do not test: private implementation details, getters that return what you just set, the
framework itself, or a mock's return value. A test that breaks on every refactor while the
behavior is unchanged is a cost with no benefit.

## The test pyramid

- **Unit** - fast, pure, no IO. One behavior per test, named as a sentence.
- **Integration** - real component boundaries: database, filesystem, queue, HTTP handler.
  Fewer, slower, and the ones that actually catch wiring bugs.
- **End-to-end** - the critical user paths only. Expensive and flaky; keep the count small
  and the selectors durable.

Most bugs live at the boundaries, so integration tests earn their cost. Most speed comes
from keeping unit tests fast, so keep them free of IO.

## Test quality rules

- **One behavior per test.** Name it as a statement: `rejects orders after expiry` beats
  `test order 3`.
- **Deterministic.** No real network, no real clock, no `sleep`, no random without a
  fixed seed, no dependence on execution order or shared state, no reliance on a previous
  test's leftovers.
- **Arrange / Act / Assert, visibly separated.** When a test is 80 lines, extract setup.
- **Assert on behavior, not internals.** Assert on the returned value, the persisted row,
  the emitted event, the HTTP response - not on which private method was called.
- **A failing test must fail for the right reason.** If a test passes when the feature is
  deleted, it is worthless. Check this once for tests you write against a bug.
- **Explicit assertions.** No silent passes, no assertion libraries configured to no-op.
- **Clean up.** Every test leaves the system as it found it: temp dirs, DB rows, env vars,
  global state, timers.

## Test doubles policy

Fake the slow and the unstable; never fake the thing under test.

- **Prefer fakes over mocks.** An in-memory implementation that behaves like the real one
  survives refactors; a mock coupled to call counts does not.
- **Never mock the type you are testing.** Mock the network, the clock, the filesystem, the
  queue - the boundary.
- **Contract-test your fakes.** If an in-memory repository replaces a real one in tests, it
  must pass the same contract suite, or it will drift into a second, wrong implementation.
- **Control time explicitly.** Inject a clock. Tests that depend on "now" are the flakiest
  tests in any suite.
- **Timezone and locale:** pin them in the test environment. Unpinned timezones produce
  failures that only appear on a contributor's machine.
- **Snapshot tests** are for large, stable structures only. Small snapshots churn on every
  refactor and are never reviewed carefully.

## Coverage

Coverage is a discovery tool, not a goal.

- Use it to find **untested branches**, not to chase a percentage.
- A target of 100% produces tests that assert the language, not the behavior.
- Watch the diff: coverage that drops on changed lines is a genuine finding.

## Gates before you say "done"

Run, in this order, narrowing to widening:

```bash
<test command for the touched module>   # fast feedback on the change itself
<typecheck / compile>                   # does it even build
<lint>                                  # style and likely-bugs
<full test suite>                       # regressions anywhere
<build>                                 # does the artifact work
```

Then `node <skill-base>/scripts/smells.mjs --changed` to catch leftovers in the diff.

If a check cannot run in this environment, say so and state what remains unverified. An
unrun test suite is an unverified claim, and unverified claims are not acceptable output.

## When the suite is already red

1. Confirm the failure predates your change (`git stash` and re-run, or read the failing
   test's history).
2. Do not make it disappear. Do not skip, delete, loosen, or `.only` the test.
3. Report it: the failing test, the command, and whether your change is implicated.
4. If it blocks your verification, say the verification is blocked and why.

A green suite produced by weakening tests is a lie, and it is a lie that survives to
production.
