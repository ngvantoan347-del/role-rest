I checked before writing anything, and the task's premise doesn't hold up.

Two things in the request don't match the repo:

**There is already a test script.** `package.json` line 19 defines `"test": "node skills/software-engineer/tests/run.mjs"`, alongside `spec`, `catalog`, `lint`, and `verify:scripts`. I ran it and it's green:

```
  smells.mjs: 23/23 passed
  verify.mjs: 17/17 passed
  2/2 suites green
```

`run.mjs` discovers every `*.test.mjs` in the tests directory and runs each as a suite, so adding a new suite file is already supported. No script needs to be added.

**There is no retry helper.** The only files under `skills/software-engineer/scripts/` are `smells.mjs` and `verify.mjs`. I grepped the whole repo for `retry`, `backoff`, and `withRetry`; every hit is prose in the reference docs (guidance about retry/backoff/idempotency keys, which is the point of this skill) or the eval fixtures. No implementation exists.

So there's nothing to test. Writing a `retry.test.mjs` would mean inventing a module to test, which is guessing at an API - the module could take callbacks or promises, count retries or not, back off or not, and I'd be locking in all of that without any evidence about what's intended. That's the kind of move the skill itself warns about.

What I need from you: where is the retry helper? If it's in a different repo, an unmerged branch, or a file I haven't been pointed at, tell me and I'll test it. If it was supposed to be written first, say that and I'll implement it, then cover it. If the goal was just to confirm the test setup works, that's done above: `npm test` runs two suites, 40 assertions, all passing.