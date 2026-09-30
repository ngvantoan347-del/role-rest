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

`verify.mjs` exits non-zero when a gate fails and reports gates it could not find, so a
missing linter is never mistaken for a passing one. `smells.mjs` flags debt markers,
hardcoded secrets, swallowed exceptions, disabled tests, debug leftovers, type
suppressions, commented-out code, oversized files and functions, and source changes with no
accompanying test.

### Contents

```
catalog/
├── index.json                        HTTP catalog manifest
└── software-engineer/
    ├── SKILL.md                      the discipline: tiers, loop, non-negotiables
    ├── references/
    │   ├── discovery-playbook.md     reading an unfamiliar repo fast
    │   ├── stack-commands.md         real gates per ecosystem
    │   ├── plan-template.md          T2 and T3 plan formats, drift handling
    │   ├── design-guide.md           boundaries, contracts, data, migrations, security
    │   ├── testing-guide.md          what to test, test doubles, CI gates
    │   ├── anti-patterns.md          the smell catalog: symptom, cause, fix
    │   ├── git-workflow.md           commits, branches, PRs, secrets, recovery
    │   └── dod-checklist.md          Definition of Done + handoff template
    └── scripts/
        ├── verify.mjs                run the project's gates
        └── smells.mjs                audit the diff for debt
```

## Contributing

Open an issue describing a rule you want added, with the failure it prevents. Skill
changes follow the same discipline the skill teaches: small diff, tests for the scripts,
evidence that the skill still loads.

## License

MIT
