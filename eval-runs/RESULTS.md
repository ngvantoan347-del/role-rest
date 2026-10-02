# Results

## The question this repo has to answer honestly

Does following this skill produce better output than not following it? The author is the wrong
party to answer that, so the comparison is run: the same task, twice, once with the skill and
once without, graded against assertions written before the outputs are read.

One model, one run per arm, 8 runs. **That cannot estimate variance**, and it does not compare
against a good `CLAUDE.md` or a competing skill — which is what a team is actually choosing
between. Read the outputs. The score is a summary.

## What the first A/B showed

Five cases in `iteration-1/`. Both arms found the same substantive bugs on all three that were
runnable — including things no author of the fixtures had designed for, like `retries: 0`
resolving `undefined`, `retries: N` counting total attempts rather than retries, and every 4xx
being retried.

Three cases measured nothing at all: their prompts referenced files that do not exist in this
repo, so both arms answered "that file is not here", which is correct and tells you nothing.

**Conclusion from iteration 1: prose does not beat a strong model at reasoning. It supplies
structure, not insight.** Both skill-loaded answers ran about 60% longer than their baselines,
which is a real cost paid on every T3/T4 task.

## What the second A/B showed

Four cases rewritten with `fixture` blocks, so the agent works on real code with a real bug
(`tests/fixture.mjs` materialises them). This is where the signal was.

| Case | With skill | Baseline | What the skill added |
| --- | --- | --- | --- |
| `uses-the-projects-real-gate` | Fixed the off-by-one, added 4 regression tests, proved them red before fixing, exhaustive partition probe | Fixed the off-by-one, probe verified the result | Regression tests, and proof they were red first |
| `adds-a-test-for-a-new-behaviour` | 3 blockers, plus **mutation testing**: 3 mutants, 1 red and 2 green | 3 blockers, probe harness | Named the untested failure path |
| `keeps-a-flag-from-becoming-permanent-debt` | Proved the flag branch unreachable and the suite **still green**, then made the flag a contract with a CI-enforced expiry | Noticed the two flows are identical, stopped and reported | Turned a noticed oddity into a demonstrated gap, then closed it |
| `does-not-leave-scaffolding-behind` | Refused to invent a signature scheme; named the trap as a "self-certifying fake" | Refused to implement; named the same conflict | Sharper reason for refusing |

**The pattern, consistent across all four: the skill did not find a bug the baseline missed. It
added one more verification step, and that step was usually the difference between a suspicion
and a demonstration.**

That is the product, and it is a narrower claim than "be a better engineer". It is also the
claim the repo now ships:

- `falsify.mjs` mechanises the step the skill arm reached for by hand.
- `verification-techniques.md` is the ladder, with the stopping rule.
- The prose that taught what a strong model already knows was cut.

Note what the runs did **not** establish about `falsify.mjs`. The A/B compared the *skill*, and the
skill arm reached for falsification by hand; the script was written afterwards. Nothing here
measures it. The only evidence anyone has is that it found two gaps in this repo's own code on
first run - which is one tool catching bugs in itself, not a benchmark.

## What it costs

SKILL.md body went from 17,507 chars (~4,400 tokens) to 8,971 (~2,200) — a **49% cut**, paid on
every task the skill matches. The cut was the duplicated "things no tool catches" table, the
non-negotiables a model already follows, the Vietnamese opening paragraph, the universal
engineering knowledge in `design-guide.md`, the per-ecosystem command tables that `verify.mjs`
detects, and the `git reflog` recovery section.

## Known limits of this evidence

- One model. Nothing here says the effect survives a different model.
- One run per arm. A close case is a coin flip.
- No comparison against a competing skill, which is the real alternative.
- The fixtures are small. The `does-not-leave-scaffolding-behind` case is the one the skill
  claims to exist for, and it is 20 lines of code.

A team deciding whether to adopt this should run these cases themselves against their own model
and their own tasks: `node tests/eval.mjs --run`, then `--grade <dir>`.