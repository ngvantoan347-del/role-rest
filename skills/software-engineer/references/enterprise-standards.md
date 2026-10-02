# Enterprise Standards

In a large company the rules existed before you arrived. How to find them, how to work inside
them without breaking them, and how to tell whether a change is yours to make.

Under deadline pressure, what gets dropped in a place with hundreds of engineers is not the
technique, it is who owns it. Fixing the right code in another team's area is the
fastest way to turn a T2 ticket into a 3am operations incident.

## 1. Where the standards live, and who can change them

The repo has already encoded rules nobody wrote down. Read them before guessing. The general
discovery order is in `references/discovery-playbook.md`; the table below only lists
artefacts specific to a large company.

| Artefact | What it tells you | Who owns changing it |
| --- | --- | --- |
| `.github/workflows/*.yml` | **What "done" really means**: which mandatory checks run, with what command | Platform/build team |
| `CODEOWNERS` (`.github/CODEOWNERS`) | Who approves which path, and when owner approval is needed | Each team owns its own lines |
| Linter / formatter config | What is banned, at what severity | Repo maintainer |
| `.editorconfig` | Indent, whitespace, newline at end of file | The repo, changed in its own PR |
| ADRs in `docs/adr/` | Decisions already closed - and what was ruled out, and why | ADR author, ratified by the architecture team |
| RFC doc | What is under proposal, who is waiting for review, the comment deadline | Whoever opened the RFC |
| Architecture doc | Layer boundaries, which dependencies are allowed | Architecture team |
| `CHANGELOG.md` | Which behaviour changed when, and who touched it | Whoever wrote the entry |
| `CONTRIBUTING.md` | Branch, commit, PR, review, release process | Maintainer |
| Release doc, automated release config, tags | How a release actually ships | Release manager |

**The README is a claim. CI config is the source of truth.** The README says "run
`npm test`" while CI runs `npm run test:ci && npm run lint` with a coverage threshold - two
different definitions of done, and CI is the second one. How to read CI config:
`references/stack-commands.md`.

- README and CI disagree: **report the mismatch**, and fix it in the first related change
  you open. Do not open a doc cleanup PR before you have standing in the repo.
- No artefact found: that is a fact, not an apology. Say "this repo has no CODEOWNERS, I
  will tag the owner when I open the PR" - do not guess the owner.
- Project config beats every general guideline, including this file.

## 2. Ownership: your code and their code

Check CODEOWNERS before you edit, not after CI goes red.

| Situation | Action |
| --- | --- |
| Path has no owner, or the owner is you | Proceed normally |
| Path is owned by another team, change is small and behaviour-neutral | Ask them first, or open a ticket on their board and wait |
| You must fix now and there is nobody to ask | Minimal change, state the reason, record who approved it in the PR |
| Another team is already working in that exact spot | Route through their ticket, do not fork |

Why: **a team that owns a path owns its on-call.** A line you change at 23h is their 23h,
and they do not know you touched it.

When you are forced to touch another team's code, three things are mandatory:

1. **Minimal diff.** No reformatting the file, no renaming variables, no tidying comments.
2. **A visible reason** in the PR description and commit message - not in the reader's head.
3. **The owner is notified** - tag the team in the PR, not just via the automatic approval.

One more thing: if your change turns their CI red, that is your incident until you push it
through. Do not let someone else discover it.

## 3. Conventions in an unfamiliar codebase

A file you touch is **not yours to restyle**. Read two or three files of the same kind before
you write the first line, then follow it: naming, error returns, comments, tests.

- Do not change indent, do not rename local variables, do not "tidy up" in a feature PR.
- If the convention is genuinely wrong or causing bugs: **split it into its own PR**, after
  the main PR merges. A silent fix is a change nobody reviewed.
- A convention that looks odd: ask `git log` before you conclude. Deleting a "redundant"
  line is the fastest way to resurrect a bug fixed two years ago.

Why: a bad but consistent convention is cheaper than a good but branching one. An aesthetic
diff mixed into a feature diff makes both unreviewable.

## 4. Cross-team contracts

Shared library, shared schema, event payload, protobuf - they are **public APIs with internal
company consumers**. Their blast radius is not inside the repo you have open; see
`references/scale-and-architecture.md` for how to measure it and how it propagates in a
monorepo and a shared package.

| Change | Blast radius | What it needs |
| --- | --- | --- |
| Add an optional field, keep the old one | Old consumers keep running | Same change, no window needed |
| Change a type, a meaning, a field name | Every consumer reading that field | Measure usage, dated deprecation window, migration note |
| Remove an export | Call sites fail to compile at consumers | Drive usage to 0 first, or a major version |
| Change default behaviour | Consumers do not know they changed | Bump major + a changelog entry that says so |

- Measure before you remove: grep the **whole workspace**, not just your repo. Shared
  package owners usually have the usage numbers already - ask, do not derive them.
- A breaking change in a shared contract = major version + migration note + a removal date,
  said out loud in `CHANGELOG.md`.

Why: inside a company, "one team" is what you can see. The fourth team whose name you do not
know is still calling that function when you delete it.

