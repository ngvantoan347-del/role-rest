A `--legacy` flag that "makes it keep working after we delete v1" can't exist. Either the flag routes to code that still exists, or it doesn't. If v1 is gone, the flag is a dead branch pointing at nothing, and the CLI silently takes the new path while printing a flag that lies about what happened.

Picking one half silently is the bad outcome here, so I want to name it and pick deliberately instead.

**Before that, a second blocker: there is nothing in this repo to apply it to.** This is a single-package skill repo (`role-rest`, `"private": true`). There is no product CLI and no HTTP API - no `src/`, no server, no route table, no `/v1`. The only argument parsing that exists is `skills/software-engineer/scripts/smells.mjs:32-42` (`--changed`, `--staged`, `--strict`, `--format`, `--base`, `--config`, `--no-color`) and the test harness. So "the CLI" and "v1" have to be a different repo, or a system I can't see. Tell me which, and I'll go look.

**What I suspect you actually want**

Reading it charitably, this looks like one migration with two milestones collapsed into one sentence. The coherent version, which is also what `skills/software-engineer/references/migration-and-legacy.md:84-93` already prescribes:

1. **Now (this sprint):** ship v2 behind a seam, default it on, measure v1 traffic falling toward zero. Keep v1 callable.
2. **Later, separate PR:** delete v1, once usage is 0 and v2 has coverage.

That last point is the one your deadline is fighting. The doc is blunt about step 4 - `Giu legacy impl trong tree cho toi khi so lieu usage ve 0` - and the reason is `Khong con duong lui neu da xoa`: once it's deleted, there's no rollback. A sprint deadline is not a usage metric, and nobody can tell me here what v1's current call volume is. Deleting v1 on a calendar while traffic is still non-zero means the next incident has exactly one option.

The flag's job in that sequence is to let you flip traffic back **instantly**, not to outlive the deletion. Note the doc's constraint at line 92: the switch must be flippable *without a deploy*, or every rollback is another deploy at 3am. That requirement shapes the implementation far more than the flag name does - if v1 and v2 differ per-request rather than per-version, you want a runtime config read or a remote flag, not a process-level boolean.

**What I need from you**

- **Which repo/CLI?** This one has no candidate.
- **What's the seam?** Is v1 vs v2 an HTTP route, a module interface, or a client SDK behind the CLI? It changes the shape of the work.
- **What is v1's current usage, and what does zero mean** - zero requests, or zero *known* requests (i.e. zero after telemetry, or after 30 days of no calls)?
- **Does "deleted" mean removed from the tree, or turned off and left in place?** These are very different risks, and only the first is irreversible.
- **Is the flag for a CLI *user* or for *you*?** A user-facing `--legacy` becomes a supported contract you're obliged to keep. A rollout toggle you own is much cheaper to remove later.

Give me the repo and I'll do the seam + telemetry work and put up a plan with the deletion as its own revertible PR. I won't write the flag until we agree which of the two halves it's serving.