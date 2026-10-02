# Review Playbook

Review goes two ways: reading someone else's diff, and re-reading your own change before you
open the PR. The same set of questions applies to both.

The author-side of a PR - description, formatting, secrets, when to split - is already in
`references/git-workflow.md`. This file is the **reviewer side**: what to read first, what to
ask, how to comment so you get heard, and when to block.

Why it exists: most "review it carefully" standards turn into reading the diff once and
clicking merge. That is behaviour with consequences, not diligence - the consequence is that
someone else has to find your bug in production, where it costs more.

## 1. What a reviewer is doing

Review is not for rewriting someone else's code. Three jobs, in priority order:

1. **Is it safe to merge.** Which bugs cost more to find later.
2. **Is the contract right.** Who is affected, and do old callers still
   work.
3. **Is it readable in one sitting.** An unreviewable diff is a review that does not happen.

What you **do not** do: prove your own code is prettier, add abstractions, or fix bugs outside
the scope of that PR. Why: every unasked-for change pushes the bug somewhere nobody reads, and
it buries a good diff under unrelated diffs.

Read like an SRE trying to **keep** the system running, not like someone who wants it to run
their way.

## 2. Order to read the diff

| Order | What to read | Why it is here |
| --- | --- | --- |
| 1 | **Contracts and data shape**: signatures, schema, response, migration | Blast radius is decided at the boundary. Fixing it here later costs more |
| 2 | **Failure paths**: who handles it, retry, timeout, what gets swallowed | A silent failure is a failure that comes back wearing a different coat |
| 3 | **Concurrency and transactions**: idempotency, write order, race | Sequential tests all pass; the bug only shows up when it really runs |
| 4 | **The bulk of the logic** | Usually the most correct part of a diff |
| 5 | **Names, formatting, comments** | Does not ship an incident. Leave it to CI and the formatter |

The most common wrong order is reading the whole body before looking at the contract - you read
a full sitting understanding the code, then find the contract is wrong on the last line.

Contract and data details: `references/design-guide.md`.

## 3. High-signal checklist

One read is not enough. Run each of these questions, and **answer them out loud** in the review
- an oral answer is what forces you to think of it.

| Question | What a bad answer looks like | Cheap check |
| --- | --- | --- |
| Who is affected by this diff? | "Internal only" without saying which internal | Read the real callers, count backwards from the new symbol |
| What breaks at 10× traffic? | A loop inside a loop, a `SELECT *` with no limit | Count queries per request, look for missing pagination |
| What happens on partial failure? | Writing 3 tables with no transaction, then returning an error | List the side effects, ask which have to be atomic |
| What about retry? | No idempotency key, a repeated side effect | Assume the request arrives a second time with the same payload |
| What if an old-version caller calls in? | Renaming/deleting a field in the schema | Read the real consumer, not the PR description |
| Delete this feature - does the test go red? | The test asserts against a mock, so it stays green | Delete the branch and re-run |
| Does the failure path exist or is it swallowed? | An empty `catch`, `except: pass`, `.catch(() => {})` | Look for ignored exceptions in the diff |
| Is the written data atomic? | Write the file first, update the DB after | Check the order of side effects |
| Is anything logged that should not be? | Full payload logs, PII, tokens in requests | Read every new log line |
| Do the new config/env values have safe defaults? | `TIMEOUT_MS` with no default, so missing means 0 | Read `.env.example` and how config is loaded |
| Does the new path have authN + authZ? | Auth copied from the neighbouring route without checking | Compare against a similar existing route |

This is the same set of bugs that `references/anti-patterns.md` lists - written from the reviewer's
side, and keeping only the ones readable in a diff. Test policy details: `references/testing-guide.md`.

The last two rows of the table - logging sensitive data and auth on a new path - are the part
dropped fastest because no test goes red when you forget. The specific requirements for them
are in `references/compliance-and-data.md`.

## 4. Writing comments that get heard

Comments get ignored **not because they are wrong**, but because they are not actionable. A
comment needs four things: **defect · triggering input · consequence · suggestion**. Missing
one means the other person has to infer it, and they will not.

