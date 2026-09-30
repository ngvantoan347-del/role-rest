# Stack Commands

Canonical gates per ecosystem. Use these as a starting point, but **the project's own
config wins**: `package.json` scripts, the CI workflow, or a `Makefile` is the source of
truth. Run `node <skill-base>/scripts/verify.mjs` to detect what this project really uses.

Never invent a command and report its result. If the project has no linter, say so; do not
pretend linting passed.

## Detection order

1. CI config - `.github/workflows/*.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml`,
   `.circleci/config.yml`. Whatever CI runs is what "green" means.
2. `package.json` scripts, `Makefile`, `justfile`, `Taskfile.yml`.
3. `pyproject.toml` / `tox.ini` / `noxfile.py`, `Cargo.toml`, `go.mod`, `composer.json`,
   `Gemfile`, `build.gradle`, `*.csproj`, `Rakefile`.

## JavaScript / TypeScript

| Gate | Command |
| --- | --- |
| typecheck | `npx tsc --noEmit` |
| lint | `npm run lint` (eslint / biome) |
| format check | `npx prettier --check .` |
| test | `npm test` |
| build | `npm run build` |
| audit | `npm audit --omit=dev` |
| unused deps | `npx depcheck` |
| outdated | `npx npm-check-updates` |

```bash
# one-shot gate, matching what CI usually does
npm run lint && npx tsc --noEmit && npm test
```

Watch for: `strict` in `tsconfig.json`, lockfile committed, `engines` matching the runtime,
`"type": "module"` consistency, and no `any` accumulating in public signatures.

## Python

| Gate | Command |
| --- | --- |
| lint | `ruff check .` or `flake8 .` |
| format | `ruff format --check .` or `black --check .` |
| typecheck | `mypy .` (strict mode) |
| test | `pytest -q` |
| coverage | `pytest --cov --cov-report=term-missing` |
| deps | `pip-audit` or `safety check` |

```bash
ruff check . && ruff format --check . && mypy . && pytest -q
```

## Go

```bash
gofmt -l .            # non-empty output = formatting problems
go vet ./...
go build ./...
go test -race -cover ./...
```

`-race` is worth the extra time. Watch for: errors wrapped with `%w` and not dropped,
context propagated into every call, and goroutines with a clear shutdown path.

## Rust

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo audit        # or cargo deny check
```

## Java / Kotlin

```bash
./gradlew build          # compiles, tests, lint
./gradlew check          # tests + static analysis
./gradlew spotlessCheck # or ktlint
```

## C / C++

```bash
clang-format --dry-run -Werror .
cmake --build build --target all
ctest --test-dir build --output-on-failure
```
If the project has sanitizers enabled, run them; they find the bugs tests miss.

## SQL

```bash
# lint the schema
sqlfluff lint .
# migration dry run against a scratch database
your-db-migrate --dry-run
```
Never apply a migration to a real database to "see if it works".

## Docker / infra

```bash
docker build -t test .
docker run --rm test          # does the image actually start?
docker compose config         # is the compose file valid?
```
A Dockerfile that builds an image which does not start is not done.

## Shell

```bash
shellcheck script.sh
bash -n script.sh
```

## Monorepos

- Run gates for the **affected** package, not the whole tree, then confirm nothing
  downstream broke.
- Check the lockfile and dependency graph after any package change:
  `pnpm list --depth 1`, `npm ls`.
- Workspace scripts usually expose the right invocation (`pnpm -F pkg test`).

## What to report

Name the commands and their actual results. This is the whole point:

```text
Verification
- `npx tsc --noEmit`  -> clean, 0 errors
- `npm test`          -> 42 passed, 2 failed (both pre-existing, see below)
- `npm run build`     -> dist/ built in 3.1s
- `npm run lint`      -> not configured in this project
```

That is trustworthy. "Tests pass" is not, and neither is silence about the gate you skipped.
