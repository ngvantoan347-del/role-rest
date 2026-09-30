# Discovery Playbook

How to read an unfamiliar codebase fast enough to change it safely. Target: ten minutes
to a defensible plan, not an exhaustive tour.

## 1. Frame the question

Before reading anything, write down in one line: **what observable behavior must change,
and what must stay identical?** Everything you read should serve that sentence. If a file
is interesting but irrelevant to that sentence, skip it.

## 2. Ten-minute protocol

Run these in order, stop when you can name the files and the verification command.

| Step | Command (adapt to the stack) | What you learn |
| --- | --- | --- |
| 1. Shape | `ls`, `tree -L 2`, `git ls-files \| head -100` | Layout, monorepo vs single package |
| 2. Manifest | read `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `pom.xml` | Language, frameworks, scripts, entry point |
| 3. Gates | read CI config (`.github/workflows/*`, `.gitlab-ci.yml`, `azure-pipelines.yml`) | The **canonical** lint, typecheck, test, build commands. CI is the source of truth, not the README. |
| 4. Entry point | `src/main.*`, `cmd/`, `server.ts`, `manage.py`, `index.ts` | How the system starts, what wires what |
| 5. The seam | search the symbol, string, or route you will change | The module that owns the behavior |
| 6. Nearest example | find existing code that does something similar | The pattern to mirror |
| 7. Tests | find tests for the module you will change | The real intended behavior, and the pattern to follow |
| 8. History | `git log --oneline -20 -- <path>`, `git blame <file>` | Why the code looks the way it does |
| 9. Locks | lockfiles, `engines`, `.nvmrc`, `rust-toolchain` | Toolchain constraints you must not violate |

## 3. Find the seam

- **Symbol search beats file browsing.** Search for the function, route, config key, or
  error string you care about. Follow the call graph outward one hop at a time.
- **Import graph is structure.** Who imports the module you are about to change? Those
  callers are your compatibility surface. If `frontend` imports `db`, you are about to
  create a layer violation.
- **Wiring tells the truth.** Route tables, dependency-injection containers, and plugin
  registries reveal which components are actually connected, versus merely present.
- **Data is where the risk is.** Find the schema, migrations, and serialization
  boundaries. Read them before designing anything that stores or sends data.

## 4. Read history when code looks wrong

```bash
git log --oneline -20 -- path/to/file
git log -S "someSymbol" --oneline        # when was this introduced or removed
git blame -L 40,90 path/to/file
```

Weird code is often deliberate: a vendor quirk, a timezone bug fixed in place, a
workaround for a framework bug. If `git blame` shows a fix commit next to a line that
looks redundant, keep it and note why in a comment if there is no comment.

## 5. Evidence table

Keep facts with their source so the plan can be checked and the handoff can cite them.

| Fact | Source | Confidence |
| --- | --- | --- |
| Unit tests run with `npm test` | `package.json:scripts.test`, CI workflow line 42 | Verified |
| User creation writes to `users` table | `src/repo/user-repository.ts:88` | Verified |
| Rate limiting is applied at the gateway | README claim only, no code found | Unverified - ask |

Rules for this table:

- A claim with no `path:line` or command output is a hypothesis, and must be labeled.
- When a hypothesis matters, spend one more minute to confirm it. Cheap now, expensive later.
- When you cannot confirm it, ask the user instead of building on it.

## 6. Signals that you are done exploring

- You can name the exact files you will modify and the reason for each.
- You know the command that will prove the change works.
- You know the existing test file to extend.
- You know the compatibility surface (who depends on what you are changing).
- You can describe the design in two sentences.

Stop there. Investigating the whole repository is procrastination with good posture.

## 7. When to ask instead of explore

- Two plausible designs with materially different costs.
- Requirements that contradict existing behavior ("add a toggle" when there is no toggle).
- Anything touching auth, billing, data deletion, or compliance.
- A migration that cannot be reversed cheaply.

One precise question is cheaper than a wrong assumption baked into a large diff.
