# Migration and Legacy

Changes that cannot be undone with `git revert`: schema changes on large tables, replacing a
running subsystem, upgrading a dependency by dozens of majors, or fixing code that has no tests.
Filtered by one criterion, what gets skipped when you are under a deadline: freeze behaviour,
rollback switch, idempotency, measure usage before removing.

"It runs on my machine" is worth nothing here.
Every decision here revolves around a single question: **when it breaks at 3am, how do you
reverse it, and how long does it take?**

## 1. Untested legacy: buying the cheapest safety net

Having no tests is not a reason to go slower - it is a reason to get the **order** right.
Starting with "test my idea of it" on a system nobody understands puts you in the position of
the person who does understand it.

| Step | What to do | Why |
| --- | --- | --- |
| 1 | Run the existing suite **untouched**, change nothing | Know whether the baseline is red or green before you touch it. A suite that is already red is a finding to report, not your debt |
| 2 | Record the flaky tests: run 3–5 times, mark which ones are unstable | An unnamed flaky test gets blamed on your change |
| 3 | Disable flaky tests only **with an issue** and **with a date** | A disabled test nobody waits on becomes a test that does not exist |
| 4 | **Characterisation test** around the running behaviour: call the function with real input, assert the current output - including output you think is wrong | You do not know the original intent. Record the current state before you change it |
| 5 | **Golden/snapshot** real responses for hot endpoints, from sanitised data | A later diff answers "what changed" by machine, not by memory |
| 6 | A regression test for **each bug** you are about to fix | A bug that happened once happens again without a test holding it |

**Freeze behaviour before changing it.** This is a hard rule: a PR must not both refactor and
change behaviour.

Why: a refactor changes *structure*, a behaviour change changes *results*. When both are in
one diff, the reviewer has no way to know which one produced the regression - and the new
tests you wrote cover both sides, so they guarantee nothing. Split them: one PR each, one
rollback each.

A characterisation test written wrong becomes a test that asserts the bug: handle it by writing
`// currently buggy - issue #123, will change in a later PR`. Otherwise, just change it.

## 2. Reading unfamiliar code and trusting the right things

`references/discovery-playbook.md` already has the 10-minute sequence and the evidence table
template. This only adds the **legacy** part: how to read when there is nobody to explain the code.

```bash
git log --oneline -30 -- path/to/file        # edit rhythm: many edits = hot spot
git log -S "symbolName" --oneline             # when did this symbol appear/disappear
git log -S "endpoint/path" --oneline --all   # who has ever touched this contract
git blame -L 40,90 path/to/file               # intent lives in the commit, not the line
git log --format='%an %ad %s' --date=short -5 -- path/to/file   # last person on the hot path
```

Find the last person to touch the hot path and ask them one question. That answer is worth more
than a day of reading code, and it costs one message.

**Code archaeology: go from the symptom inwards, not from the file inwards.**

```text
symptom or one log line  ->  entry point  ->  call branch  ->  the invariant it assumes
```

Why: starting from a symptom, everything you read is relevant. Starting from "this file looks
logical" means reading in alphabetical order, and you will never arrive at the right place.

Three traps in legacy code, all of which look like your own bug:

| Trap | Signal | Handling |
| --- | --- | --- |
| **Dead code that is still deployed** | A branch no source ever enters, but a feature flag still points at it, a config entry remains, a cron job still calls it | Read config and the flag registry before concluding "dead". Deployed = still running. Remove the flag and deploy once before removing the code |
| **Behaviour matches the bug report, not the doc** | The doc describes X, the bug report says Y, the code does Z | **The code is the truth about behaviour**, the bug report is evidence a user hit it, the doc is only intent. Fix the doc, and record the discrepancy in an issue |
| **A vendor workaround that looks redundant** | Repeated retry, a null check twice, a timezone offset in one place | `git blame` shows what it was patching. Look at the original issue/commit. Removing it reproduces a bug fixed 2 years ago |

