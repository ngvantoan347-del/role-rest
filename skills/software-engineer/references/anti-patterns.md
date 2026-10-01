# Anti-Patterns

`smells.mjs` catches the mechanical part. This file is the part that **needs judgment** -
the things a regex never reaches, and the things that actually break systems.

Why it is separate: a regex matches strings. It does not know what the requirement is, which
module owns the behavior, or what is correct at 10,000 records. Every row in the tables below
is that kind of error, and you only find it by stopping and asking.

## A. Errors that break systems - no tool sees them

| Smell | Why the script cannot see it | Why it is dangerous | How to detect it |
| --- | --- | --- | --- |
| **Abstraction at the wrong layer** | Correct code, running, just in the wrong place | Every business rule change means editing everywhere, and everyone is afraid to edit | Ask: "when this requirement changes, who has to be asked?" Nobody does → wrong layer |
| **Right logic, wrong intent** | No syntax knows the requirement | The feature ships and does the wrong thing, and the tests are green because they were written from the same misreading | Walk each branch asking "what is this branch for?" |
| **Breaks at scale** | Correct at 10 records | It breaks when traffic grows, and then the fix costs 10x | Always ask about N: N+1 queries, missing pagination, unbounded connections, unbounded cache |
| **Breaks under concurrency** | Sequential tests all pass | Race conditions are rare, hard to reproduce, and most expensive when they happen | What happens with two requests at once? Is there an idempotency key? A transaction? |
| **Breaks in production** | Dev box has 8 cores, prod has 2 | The problem only shows up after deploy | Is the config here the same as production? Are timeouts set? |
| **Holes that come from intent** | A secret regex does not understand "this endpoint exposes another user's PII" | A data leak is an incident you cannot undo | Does every boundary have authN + authZ? Does the response carry exactly the data needed? |
| **Green but meaningless tests** | Pass, full coverage | Creates false safety | Delete the feature: do the tests fail? Do they assert the contract or the implementation? |
| **Docs ↔ code drift** | Both "work" | Newcomers trust the wrong doc and go the wrong way | After every change: which docs are now wrong? |

## B. Unverifiable claims

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| "It must work by now" | A conclusion from speculation shipped as fact | Run the command, paste the output |
| "Fixed" with no root cause | The same bug returns in a different coat | Root cause in 2 sentences in the handoff |
| Test results described from memory | Fabricated output destroys trust in everything after it | Only report what the terminal printed |
| "I think the problem is X" without tracing | Guessing burns a whole loop | Reproduce, then name the cause with `file:line` |

## C. Deferred debt

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| `TODO` with no owner, no issue | Nobody cleans it, nobody sees it | Finish it, or open an issue and link it in the comment |
| "add later" around a missing capability | The contract exists, the behavior does not | Finish it or remove the surface you already exposed |
| `return null` / empty body where something was promised | Callers depend on it, the crash moves to production | Throw a clear "not implemented" error, or implement it |
| Fake data in a production path | Demo data reaches users | Fixtures belong to tests only |
| Commented-out code | Dead code that hides the intent | Delete it. Git remembers everything. |
| "Cleanup" as a backlog item | There is never a cleanup day | Clean up in the change you are already making |

## D. Structural chaos

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Business rules in UI/controller/route | The rule is not reusable, not testable | Move it to the application/domain layer |
| Layer violation (UI imports the DB) | Changes spread everywhere, there is no way back | One-way dependency; review every new import line |
| Import cycle | No module can be extracted safely | Extract the shared concept into a third module |
| `utils.ts` / `helpers.ts` | A meaningless name, no owner | Split by responsibility, use a real name |
| A god object doing IO, rules, and formatting | Untestable, unchangeable | One unit, one responsibility |
| A 1000+ line file | Nobody can review it, every change conflicts | Split by responsibility |
| File >500 lines, function >80 lines | A sign the design has not settled | Split at the seams you can name |

That is the picture: a bundle of wires everyone plugs into the nearest available thing. It
still "works" - but nobody dares unplug a strand they are not certain is unimportant. The fix
is to **name the endpoints and shape things deliberately**, not to try harder with the bundle.

## E. Copy-paste

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Two identical blocks | The third copy is when you have to deal with it | Abstract on the third occurrence (or the second if you are sure they will diverge) |
| Copied validation / error handling | Messages drift, rules drift | One shared validator |
| Copied config / constants | Drift is a matter of time | A single source of truth |
| "Copy the old file and edit it" | Inherits the old file's bugs and dead code | Start from the smallest correct structure |

## F. Data and failure

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| No validation at the boundary | Garbage in, incident out | Validate and normalize once at the edge |
| SQL built from strings | Injection | Always parameterized queries |
| Secrets/tokens in code, logs, fixtures | Leaked once, gone | Env or a secret store; `.env.example` describes the shape |
| Real user data in tests | Privacy and legal violation | Fake data with the same shape |
| Migration with no rollback | Data loss that cannot be undone | Additive, reversible, runnable against live traffic |
| Unbounded queries/uploads | Trivial DoS | Limits, pagination, timeouts |
| Empty `catch` | The error vanishes, the bug becomes a secret | Handle it, or log it with context and reason |
| "Something went wrong" | Useless at 3am | What failed, which id, the likely cause |
| `null` for both "absent" and "error" | Callers cannot tell them apart | A separate type, or an explicit error return |
| Unbounded retry | Hides the real error, amplifies load | Bounded retry + backoff, then report it |

## G. Process shortcuts

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Committing straight to a protected branch | Unreviewable, unbisectable | Feature branch, small commits, PR |
| One commit with unrelated work | Cannot be split apart later | One commit, one concern |
| Rewriting public history | Breaks other people's work | Only rebase commits nobody has pulled |
| `git add .` without knowing what is in it | Commits someone else's secret | Read `git status` + the diff first |
| Ignoring pre-existing test failures | Hides real breakage | Report it, do not bury it |
| "Trying this out" left in the tree | Strange behavior ships to production | Revert, then apply the fix with a reason |
| Cross-cutting change with no plan | Refactor disguised as a feature | Plan it, then work through it step by step |

## H. Documentation debt

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| README describes old behavior | Misleads on purpose | Fix it in the same change |
| A decision nobody can explain | The next person re-argues it from scratch | Comment the reason, or write an ADR |
| Noise comments that talk to themselves | Hide the comments that matter | Delete them |
| Examples that diverge from the real config | Newcomers cannot run anything | Regenerate and verify |

## How to use this file

Sections C through H are **not** about verification - they are about ownership, structure, and
design. Do not run one more command to "cure" a god object; you have to split it.

Two things here are real verification, and they come first because they are cheaper than the
rest of the file:

1. **`node scripts/falsify.mjs`** - do your tests actually catch the bug.
2. **Think in N and in parallel**, section A. No command checks that.

The full list of techniques and stopping points: `references/verification-techniques.md`.
