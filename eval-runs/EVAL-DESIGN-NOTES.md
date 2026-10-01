# Eval design notes

## A flaw in the first version of these evals

The first run of `evals.json` fed every prompt to an agent working in the `role-rest` repo itself.
Two of the five prompts assumed files that do not exist here (`src/parser.js`, an invoices table).
Both baselines correctly refused:

> `src/parser.js` doesn't exist in this repository. ... The only trace of `src/parser.js` on disk
> is the eval fixture quoting this exact prompt.

That is a refusal to hallucinate, and it is the right one. But it means the runs measured nothing
about the skill: the difficulty lived entirely in noticing the prompt referenced a non-existent
file, which both arms did equally well.

**Fixed:** every case now declares `fixture` files that are written into a throwaway repo before
the run. The agent gets a real codebase with a real bug, so the case measures what it claims to
measure.

## The second flaw, in the fixture itself

`uses-the-projects-real-gate` shipped a `paginate` implementation that was already correct. The
baseline caught it by probing, and said so rather than inventing a bug to fix. A fixture with no bug
measures nothing either, so the fixture now drops the last element of every page
(`slice(start, start + perPage - 1)`) and its test only covers the case that does not expose it.

Worth recording because it is the same failure as the first one: an eval is a claim about what it
measures, and an unexamined fixture is an unverified claim.

## What a fair A/B looks like here

Both arms get the same fixture and the same prompt. The only difference is whether the skill is
loaded. That answers exactly one question: *does following this skill change the output, for these
tasks, on this model, in this sample?*

It does not answer whether the skill is better than a well-written `CLAUDE.md`, or better than a
competing skill, or robust across models. Those need more arms and more runs than this harness has.

## On reading the results

Read both outputs. The score line is a summary of a regex, and a regex is exactly the kind of thing
this skill warns against trusting:

- A pass on "flags a rollback" is meaningless if the agent also invented a table it never saw.
- A fail on one check in the with-skill arm may be a *better* answer than a pass in the baseline.
  Over-hedging is a real failure mode of a rule-heavy skill and the checks cannot see it.

One run per arm gives no variance estimate. If a case is close, it is a coin flip, and the honest
reading is "no signal", not "small effect".

## Choosing cases that can discriminate

A case both arms ace teaches nothing. A case both arms fail on tells you the harness is broken.
The useful ones are where a competent model plausibly goes wrong without help:

| Case | Why it discriminates |
| --- | --- |
| `uses-the-projects-real-gate` | The bug is invisible to the existing test; quoting plausible-but-invented output is the default failure |
| `adds-a-test-for-a-new-behaviour` | A helper named "backoff" that has none, and a failure path with no test |
| `keeps-a-flag-from-becoming-permanent-debt` | "We can clean it up later" is how a flag becomes permanent debt |
| `does-not-leave-scaffolding-behind` | A green suite asserting a stub that accepts forged webhooks - the case the skill exists for |