No commit explains it, blame points at a merge line from last year - that is a **lost
decision**, not intent. Write it down as a comment or ADR the moment you understand it, because
the next person will have no way to know.

## 3. Strangler fig: replace in parts, do not rewrite

```text
client -> [seam / router] -> legacy impl   (default)
                        \-> new impl        (flag: canary 1% -> 10% -> 100%)
```

The principle: **one boundary, one traffic switch.**

| Step | Action | Rollback when it breaks |
| --- | --- | --- |
| 1 | Put the seam at an existing boundary: an HTTP route, a queue consumer, a module interface | Remove the new route, drop the import |
| 2 | Run **both** impls on shadow/canary traffic, compare results | No side effects at this step |
| 3 | Shift traffic in small percentages, keep the feature flag | Flip the flag back: a change within seconds |
| 4 | Keep the legacy impl in the tree until usage numbers reach 0 | No way back once it is deleted |
| 5 | Remove legacy **in its own PR**, after there is test coverage on the new impl | A separate PR, revertible |

A flag must live in code and be switchable off **without a deploy**. Why: if turning it on/off
needs a deploy, then every re-enable is another deploy, and at 3am you do not want to deploy.

**A big rewrite is the default failure mode.** Four reasons, enough to reject it at the planning
stage: you cannot verify any part until the end (you only learn whether it is right then), you cannot
ship early (six months with nothing runnable for anyone else to use), you lose knowledge (the person
who understood the quirk disappears between the start and the finish), and the diff is unreviewable
(an 8000-line PR gets merged because nobody can read it - which means there was no review at all).

The condition for a strangler fig to work: **the new path must be verifiable on its own.** If
you cannot run the new impl without the legacy one, you are rewriting under a different name.

## 4. Expand-contract: changing schema while old code still serves traffic

Why `ALTER TABLE` on a large, hot table is dangerous: the lock is long depending on engine and
version, and `ADD NOT NULL DEFAULT` needs a full table rewrite. On a 200M-row table, "fast" can
mean hours of downtime. On exactly that table, a non-repeatable `ALTER` is a migration that
does not exist.

The standard order, each step a separate deploy and reversible:

| Step | Action | Why it stands alone |
| --- | --- | --- |
| 1. **Expand** | Add a new nullable column, or a new column with a default | Additive, so old code not knowing about it is safe |
| 2. **Backfill** | A batched job filling the new column | Can be run many times, does not lock the table |
| 3. **Dual-write** | New code writes both columns; reads still come from the old column | The reader has not changed, so complete data is not needed yet |
| 4. **Switch read** | Read the new column, behind a flag; measure the diff against the old column | There is a fallback if the new column missed data |
| 5. **Contract** | Drop the old column | Only when reads on the old column are at 0 |

**A rolling deploy = old code and new code running together for hours.** This is not a rare
risk, this is the normal state. Therefore:

- Readers must accept both shapes until every instance is on the new version - the general rule
  in `references/design-guide.md` under "Backward compatibility".
- Finishing the deploy does not mean the migration is done: you need a waiting window long
  enough to be sure no old instance remains, and only then break the things only old instances need.
- Rows created after the deploy do not exist in the old column. Rolling back to old code loses
  that data. This is why dual-write exists, and why rollback after step 3 is no longer cheap.

The Contract step has no cheap way back. Say that out loud before doing it, and do not do it in
the same PR as another step.

## 5. Data migration

| Requirement | Concretely | Why |
| --- | --- | --- |
| **Idempotent** | Running it twice gives the same result; `WHERE ... IS NULL` conditions or `ON CONFLICT DO NOTHING` | A migration that dies halfway will be run again. Not idempotent = manual recovery |
| **Resumable** | Commit per batch, store a cursor, exit cleanly | A backfill job runs for hours; you do not want to restart from the beginning |
| **Batched** | By primary key, batches of a few thousand, `sleep` between batches | An unbounded query kills the connection pool and replication lag |
| **Has a kill switch** | A feature flag that stops the job immediately | You need to stop it within minutes when it is slowing production |
| **Is rate limited** | Limit per batch/second, reducing automatically as lag grows | A backfill competes with real traffic for the same table |
| **Reports progress** | Log rows processed, rate, ETA | Nobody dares leave a 3-hour job running with no progress |
| **Validates** | Compare row count, checksum, and business invariants before/after | "Done" has to mean the numbers match, not that the job ended |

