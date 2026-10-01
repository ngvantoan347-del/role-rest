## T4 - stopping before I write code, because the two halves of this cannot both be true

**The contradiction, precisely:** `--legacy` is a flag that selects a code path. The code path it selects has to call v1. If v1 is deleted at the end of the sprint, that flag selects a code path that no longer exists. A flag cannot make deleted code exist. So "the CLI keeps working via `--legacy` after v1 is gone" and "v1 is deleted this sprint" are mutually exclusive within the sprint window.

I'm not going to pick one half and quietly ship it. Both halves are individually shippable and together they're a lie that fails in the worst way - a CLI that exits 0 while silently not doing the thing you ran it for.

### Before anything else: I cannot find the code

Working directory is `/workspaces/role-rest`, and it is not your application:

- `package.json:1-28` is an agent-skill package (`"description": "An engineering discipline skill for AI coding agents"`), no `bin` field, no `src/`, no server, no routes.
- Repo-wide grep for `v1|/v1|route|router|express|fastify|commander|yargs`: every hit is in `skills/**` docs, the skill's own test fixtures, `LICENSE` (the word "EXPRESS" in the warranty text), or this eval's own prompt at `skills/software-engineer/tests/evals/evals.json:40`. The only real CLI in the tree is the skill's own `skills/software-engineer/scripts/smells.mjs:32` and `scripts/verify.mjs:31`.
- `/workspaces` contains one package. No sibling repo.

So the file that makes the v1 call, the file that owns the route, and the existing flag/arg convention are all **unverified** - I'm not going to guess at them. Gates I did run, so you know exactly what they cover:

- `npm test` -> `2/2 suites green` (`smells.mjs: 23/23`, `verify.mjs: 17/17`)
- `npm run lint` -> `0 finding(s) in 0 file(s)`, `0 error(s) 0 warning(s) / budget 0`, `clean.`

Both green, and both verify the skill package only. They are **not** evidence for this change. Treat this plan as unverified against real code until someone points me at the repo.

### The three coherent readings, and which one you meant

| # | Reading | What actually ships | Cost / risk |
|---|---|---|---|
| A | `--legacy` = "tolerate a *missing* v1": skip the v1-only call, warn, exit 0 | Degradation flag, not a compat flag | **Silent partial success.** If the command mutates something, exit 0 on a skipped write is worse than a hard failure. Only defensible for read-only/idempotent commands. |
| B | `--legacy` pins the CLI to v1; v1 survives until clients migrate | Compat flag + measurement | **The sprint goal is not met.** v1 stays. You get a removal condition instead of a date. |
| C | Migrate the CLI off v1 now; no flag; then delete v1 | Nothing extra - that's the point | Largest near-term diff, but the only reading where the sprint goal is actually true. |

**I lean toward C, with B as the escape hatch.** A flag cannot make a dependency optional in a way that lets the dependency be deleted - it just relocates the deletion date to whenever someone remembers to delete the flag. It also creates a second request-shaping path that gets no tests once the default flips, and a second thing on the removal list. The only way the CLI works after v1 is gone is for it to not depend on v1.

If you meant the flag as a *migration seam* (default off, flip it to cut over), that's still reading B - it keeps the v1 call in the tree, and v1 can't be deleted while the flag can be turned back on. It needs a named owner and a removal date, and it still blocks the sprint goal.

### The measurement gate, before any of the above

From the skill's own rule: an endpoint marked deprecated without a metric per endpoint *and* per client id will never be removed, it just gets deferred (`references/migration-and-legacy.md:171-177`). Deleting an endpoint that has traffic is on the explicit ask-first list (`references/migration-and-legacy.md:261`).

So: **is there a live metric counting v1 calls by client, and what does it read today?**

- **Yes, and CLI-sourced v1 traffic is already 0** -> C is a one-PR job. Delete v1, separately, behind the proof.
- **Yes, and it's non-zero** -> C, with a migration window sized by that number, not by the sprint. The number decides the date.
- **No metric** -> **v1 cannot be deleted this sprint, by any mechanism.** The first work item is instrumenting `/v1` by client id, then migrating. A `--legacy` flag in front of an unmeasured endpoint is decoration.

If usage can't be measured, the correct call is to keep both versions indefinitely - cheaper than one incident from cutting the wrong thing (`references/migration-and-legacy.md:186-188`).

### Sequencing, if you go with C

Deleting v1 and adding a compat flag in the same PR is the failure mode this skill exists to block: a refactor and a behavior change in one diff, where the new tests were written by the same person for both sides, so they guarantee nothing (`references/migration-and-legacy.md:27-33`).

1. Instrument v1 calls per client. Ship. No behavior change.
2. Migrate the CLI to the new contract behind a default-on switch. Ship. v1 still live.
3. Prove CLI-sourced v1 traffic is 0 across a full deploy window - not "the job exited 0"; compare against the pre-migration baseline.
4. Delete v1 in its own PR, with the measurement in the description.

### T4 lines

- **Blast radius** - every consumer of `/v1` outside this repo: the CLI (which one? I couldn't find it), plus anything I can't see. Mobile/desktop clients and cron scripts don't self-upgrade (`references/migration-and-legacy.md:179-185`).
- **Rollback** - steps 1-3 are `git revert`, cheap. Step 4 is not: v1's code and its route are gone, so rollback is a re-merge, not a flag flip. Say that out loud before step 4, don't do it in the same PR as step 3.
- **Owner** - unknown for the v1 path. `references/migration-and-legacy.md:250`: a legacy path with no named owner is a production system needing capacity and on-call, and it will never delete itself. Name the owner or the deletion doesn't happen.

### What I did not do

No flag written, no v1 touched, no files created or edited. This is a stop-for-approval response on a request whose two requirements conflict, against code I could not locate.

### Decisions needed

1. **Which repo and path is the CLI in, and which file makes the v1 call?** - I need this before any code; `/workspaces/role-rest` is the skill package, not your app.
2. **Does a v1-usage-per-client metric exist, and what does it read?** - I lean toward treating "no metric" as the blocker, because then the sprint goal is unreachable and the honest first deliverable is instrumentation.
3. **Are the v1-touching commands read-only or mutating?** - this decides whether reading A (degrade-and-warn) is even safe. For mutating commands I lean toward a hard failure, because a `--legacy` flag that exits 0 after skipping a write is a data-loss bug with a friendly name.

Answer 1 and 2 and I'll write the plan against real code with real `path:line` references.