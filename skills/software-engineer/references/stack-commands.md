# Stack Commands

The project's own config wins: `scripts` in `package.json`, the CI workflow, or the `Makefile`
is the source of truth, not the table below. `node scripts/verify.mjs` detects them; this table
is what to look for when it finds nothing.

The paths here are relative to the directory holding `SKILL.md`: the skill installs into
`.agents/skills/`, `.claude/skills/`, or the OpenCode cache, a different location in each, so
invented absolute paths are only right on the machine of whoever wrote the skill.

Do not invent a command and report a result. If the project has no linter, say it has none -
do not pretend lint passed.

## Where to look, in order

1. CI config - `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`.
   **What CI runs is what "green" means.**
2. `package.json` scripts, `Makefile`, `justfile`, `Taskfile.yml`.
3. `pyproject.toml` / `tox.ini` / `noxfile.py`, `Cargo.toml`, `go.mod`, `composer.json`,
   `Gemfile`, `build.gradle`, `*.csproj`, `Rakefile`.

You have to know how long a gate **takes**. In a large monorepo the full suite can take 20
minutes - running it after every one-line edit is creating your own reason to skip
verification.

## Languages with no detector

`verify.mjs` detects gates for JS/TS, Python, Go, Rust, JVM, PHP, Ruby. For the things below
it has **nothing**, so this table is the only place you can find out:

```bash
shellcheck script.sh && bash -n script.sh          # Shell
clang-format --dry-run -Werror .                    # C/C++
ctest --test-dir build --output-on-failure          # C/C++
sqlfluff lint .                                     # SQL
your-db-migrate --dry-run                           # SQL, on a copy
docker build -t test . && docker run --rm test      # does the Dockerfile start
```

Two conditions are not in the command table and still have to hold:

- **SQL:** never apply a migration to a real database to "see if it runs".
- **Docker / Terraform:** an image that builds but does not start is not done. `terraform
  apply` against a real workspace is not done - `plan` only.

## Reporting

Name the command and the real result:

```text
Verification
- `npx tsc --noEmit`  -> clean, 0 errors
- `npm test`          -> 42 pass, 2 fail (both pre-existing, see below)
- `npm run build`     -> dist/ built in 3.1s
- `npm run lint`      -> not configured in this project
```

That is credible. "Tests pass" is not, and neither is silence about a gate you skipped.