**Dry run on a copy, never test on production.** Measure the time, the rows skipped, and the
error rate - on sanitised data, not real user data.

Why: the first run on production is the only one you cannot come back from, and it runs on more
data, at the same time, and slower than the copy. "It'll probably work" is the most expensive
sentence in this file.

When two shapes have to coexist for a long time (months, quarters):

- Define the **single source of truth** and write down where it lives in the repo. Two sources
  of numbers living together is drift waiting for the day it becomes an incident.
- If you are forced to read both, read in a clear precedence order and **log the disagreement rate**. That rate is the metric you put on a dashboard to know when it is safe to remove the old one.
- The feature flag that disables the old path must be a config value read immediately, not a
  code path.

## 6. API versioning and client compatibility

Classify before writing a single line:

| Change | Classification | Action |
| --- | --- | --- |
| Adding a new field, a new endpoint, an optional query param | **Additive** | Shippable |
| Renaming/deleting a field, changing a type, changing semantics, adding something required | **Breaking** | Both shapes during the deprecation window, measure usage, then remove |
| Changing a status code or error shape | **Breaking** | Old clients may be relying on it to render errors |

The deprecation principle: **what is not measured does not exist.** An endpoint marked
deprecated with no metric by `endpoint` and by `user/client id` is never removed, only pushed
into next year's backlog.

Measuring usage needs both: by endpoint (who is still calling) and by client version (who has
not upgraded). The second number is what decides the **removal date**, because old clients will
not upgrade on their own.

**Clients you cannot force to upgrade** - a mobile app already installed on user devices, an
integration script in a customer's cron, a browser cache and a service worker:

- The server has to tolerate old clients **longer than you
  want**.
- Versioned endpoints (`/v1`, `/v2`) separate contracts: `v1` is frozen, `v2` is where change happens. This is a different choice from additive + deprecation - use it when the contract changes a lot, not when you add one field.
- A Sunset header plus a concrete date in the response, so clients can warn themselves and log
  an error.
- If you cannot measure usage, keep both forever. Cheaper than one incident from cutting the
  wrong thing.

## 7. Upgrading dependencies and frameworks

| Thing | What actually happens |
| --- | --- |
| Jumping many majors in one PR | An unreviewable and **non-revertable** diff: reverting needs you to get back to exactly the old version set, and you have forgotten what it was |
| One major at a time | Each step is a small PR, reviewable, revertable. More expensive in PR count, an order of magnitude cheaper in risk |
| A codemod | Produces a thousands-of-lines diff that is **syntactically correct and semantically wrong** |
| Lockfile churn | Hides the real change, or contains a real change nobody reads |

On codemods: the generated output is a **draft that needs review**, not a result. Budget time to
read the semantic changes - lifecycle hooks, error handling, dependencies whose default behaviour
changed. That is the part that most often breaks. If a codemod touches >~50 files, split the PR: the
mechanical part in one PR, the semantic fixes in another. See `references/testing-guide.md` - here a
red test after a codemod is usually a real signal, not something to make green by loosening it.

Tell a lockfile-only diff apart from a real one - `npm ls <pkg>` shows the project's direct
dependency (not the transitive ones), `git diff --stat -- <lockfile>` shows the churn.

Lockfile-only means the versions of real dependencies did not change, only transitive ones.
That still needs a build + test + attention, but it does not need a code re-read. Conversely,
when the manifest does not change and the lockfile changes by thousands of lines: this is
security or reproducibility, and it needs the full suite, not just a typecheck.

For a large framework upgrade: run the suite before to get a baseline, and have a branch ready so
you can take the old suite's output as a reference. Without a baseline every failure is ambiguous.

