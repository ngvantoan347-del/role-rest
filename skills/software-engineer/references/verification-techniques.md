# Verification Techniques

A lookup table: **where to stop**, and **which verification step is worth paying for next**.

Filter: only techniques a competent agent **does not reach for on its own** while doing ordinary
work. This was measured. On review and bug-fix tasks the model already finds the serious bugs - a
missing backoff, `retries: 0` resolving `undefined`, an off-by-one, an IDOR with no scope. What it
does not do unprompted is **mutation testing** and **prove-it-red**. So this file is about those,
not a restatement of what everyone already does.

## 0. The stopping ladder

Do not run all of it. Stop when **the last step no longer changes your conclusion**.

| Work tier | Stop at | Why there |
| --- | --- | --- |
| Typo, comment, config | Run the related test, done | A 20-minute full suite for one line is how you teach yourself to skip verification next time |
| Bug fix in one module | **Prove-it-red** -> fix -> green | The regression test is the only thing stopping that bug returning |
| New behaviour | **Prove-it-red** plus targeted mutation | You wrote both the code and the test; one of them can be wrong at the same time |
| Fixing or reviewing someone else's code | **Mutation test what you touched** | You did not write the test, so you do not know what it guards |
| Touching data, money, or permissions | All of it, plus a rollback that has actually been run | Nothing above catches a wrong write |

## 1. Prove-it-red

Write the test **first**, run it, watch it fail, then fix.

Why this is the highest-value step in the file: a test written *after* the fix is almost always
green, because you wrote it to match what you just did. A test written first is the evidence that
the test asks anything.

```bash
# 1. write the test, do not touch the source yet
npm test 2>&1 | tail -5     # expect: red, and for the right reason
# 2. fix
npm test 2>&1 | tail -5     # expect: green
```

Red because of a `SyntaxError` is not prove-it-red. Red because the assertion failed is.

## 2. Delete-and-observe

The question: **if I delete this feature, does the test go red?**

```bash
git stash            # or: break it temporarily on a scratch branch
npm test 2>&1 | tail -3
git stash pop
```

Why: a test asserting `handleWebhook({})` returns `{ ok: true }` is green, and it is also green
with every implementation. It guards behaviour nobody wants. The cheapest way to see that is not to
read the test - it is to delete the code and run it.

This is the cheapest technique in the file, and the one agents skip most, because it breaks code.

## 3. Mutation testing - the step an agent does not take

Break the code **on purpose**, the way a bug would, and require the suite to go red. Red means the
test holds; green means the test does not guard that.

```bash
# mutant: swallow the error instead of rethrowing
cp src/client.js /tmp/client.bak
# remove the `if (i === retries - 1) throw e` line
npm test 2>&1 | tail -3      # expect: RED. Green means the failure path is untested.
cp /tmp/client.bak src/client.js
npm test 2>&1 | tail -3      # confirm it is back
```

Why this is the most important section here, and the one measured to be absent without prompting:
the model reads the code, finds it plausible, and reports "looks fine". Without a mutant, "looks
fine" is a feeling. Measured: on a retry helper, the "swallow the error" mutant stayed green -
meaning a build in which every failure is reported as success passes the entire suite.

Choose mutants from the **failure branch**, not from all the code. Removing a throw, removing an
await, inverting a condition, dropping a guard. Three to five mutants over what you just touched
is enough; mutating an entire codebase is a different and much more expensive job.

`node scripts/proof.mjs` does all of this mechanically, over every changed file.

## 4. Run it, do not just read it

For pure logic, an exploratory script answers what reading cannot.

```js
// What does `retries: 0` actually do? Run it rather than reason about it.
for (const n of [0, -1, 1, 3]) {
  const r = await call(() => { throw new Error('x') }, { retries: n })
  console.log(`retries=${n} ->`, r)
}
```

Why: this is how you find that `retries: 0` resolves `undefined` without throwing, and that
`retries: N` means N **attempts** rather than N **retries**. Both are bugs that only appear when
you run, and both are missed by a model that reads the code.

## 5. Compare against a human in the repo

Do not ask "is this code correct" - ask "how does this repo do the same thing elsewhere".

```bash
grep -rn "catch" --include='*.ts' src/ | head   # do they swallow or log here?
grep -rn "retries" --include='*.ts' src/       # is the convention "attempts" or "retries"?
```

Why: an implementation that is correct but off-convention is a future incident, because everyone
reading it afterwards understands the opposite.

## 6. Measure what can be measured

When there is a number, measure instead of arguing. For any change with a performance or size
impact:

```bash
time npm test                       # before
# change
time npm test                       # after
```

Why: "faster" cannot be verified and nobody checks it. `0.047ms for three attempts` is a number
with weight; it turns "there is no backoff" from an opinion into a finding.

## 7. What not to measure

Skip these, because they cost time without changing a decision:

| Technique | When to skip it |
| --- | --- |
| Coverage % | Use it to **find** untested branches, not to hit a number |
| Load testing | Before something shows a bottleneck |
| Full E2E | The change does not touch a critical user path |
| Refactoring for cleanliness | Not in the ticket |
| Tests for code that is about to be deleted | That is debt with an expiry date, not an asset |

## 8. When the last step was enough

Stop when the final step **does not change your conclusion** - you tried the thing that, had it
failed, would have made you do something different, and it did not fail.

| You are about to say | Verification step still missing |
| --- | --- |
| "Done" | Run the real gate, paste the real output |
| "Tests pass" | Prove-it-red, to be sure the test asks the right question |
| "That is covered by a test" | Delete-and-observe |
| "It is only a small change" | Run the scripts; do not trust your eyes |
| "Reviewed it, nothing looks wrong" | Mutate what you touched |

## Context

The techniques in sections 1, 2, 4, 5 and 6 are what a model does on its own when reading code
carefully, so they are here as reminders, not lessons. **Section 3 is the one it does not do**, and
it is measurably the one that matters: a green suite can hide a failure branch with no test at all.