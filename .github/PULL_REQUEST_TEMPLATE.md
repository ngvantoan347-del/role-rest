## What this changes

<!-- One sentence. If the description needs a paragraph, the diff is too wide. -->

## The failure it prevents

<!-- Required for anything touching a rule, a check, or prose in the skill. -->

Every rule in this repo carries a reason, because a rule without one is a rule the reader routes
around. "This is best practice" is not a reason.

## Gates

<!-- Paste what these printed. CI checks them too, but the output in the PR is what a reviewer
     reads first. -->

```
npm test
npm run spec
npm run catalog
npm run gate
```

## Falsification

<!-- Required if you touched a script. Run `node skills/software-engineer/scripts/falsify.mjs` and
     paste the output, including any SURVIVED line with an explanation of why it is acceptable.
     If the report is right and your test is wrong, fix the test - not the report. -->

```
node skills/software-engineer/scripts/falsify.mjs
```

## Checklist

- [ ] `npm run catalog` passes. The manifest is not hand-edited and hoped.
- [ ] Every new rule states the failure it prevents.
- [ ] No check was added that cannot fail.
- [ ] Docs-only and behaviour changes are separate commits.
- [ ] Everything committed is English.
- [ ] A behaviour change has a test that builds a real fixture, not an eyeballed assertion.