# Discovery Playbook

Reading an unfamiliar codebase fast enough to change it safely. The target is ten minutes to a
correct plan, not a tour of the whole project.

Deep reading pays off only inside the radius that leads to a decision. Past that point it is
procrastination wearing the costume of diligence, and the user is waiting.

## 0. Ask the question first

Before reading anything, write one sentence:

> **Which observable behavior has to change, and what has to stay exactly the same?**

Everything you read serves that sentence. Interesting but irrelevant files get skipped. This
sentence is also the self-check at handoff time.

## 1. The 10-minute order

Run in this order, stop when you can name the file and the command that proves it.

| Step | Command | What it tells you |
| --- | --- | --- |
| 1. Shape | `ls`, `tree -L 2`, `git ls-files \| head -100` | Layout, monorepo or single |
| 2. Manifest | `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` | Language, framework, entry point |
| 3. **CI config** | `.github/workflows/*.yml`, `.gitlab-ci.yml` | **The canonical lint/typecheck/test/build commands** |
| 3b. **Who owns it** | `CODEOWNERS`, `.github/CODEOWNERS` | Which team this path belongs to - decides whether you ask before editing |
| 4. Entry point | `src/main.*`, `cmd/`, `server.ts` | How the system boots |
| 5. Seam | find the symbol / route / config key to change | Which module owns the behavior |
| 6. Nearest example | code that already does something similar | The pattern to follow |
| 7. Tests | the tests of the module about to change | Correct behavior, and the test pattern |
| 8. History | `git log --oneline -20 -- <path>`, `git blame` | Why the code looks like that |
| 9. Lock | lockfile, `engines`, `.nvmrc`, `rust-toolchain` | Toolchain constraints |

Step 3 is the most important one and the most often skipped. **CI config is the source of
truth** on what "green" means. The README says "run `npm test`" while CI runs `npm run
test:ci && npm run lint` with a coverage threshold - two different definitions of done.

In a monorepo, the CI config also tells you **how the gate is scoped**: affected-only or
whole-repo. If the pipeline runs affected, your local verification has to be scoped the same
way - running the full suite on your machine is the thing nobody does because it is too slow,
and that difference is why CI is green and your machine never is.

## 1b. In a multi-user repo

This step does not exist in a one-person project, and skipping it is the cause of editing
another team's code and handing them a red PR without understanding why.

- `CODEOWNERS` at `.github/CODEOWNERS` or the root: who owns this path. Editing it without
  asking is a violation, not a convenience.
- Where decisions live: `docs/adr/`, `docs/rfc/`, or `ARCHITECTURE.md`. Read before
  proposing anything that contradicts them.
- `CONTRIBUTING.md`, `.editorconfig`, linter/formatter config: the repo's conventions.
- `CHANGELOG.md` and release docs: which changes were ever considered worth writing down.

Details on how to work in that context: `references/enterprise-standards.md`.

## 2. Find the seam

Why: the real structure lives in which module calls which, not in the directory tree. The
tree tells you how the author *intended* to organize; imports are the evidence.

- **Search by symbol, do not walk the directory tree.** Search the function name, route,
  config key, or the error string you need. One step at a time.
- **The import graph is the boundary.** Who imports the module you are about to change?
  That is the **compatibility surface**. If `frontend` imports `db`, you are preparing a
  layer violation.
- **Wiring tells the truth.** Route tables, DI containers, plugin registries show what is
  actually connected - as opposed to what only exists on paper.
- **Data is where the risk is.** Schema, migrations, serialization boundaries must be read
  before you design anything that stores or sends data.

## 3. Read history when the code looks wrong

```bash
git log --oneline -20 -- path/to/file
git log -S "someSymbol" --oneline        # when this symbol came in / went out
git blame -L 40,90 path/to/file
```

Weird code is usually deliberate: a vendor bug, a one-off timezone fix, a workaround for a
framework bug. If `git blame` shows a commit fixing something right next to a line that
looks redundant, keep it - and add a comment explaining it if there is not one.

Deleting a "redundant" line is the fastest way to resurrect a bug fixed two years ago.

## 4. Evidence table

Keep facts with their source so the plan is verifiable and the handoff is citable.

| Fact | Source | Confidence |
| --- | --- | --- |
| Unit tests run with `npm test` | `package.json:scripts.test`, CI workflow line 42 | Verified |
| User creation writes to the `users` table | `src/repo/user-repository.ts:88` | Verified |
| Rate limit is enforced at the gateway | claim in the README only, no code found | **Unverified - ask** |

- A claim with no `path:line` or command output is a **hypothesis**, and you have to call it
  by that name.
- If a hypothesis matters, spend one more minute confirming it. Cheap now, expensive later.
- If you cannot confirm it, **ask the user**, do not build on it.

## 5. Signs discovery is done

- You can name exactly the files you will change, with a reason for each.
- You know the command that proves the change works.
- You know the existing test file to extend.
- You know the compatibility surface: who depends on what you are changing.
- You can describe the design in two sentences.

Stop here.

## 6. When to ask instead of read

Ask early, ask specifically, and bring options:

- Two plausible designs with clearly different costs.
- The request contradicts current behavior ("add a toggle" when there is no toggle).
- Anything touching auth, billing, data deletion, or compliance.
- A migration that cannot be rolled back cheaply.

One precise question is much cheaper than a wrong assumption frozen into a large diff.
