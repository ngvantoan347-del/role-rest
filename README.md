# role-rest

Skills that turn [OpenCode](https://opencode.ai) from a code generator into a software
engineer.

## `software-engineer`

An engineering discipline skill. It enforces the boring things that make software
maintainable: read before writing, plan before coding, design the contract, build in small
verified steps, test what matters, keep docs alive, and report only what a command proved.

It exists because the default failure mode of AI-assisted coding is predictable: the diff
looks fine, the demo works, and the repo slowly fills with `quick fix`, `temp`,
`add later`, and `idk but it works`. This skill is the counter-program.

### Install

```bash
git clone https://github.com/ngvantoan347-del/role-rest.git
```

Then point OpenCode at `skills/`, globally or per project.

**Global** - available in every project:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["~/path/to/role-rest/catalog"]
}
```

**Per project** - copy it in and commit it, so the whole team gets it:

```bash
mkdir -p .opencode/skills
cp -r role-rest/catalog/software-engineer .opencode/skills/
```

**HTTP catalog** - no clone, OpenCode downloads and caches it:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["https://raw.githubusercontent.com/ngvantoan347-del/role-rest/main/catalog/"]
}
```

Restart OpenCode, or start a new session. Invoke it with `/software-engineer`, or let the
model load it when a task involves changing source files.

### How it behaves

Sizes the work first, so it does not slow down one-line fixes:

| Tier | Applies to | Process |
| --- | --- | --- |
| T1 trivial | typo, config value, one-line fix | Edit, run one check, report |
| T2 standard | one feature or bug following existing patterns | Short plan, implement, verify |
| T3 deep | new subsystem, data model, public interface | Full plan with options and risks, **waits for approval** |

The rules that matter most:

- **Evidence or it did not happen.** No "it should work now" - the handoff names the
  commands that ran and what they printed.
- **No deferred debt.** A `TODO` left in the tree needs an owner and a tracked issue.
- **No placeholders in shipped paths.** `return null`, empty bodies, fake data.
- **No unverified bugs.** Reproduce, failing test, root cause, fix the cause, explain it.
- **No silent scope changes.** If reality diverges from the plan, it stops and says so.
- **No secrets, ever.** Not in code, not in logs, not in commits.

### Scripts

Two dependency-free Node scripts ship with the skill. The agent uses them, and you can run
them yourself on any project.

```bash
# discover this project's typecheck / lint / test / build commands and run them
node scripts/verify.mjs
node scripts/verify.mjs --only test --dry-run

# scan the diff for the mechanical residue of vibe coding
node scripts/smells.mjs --changed
node scripts/smells.mjs --strict --json
```

`verify.mjs` detects the project's real gates from its own config - `package.json`,
`Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `mvnw`, and friends - then runs them.
It exits non-zero on failure and reports undetected gates as `MISSING`, so a project with
no linter is never mistaken for a clean one.

`smells.mjs` audits a diff for the mechanical residue only: debt markers, hardcoded secrets,
swallowed exceptions, disabled tests, type and lint suppressions, debug prints, stub
functions, commented-out code, oversized files, and source changes with no test. Judgment
smells - god objects, layer violations, copy-paste, scope creep - need a human, and live in
`references/anti-patterns.md` rather than in a regex.

### Contents

```
catalog/
├── index.json                        HTTP catalog manifest
└── software-engineer/
    ├── SKILL.md                      the discipline: tiers, loop, non-negotiables
    ├── references/                   loaded on demand, not on activation
    │   ├── plan-template.md          T2/T3 plan formats, plan-drift handling
    │   ├── design-guide.md           boundaries, contracts, data, migrations, security
    │   ├── testing-guide.md          what to test, test doubles, red suites
    │   ├── git-workflow.md           commits, PRs, secrets, history recovery
    │   ├── anti-patterns.md          judgment smells no regex can catch
    │   └── dod-checklist.md          Definition of Done + handoff template
    └── scripts/
        ├── verify.mjs                detect and run the project's real gates
        └── smells.mjs                audit a diff for mechanical debt
```

## Contributing

Open an issue describing a rule you want added, with the failure it prevents. Skill
changes follow the same discipline the skill teaches: small diff, tests for the scripts,
evidence that the skill still loads.

## License

MIT