| Comment | What happens |
| --- | --- |
| "Nit: use `let` where `const` is not needed" | Ignored. Nobody fixes it because the consequence is zero |
| "This looks a bit odd?" | The author guesses your meaning, guesses wrong, and changes it the other way |
| "Why?" | No context, costing a round trip for information you already have |
| "Should use `Optional` here" | Fixed or not, at whim - nobody knows the consequence of not fixing it |
| Defect + input + consequence + suggestion | Fixed immediately, or an explanation of why it is not needed |

```text
Bad:  "check for empty before writing?"

Good: "At line 84, `saveOrder` receives `order.items = []` when the payload is missing
       the `items` field, and writes anyway.
       Input: POST /orders with a body that has no `items`.
       Consequence: an empty order is created, no error returned to the client.
       Suggestion: return 400 at the boundary if `items` is empty."
```

```text
Bad:  "Race condition here."

Good: "The `if (await exists(id))` then `insert` branch at lines 112-118 runs outside
       a transaction, and `id` comes from the client.
       Input: two identical requests at the same time.
       Consequence: two rows with the same `id`, unique constraint fails at random.
       Suggestion: let the DB block it (unique index) and map that error to 409, or
       wrap it in a transaction with an idempotency key."
```

```text
Bad:  "Rename `getUsers` to `listUsers` for consistency."

Good: "Contract: `getUsers` is imported in 4 other places in the repo and in one other
       service. `references/git-workflow.md` says a sudden rename is the most expensive
       thing you can do. If you want to change it: keep `getUsers` as a deprecated
       alias, measure usage, remove it later. Cosmetic only? Leave this PR alone."
```

```text
Bad:  "Fix this timestamp bug while you are here."

Good: "Line 201 compares `createdAt` with `now()` but the query already filters in
       UTC - an hour of skew in the middle of the day.
       I have not reproduced it, so this is a hypothesis: give me a concrete case
       to check, or drop this comment if you have already seen it."
```

The rule: a comment that is **not certain** still gets written, but call it a hypothesis by name. A comment
that gets no response still gets left there - silence when you have an opinion is the worst kind of comment.

## 5. When the diff is too big to review

The 400-line threshold in `references/git-workflow.md` is a limit the author sets on themselves. You
are the reviewer, you do not have the authority to change that threshold - but you do have the authority
to **admit you cannot review it**, and that is the only acceptable behaviour when a diff is beyond you.

| Diff size | The honest action |
| --- | --- |
| < 200 lines, one concern | Full review |
| 200-400 lines | Full review, real time required - schedule it, do not rush |
| 400-800 lines | Say "I need this split" and propose a concrete split point |
| > 800 lines | Ask for a split before starting the review |
| Diff violating CODEOWNERS | Block until the right owner reviews it |

Three legitimate moves when you cannot review it, in priority order:

1. **Say it plainly and propose a split.** Name the boundary: "this refactor splits off, the
   feature stays at 120 lines".
2. **Approve conditionally with a named risk.** "I approve part X, I have read it carefully. Part Y I have not read - the risk there is unverified."
3. **Refuse to review.** There is not always the capacity to do it
   right.

What is never acceptable: approving because the diff is long, to keep the history full of
approvals. A long diff is not a safety signal; it is a signal that a lot has not been looked at.

## 6. Reviewing your own change

Self-approval is not evidence of correctness. Someone re-reading code they just wrote is
reading their own intent, not reading code - you cannot see what you did not think of.

How: close the window, read `git diff` from the top as if someone else had just written it, and
run the section 3 checklist **in the same order** - contract first, names last.

Six things to look at again, because this is where you forget first:

| Look again at | Question | Why |
| --- | --- | --- |
| **Deleted code** | Is anyone still using this deleted block? Is it a vendored line or dead code? | A wrong deletion is the most expensive bug at the wrong moment |
| **Silently changed defaults** | Timeout, retry count, limit, flag, null value - is anything changed that the PR does not mention? | A reader cannot read a default out of a diff |
| **Error handling** | Is the error branch real, or is it just a `catch` and a log? | The code works because the error has not arrived yet |
| **Regression tests** | Delete the feature - does the test go red? Does the test assert the contract or the implementation? | A green but meaningless test is false confidence |
| **Docs still match** | Which line in the README/ADR/runbook is now wrong? | Wrong docs are more dangerous than missing docs |
| **Scope** | Is any line in the diff not part of this PR? | Tidying up in passing is a change nobody reviewed |

