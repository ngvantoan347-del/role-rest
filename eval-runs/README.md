# eval-runs/

Output of the A/B runs described in `skills/software-engineer/tests/evals/evals.json`.

Each case gets two directories:

```
<case-name>/with_skill/output.md      the same prompt, with the skill loaded
<case-name>/without_skill/output.md   the same prompt, with no skill
```

Run `node skills/software-engineer/tests/eval.mjs --run` to print the spawn instructions, then
`node skills/software-engineer/tests/eval.mjs --grade eval-runs` to score them.

This directory is committed deliberately. An eval whose runs are never committed is an eval nobody
can re-check, and the claim "this skill helps" is exactly the kind of claim that needs its evidence
stored next to it.

`RESULTS.md` is the write-up: what the runs showed, what they cost, and what they cannot establish.

## What these runs do and do not establish

They show whether following the skill changes behaviour, and in which direction, for one model on
one sample. They do **not** establish that the skill beats a different skill, that it survives a
different model, or that the effect size is stable - there is no variance estimate from a single
run per arm. Read the outputs. The score line is a summary, not the evidence.

## Two iterations

`iteration-1/` used prompts that referenced files not present in this repo, so both arms correctly
answered "that file does not exist" and the skill's actual claims went untested. The fix, and the
reason it matters, is in `EVAL-DESIGN-NOTES.md`.

The current case set lives in `tests/evals/evals.json` with `fixture` blocks. Materialise one with:

```bash
node skills/software-engineer/tests/fixture.mjs uses-the-projects-real-gate /tmp/eval-gate
```

which writes a real codebase into a throwaway git repo the agent can read, run, and break.