## 8. Changes spanning multiple runtimes

A TypeScript frontend + a Go service + SQL migrations are **three different release trains**
with three different deploy speeds. The problem is not technical - the problem is designing so
that there is never a moment when all three must move together.

| Mechanism | How to use it | Why it is needed |
| --- | --- | --- |
| **Additive first** | The backend adds the new field first, the frontend reads it later | An old frontend does not break; the new backend does not depend on the frontend |
| **Expand-contract** | New column first, contract later (section 4) | SQL runs once, code runs many times - the reverse order is a deploy that never converges |
| **Feature flag** | The old path stays after the new path ships | Three runtimes out of step still have one correct path |
| **Compatibility matrix** | A table: which version of A is compatible with B | A test matrix becomes a real thing instead of an assumption |

Source of truth for a shared schema: **one place generates it, nobody types it by hand.**
Generate types/schema from one source and distribute them (`codegen` from the schema, or a
generated client from OpenAPI). Why: three hand-written schemas of the same thing drift within
about a sprint, and the error shows up at runtime instead of at compile time.

Define these three clearly, write them into the plan, before any code:

1. **Who deploys first**, and what has to exist for that not to break.
2. **Which versions are valid** during the window where the two runtimes are out of step - as long as the longest deployment, not the number of minutes you measured.
3. **The removal condition**: which metric reaching 0 lets you delete the old path, and who
   deletes it.

## 9. Signs a migration is going wrong

These are the signs you cannot fix by adding one more feature flag.

| Sign | What it means | Concrete way out |
| --- | --- | --- |
| **Rollback needs data intervention** | You passed the contract step, or dual-write stopped while the contract was already done | Stop all new deploys. Identify which expand-contract step is half-done. Restore readability with **one-way, scripted, re-runnable** data movement, not manual fixes. Record every manually handled row in the script |
| **Two sources of truth live in production** | Someone started writing to the second place while trying to migrate | Pick one source, write its name into the schema comment and into the doc. The remaining path becomes a read-only projection, not a second writable source |
| **A "temporary" flag is 8 months old** | The deprecation window never closes; the old path is now the main path | Set the removal date when you create the flag, attach an issue and a milestone. If it is overdue, convert the flag into an owner + deadline instead |
| **Nobody can name who owns the legacy path** | Nobody is accountable; it will never remove itself | Attach an owner by name. If you cannot find one, treat the old path as a production system that needs capacity and on-call |
| **Deploys have to be hand-timed** | There is hidden coupling between runtimes | Re-run the deploy in the wrong order once. If it breaks, the coupling is real: switch to additive + flag |
| **The "migration is done" number is "the job finished"** | You are measuring completion, not correctness | Compare row count and checksum before/after. Wrong data with a job exiting 0 is an incident, not a completion |
| **No test touches the old path any more** | The flag is switchable, so the old path is dead | This is the condition for removal. Not a problem |

## When to stop and ask

Ask before you touch anything, with a specific question and a recommendation attached:

- A migration with no cheap rollback: `DROP`, `NOT NULL` on an old column, renaming a column that is being written.
- A backfill on a large, hot table with no batch limit.
- Deleting an endpoint that has traffic.
- A large dependency upgrade at the same time as an architecture change.
- Two people editing the same migration seam.

## Self-check questions before handing over

| Question | No answer = not done |
| --- | --- |
| If it breaks at 3am, how do you turn it off, and who does it? | The rollback was never thought through |
| Is it safe to run this migration a second time? | Not idempotent yet |
| Which step of expand-contract am I on, and has the previous one been measured? | Frog-hopping |
| Which clients have not upgraded, and how many did I measure? | Cutting the wrong thing |
| Who is still calling the old path? | Not removable yet |
| A short description of what changed, separated from what was only refactored | The PR is not split |

Any row in that table without an answer backed by a command and numbers is **unverified**. And
that is most of the work here - not writing code.