Then run `references/dod-checklist.md`. Any box you do not tick gets fixed or reported - no box
gets skipped in silence.

## 7. When to block

**Block when you have a specific input that breaks it.** That is the only criterion. Blocking
does not need the author's agreement; it only needs evidence.

| Block | Do not block |
| --- | --- |
| There is an input → it breaks (with that input in the comment) | Preference on names, layout, comment style |
| Violates a required check, with no way to go green | Not optimised, not refactored |
| New behaviour with no test per `references/testing-guide.md` | "I would do it differently" without being able to name a consequence |
| Violates CODEOWNERS, or touches auth/data/migration | The diff is not split enough - that is a reminder, still worth saying |
| Nobody can read this change back | Being slow - the reviewer has a duty to say so early |
| A claim in the PR does not match the code | Disliking the layering, with no example of breakage |

Block on **direction** when the change is reversible: say what you think and what you would
agree to. Blocking on direction while leaving a specific option open is an unconditional block
- worse, because it teaches the whole team that review is a fight.

**Urgent changes that skip review.** When there is genuinely urgent work - an incident on fire,
a security patch - the correct process is not a rubber stamp. It is:

- Minimal review, **in place**, with whoever is on call: read the diff together, 10 minutes.
- Record who approved it and which part they saw, in the PR or the ticket itself.
- Name the part not reviewed and the remaining risk, instead of leaving it blank.
- A follow-up task with an owner and a deadline, created at merge time, not "later".

Approving flat something nobody read is putting your name as a signature on something you do
not understand. When it surfaces, that name is in the postmortem.

## 8. Convention, preference, and disagreement

**A team's convention beats your preference.** If the repo has a formatter, a linter, a test
asserting a style - that is a decision someone already paid for, and changing it costs more
time than it returns. When you want to change a convention, that is its own change.

Label every comment clearly: must (has a consequence), **suggestion** (I prefer), or
**question** (I do not understand). An unlabeled comment is read as mandatory, and that way you
create a blocker without creating value.

**Two reviewers disagree** - do not resolve it by whoever has more authority pressing a button:

1. **Name the difference:** is this a misread of the requirement, an architecture decision, or
   a preference? Those three have different resolutions.
2. **Bring evidence, not opinion.** "I think it is wrong" is nothing. "With input X the result
   is Y, and this is consequence Z" is something.
3. **Escalate to the person who actually decides.** Architecture decisions belong in an ADR or with
   the service owner, not in a review thread. How to open one: `references/enterprise-standards.md`.
4. **When you still disagree on a small point:** approve the clear part and write down which part you
   do not agree with. Blocking a whole PR over a style comment is how you train people to skip review.

There is one case that is not a disagreement: **you find a real bug in the PR, unrelated to the
change.** Do not fix it silently, and do not stay silent either. A separate small PR, with an owner, or
add it to the queue. Silence is the choice of whoever is accountable for that bug - usually not you.

## Reading the texture

Worth a pass on its own, and it is not taste. Output that a reader can identify as generated costs
you trust in the parts that are correct, and the reviewer who learned to skim you stops skimming
code that genuinely needs attention. The tell table is in `SKILL.md` under *Write like a person did
it*.

How it shows up in a diff, which is where it is most expensive:

- An abstraction arrives before the thing it abstracts. Three new files to hold a helper that would
  have fit in the existing one.
- Comments that explain what the code does. The code says that. A comment earns its place by saying
  why the obvious version is wrong.
- Names from a pattern rather than the domain: `data1`, `tempResult`, `processData2` in a function
  about invoice reconciliation.
- A test named after the function instead of the behaviour, so a rename breaks it and no change to
  behaviour ever would.
- Error paths that all return the same generic string because they were added by pattern, not from
  what can actually go wrong.

Say it as a normal review comment, and only when it is actually there. "This file is AI slop" is not
a review comment; "`accountForRefund` returns the same 500 for a missing invoice and an expired
one, so the retry logic upstream cannot tell them apart" is.

## The full loop

Read → plan (`references/plan-template.md`) → implement → verify
(`references/stack-commands.md`) → **review** → hand over (`references/dod-checklist.md`).
Review is not a stopping point; it is the point where a bug is still cheap to fix.
