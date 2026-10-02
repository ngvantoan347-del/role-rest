# Contributing

Thanks for looking. This file covers the two things a first contribution here usually gets wrong.

## Before you open a PR

**Run the gates.** They are the same three the skill ships, pointed at this repo:

```bash
npm test        # 75 tests across 4 suites
npm run gate    # verify + smells + falsify, on this repo
npm run spec    # SKILL.md against the Agent Skills format
npm run catalog # manifest matches disk, references resolve
npm run claims  # the prose describes the scripts that actually exist
```

`npm run gate` includes `falsify.mjs`, which breaks the changed code and requires the suite to go
red. If you see `SURVIVED`, your test does not catch that break - fix the test, not the report.

**Do not edit `catalog/index.json` by hand and hope.** `npm run catalog` fails if the manifest and
the tree disagree, which is the point. Add the file, run the check, it tells you what to list.

**Changing a script means changing its prose in the same commit.** `npm run claims` fails if
`SKILL.md` or a reference names a flag the script dropped, quotes an output string the script does
not print, cites an exit code the script cannot return, or mentions a mutation that is not in the
rule table. That check exists because the drift happened here: `falsify.mjs` was rewritten to
report by line and to state its reach, and the prose described the old version for two commits
while every other test stayed green. An agent reads `SKILL.md` and never opens the `.mjs`, so a
stale flag name is not a documentation bug - it is a wrong instruction handed to the thing this
repo is for.

## What a good change looks like here

The skill teaches a discipline; a change to it should show that discipline in itself.

- **Small.** A rule addition is a few lines. If your diff needs a paragraph to explain, split it.
- **Carries its reason.** Every rule in this repo has a "why" attached, because a rule without one
  is a rule the reader routes around. If you add a rule without a reason, it will not survive
  review, here or in the field.
- **Has a test.** The scripts have suites that build a real throwaway repo and assert on real
  output. A finding you have to eyeball is a finding someone else will get wrong.
- **Is falsifiable.** If you change what a script reports, `falsify.mjs` and its suite have to
  agree, or CI goes red.

## Adding a rule to `smells.mjs`

The rule set is data, not code - most additions do not need to touch the file. Put it in
`.software-engineer.json` and it works everywhere:

```json
{ "smells": { "rules": [ { "id": "my-rule", "severity": "error", "pattern": "\\bv1_\\w+\\b", "message": "v1 is decommissioned" } ] } }
```

Promote a rule into `BUILTIN` only once it is general - not because it is yours.

## Changing prose

Everything committed is English, including the reasoning inside the skill. Keep the register blunt
and declarative. Do not add hedging, do not add filler, and do not explain what the reader already
knows: the filter criterion at the top of each reference file says what does not belong.

Wrap prose at about 90 characters. Tables are the exception - rows stay readable rather than
wrapped at an arbitrary point.

## What will be rejected

- A rule with no stated failure it prevents. "This is best practice" is not a reason.
- A check that cannot fail. A gate that always passes is decoration, and it outlives every ticket
  you will open about it.
- Documentation changes with no behaviour change, bundled into a behaviour change. Split them.
- Suppressions with no `-- reason`. The scanner reports those, on purpose.

## Reporting a false positive

Open an issue with the rule id, the line it flagged, and why the flag is wrong. False positives
matter more than misses here: a scanner that cries wolf gets disabled by the team it was meant to
help, and then nothing catches anything.

The escape hatch for a real finding you are keeping is an inline allow with a reason - see the
README. It is a deliberate, reviewable decision, which is the whole difference between deferring
debt and hiding it.