## 5. Decision records

A change is an **architectural decision** when it affects >1 team, or is expensive to undo
beyond a single revert. Then write an ADR or RFC: Context, Options, Decision, Consequences.
No code description, no diff summary.

| Change size | Artefact needed |
| --- | --- |
| Local fix, one file, undone by one revert | None. Record the reason in the commit |
| Internal change to a service, nothing calls it from outside | None. A comment at the site |
| Adding an abstraction from the second variant, inside the same repo | None. An ADR is noise |
| Changing a shared contract, infrastructure, storage, adding a service | **ADR/RFC** |
| A genuinely hard-to-reverse decision with two equal options | **ADR/RFC**, even when the code is small |

Why an ADR for a small decision is noise. Noise makes every real ADR get skipped while
reading, and the next person re-argues the old decision.

## 6. Branch protection, merge queue, release train

| Mechanism | What it forbids | What you must do |
| --- | --- | --- |
| Protected branch | Direct push, bypassing review | Every change through branch + PR |
| Required checks | Merging while CI is red | Verify locally **before pushing** |
| Merge queue | Pushing to a stale branch, merging once it has drifted | Rebase/re-merge when it goes red because the queue only builds the new commit |
| Release train | "Ship whenever it is done" | Ask for the cutoff date when you accept the work, not when you are finished |

**Your branch right now is someone else's latency.** A commit that breaks the build while
the merge queue is queuing blocks everyone behind it - including people with nothing to do
with it.

For a release train: ask for the cutoff when you accept the work. Asking after you have
already written it means you decided first and informed later, and often means rewriting it.

## 7. Working with review and CI

A red pipeline says **exactly one thing**: something failed. Read the log from the first
failing line, not the last - the last line is usually a consequence of a dependency or
environment error.

A green pipeline only says the checks in that pipeline are green. It does not say the
logic is right, not that there is no regression, not that it is safe at scale.

- **Never loosen a gate to get green.** No skipping tests, no disabling lint rules, no
  `--no-verify`, no adding `|| true`, no lowering the coverage threshold. See section 7 of
  `SKILL.md`.
- A gate broken on a branch you own: fix it there, in a small separate PR, with the reason
  the bug existed.
- A gate that was already broken, or that belongs to another team: **do not fix it
  silently**. Record it, report it, and if it blocks your verification say clearly that
  verification is blocked.
- Real gate commands per ecosystem: `references/stack-commands.md`.

## 8. Say the assumption at the moment you make it

An assumption kept in your head is work someone else has to carry. Say it **when you assume**,
not when it turns out to be wrong - by then they have already paid for it.

Every assumption worth saying needs one sentence: what I am treating as true, and why I
believe it.

| Situation | What to say |
| --- | --- |
| Editing another team's code, blocked | "I need to edit `<path>` because `<specific reason>`. N-line diff, no change to existing behaviour. Who can review this part?" |
| Changing a shared contract | "I propose adding field X, keeping the old field in this release. I need the consumer numbers for the old field - who holds them?" |
| Unsure about the release date | "The next train cuts on `<date>`. I need to know whether this makes it before I invest in it." |
| Vague requirement | "There are two ways: A `<...>`, B `<...>`. I lean towards A because `<reason tied to the goal>`." |
| A red gate that is not yours | "The pipeline is red at `<check>` since commit `<sha>`, unrelated to my change. I am leaving it alone and reporting it." |
| Guessing | "I could not confirm `<that thing>`. I am assuming `<assumption>` - if that is wrong then `<consequence>`." |

**When to stop and ask, when to proceed and flag it:** stop when reversing it is expensive -
migration, deleting data, changing a public contract, touching auth or billing, or touching
another team's path. Proceed when reversing it is one command, and flag the assumption in
the PR. The full table is in "Don't stand in the wrong place" in `SKILL.md`.

When a change touches user data, the part you have to prove with code is not here - it is in
`references/compliance-and-data.md`.

## 9. Entering an unfamiliar service

Reading order, stopping when you have enough to fix it safely:

1. **Architecture doc / README** - a claim, not yet a fact.
2. **The entry point and one real request**, top down: route → handler → service →
   storage. Write down the places that do not connect.
3. **The two modules that own most of the traffic** - that is where bugs cost the most.
4. **The on-call runbook and the alerts that are enabled** - read it to learn where people
   look at 3am.
5. **The three most recent incidents** (incident tracker, `git log --grep`). They say where
   the system actually breaks, written in the language of incidents, not of architecture.
6. **Config and environment variables** - anything with no default is a chance to break at
   deploy time.
7. **CODEOWNERS** - so you know who to ask.

**Stale docs are normal.** A system outruns its docs. Do not fix the docs on day one; verify,
note the mismatch, then fix it in your first related PR.

How to know what is true: read the code, read the tests (a test is behaviour already
asserted), read the config that actually deploys, and ask exactly one person on that team.
When those four sources roughly agree, you understand the service.

## Continuity

`references/review-playbook.md` covers the rest of the loop: reading someone else's diff,
self-reviewing your own change before opening the PR, and when to block.
