# Anti-Pattern Catalog

The failure modes of vibe coding, in the order they usually appear. Each entry: how to
spot it, why it hurts, and the engineering move. `scripts/smells.mjs` automates detection
for the mechanical ones.

## A. Unverifiable claims

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| "It should work now." | Untested reasoning ships as fact | Run the command, paste the output |
| "Fixed." with no cause explained | The same bug returns in a new costume | Two-sentence root cause in the handoff |
| Test results described from memory | Hallucinated evidence destroys trust | Only report what the terminal printed |
| "I think the issue was X" with no trace | Guessing wastes cycles | Reproduce, then name the cause with `file:line` |

## B. Deferred debt

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| `TODO`, `FIXME`, `XXX`, `HACK`, `temp`, `quick fix` in the tree | Nobody owns it; nobody clears it | Finish it, or file an issue and link it in the comment |
| `// add later` around a missing capability | The contract exists, the behavior does not | Complete it or remove the exposed surface |
| Placeholder bodies: `return null`, `pass`, empty handlers | Callers rely on it; the crash moves to production | Throw a clear "not implemented" error, or implement it |
| Fake data in a production path | Demo data leaks to users | Fixtures belong in tests only |
| Commented-out code | Dead code that rots and hides intent | Delete it. Version control remembers. |
| "Cleanup" as a category in a backlog | Nothing is ever cleaned | Clean as you go, in the same change |

## C. Structural chaos

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Everything in one file (1000+ lines) | No one can review it; every change conflicts | Split by responsibility, extract modules |
| Business logic in a UI / controller / route handler | Rules cannot be reused or tested | Move to the application/domain layer |
| Layer violations (UI importing the database) | Changes cascade everywhere | Enforce dependency direction; check new imports |
| Import cycles | Nobody can extract a module safely | Extract the shared concept into a third module |
| `utils.ts` / `helpers.ts` / `common.ts` dumping grounds | Meaningless names, no ownership | Split by responsibility and name each one |
| God objects / managers doing IO, rules, and formatting | Untestable, unchangeable | One responsibility per unit |
| Files over ~500 lines, functions over ~50 | Proof that the design is unresolved | Split at the seams you can name |

## D. Copy-paste culture

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Two blocks that look similar | The third copy is the one that matters | Extract at the third occurrence, or at two if they will diverge |
| Copy-pasted validation / error handling | Inconsistent messages, inconsistent rules | One shared validator, one shared error type |
| Duplicated config or constants | Drift is a matter of time | Single source of truth, imported |
| "I copied the old file and edited it" | Inherited bugs and dead code | Start from the smallest correct structure |

## E. Unsafe data handling

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| No input validation at the boundary | Garbage in, incidents out | Validate and normalize at the edge, once |
| String-built SQL | Injection | Parameterized queries, always |
| Secrets, tokens, keys in code or config | Leaks are unrecoverable once pushed | Env vars, secret store, `.env.example` documents the shape |
| Real user data in tests or fixtures | Privacy and legal exposure | Synthetic data with the same shape |
| Destructive migration with no rollback | Unrecoverable data loss | Additive, reversible, staged, with a dry run |
| Unbounded query, upload, or request | Easy DoS | Limits, pagination, timeouts |

## F. Silent failure

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Empty `catch` / `except: pass` | Failures vanish; bugs become mysteries | Handle it or log it with context and a reason |
| Swallowed promise rejection | Async failures never surface | `await`, or handle explicitly with a comment |
| Error message "Something went wrong" | Useless at 3am | What failed, which id, likely cause |
| Returning `null` for both "absent" and "failed" | Caller cannot tell them apart | Distinct types or an error result |
| Retrying without a limit | Hides the real error, amplifies load | Bounded retries with backoff, then surface |

## G. Unverified "works on my machine"

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Dependency added, lockfile not updated | Builds differ per machine | Update and commit the lockfile |
| Toolchain ignored (Node/Python/Go version) | Works locally, fails in CI | Respect `engines`, `.nvmrc`, `rust-toolchain`, `go.mod` |
| Tests not run before handoff | The claim is untested | Run them, or say they were not run |
| "Just try this" experiments left in the tree | Unknown behavior ships | Revert, then apply the reasoned fix |

## H. Process shortcuts

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Committing straight to a protected branch | Unreviewable, unbisectable history | Feature branch, small commits, PR |
| One commit containing unrelated work | Cannot be reverted or reviewed in isolation | One concern per commit |
| Rewriting published history | Destroys other people's work | Rebase only unpublished commits |
| `git commit -a` with unknown changes | Commits someone else's secrets or WIP | Read `git status` and the diff before staging |
| Ignoring an unrelated failing test | Hides real breakage | Report it, don't bury it |
| No plan for a cross-cutting change | Rewrites disguised as features | Plan, then implement in stages |

## I. Test-shaped avoidance

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| No regression test for a bug fix | The bug returns | Failing test first, then the fix |
| Test skipped with `.skip` / `xit` / `@Ignore` | Permanent blind spot | Track it, or delete it |
| Assertion weakened to make CI green | The suite stops protecting anything | Fix the cause |
| Mocked-away core logic in the test | The test proves nothing | Exercise the real unit |
| Time-dependent or order-dependent tests | Flaky suites get ignored, then disabled | Inject the clock, isolate the state |

## J. Documentation debt

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| README describes the old behavior | Actively misleading | Update in the same change |
| No explanation for a non-obvious decision | The next person re-litigates it | Comment the why, or an ADR |
| Comments narrating the code | Noise that hides real comments | Comment the reason, delete the narration |
| Example config out of sync with real config | Newcomers cannot run it | Regenerate and verify it |

## The one-line version

Everything in this catalog is one of two failures: **unverified** or **unowned**. Fix the
verification, then attach an owner and a design to everything else.
