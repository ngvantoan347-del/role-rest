# Outreach

Everything here needs a GitHub token, which I do not have. So these are written to be posted,
not to be pasted. Each one is a complete artifact: title, body, links, and the reason it is worth
opening.

**Before posting any of them, read [When not to](#when-not-to).** Two of the four drafts are only
honest if they come with the finding that contradicts their own repo, and that matters more than
the impression.

---

## Why each one is worth a maintainer's time

The pitch is not "look at my repo". Every draft below contains a reproducible result the recipient
can run in under a minute, about their own project, that they do not currently get. That is the
only kind of post that gets answered. Asking for stars gets archived; a result gets a reply.

---

## 1. first-fluke/oh-my-agent — "your judges check artifacts; this checks one specific artifact"

Their README line is *"Agents narrate success. We check the artifacts."* That is the same thesis
mine is built on, which makes it the best possible target: the maintainer already agrees with the
premise and is arguing about the mechanism.

The useful contribution: their artifact checks verify that a file exists and has a shape. None of
them can tell whether the **tests** in that artifact would fail if the code were wrong. Those are
different artifacts, and the gap between them is where an agent's "tests pass" survives.

`npx skills add ngvantoan347-del/role-rest`

```markdown
Title: Your artifact checks stop one step short: they never ask whether the tests would fail

Hi - your thesis is "agents narrate success, we check the artifacts", and I think that is the
right frame. I built the same idea from the other end and hit a specific gap I could not find
closed anywhere in the agent tooling ecosystem, so I am putting it here rather than in a repo.

Your artifact checks answer: does the file exist, does it have the right shape, is the field
there. What none of them can answer is whether the *tests inside the artifact* would go red if
the code were wrong. Those are different artifacts. An agent that writes a test asserting the
happy path has produced a well-formed artifact that would not notice a broken guard.

So the gap is: every harness I have found verifies the claim was *made*, not that the claim would
*fail if wrong*.

https://github.com/ngvantoan347-del/role-rest

I wrote one thing that closes it. It mutates one line at a time - deletes a throw, inverts a
comparison, drops a guard - and requires the suite to go red for each. If a break survives, that
exact line has no test.

```
$ node skills/software-engineer/scripts/falsify.mjs

falsify  /srv/checkout-service

  baseline: suite green. Now breaking it on purpose.

  caught   swallow-error 1/3  src/checkout.js:2      a failure reported as success
  SURVIVED swallow-error 2/3  src/checkout.js:4      a failure reported as success
  SURVIVED unguard 2/3        src/checkout.js:4      a guard clause that no longer guards

  4 break(s) survived in 1 file(s). Those lines have no test.

    src/checkout.js
      :4     swallow-error, unguard
```

Two things I got wrong doing this, in case either is interesting to you:

1. I originally mutated every match in a file at once. It reported 2/2 caught on a file with one
   covered guard and two untested ones, because the tested guard stood in for the other two.
   Per-site mutation is what makes "that branch specifically has no test" sayable at all.
2. I originally counted a suite going red on a syntax error as a caught mutation. It inflates the
   score with sites that were never exercised. Every candidate goes through `node --check` first
   now.

Zero config, no install, scoped to the diff, about a second per break. That is the whole reason it
gets run and Stryker does not - and I do not think this is a replacement for Stryker, I think it is
the thing you would run inside the loop between reading a diff and answering, which is a moment no
existing gate fits into.

I am not asking you to adopt it. If you think the gap is already closed somewhere I have not found,
I would genuinely like to know where - that is the most useful reply this could get.
```

**Why this is worth posting:** the maintainer is already solving this problem, the gap is
precisely stated, and the post ends by asking to be corrected rather than for praise.

---

## 2. vercel-labs/skills — a discovery bug worth more than my skill is

This is the one with the highest expected value and it is not a pitch. `skills.sh` is the discovery
channel every Agent Skills repo depends on, and there may be a real bug in how it indexes.

Their canonical layout is `skills/<name>/SKILL.md` and mine matches. But their index has 16,793
owners and this repo is not among them, with 0 stars and a description of `-skills`. I need to know
whether that is because it has not been crawled yet or because something about it is invisible to
the crawler. If it is the second, thousands of repos could be silently unlisted.

```markdown
Title: Question about indexing: is a 0-install repo invisible, or just uncrawled?

I am trying to work out whether my repo is unlisted because of a real indexing constraint or
because it simply has not been crawled yet, and the answer changes what I should do.

https://github.com/ngvantoan347-del/role-rest

Facts I can establish from outside:
- The layout matches the canonical one. `skills/software-engineer/SKILL.md` with lowercase
  kebab-case name matching the directory, valid frontmatter.
- `npx skills add . --list` finds it. Found 1 skill.
- `skills.sh/sitemap-owners.xml` lists 16,793 owners. This repo is not among them.
- The repo has 0 installs, 0 stars, and its GitHub description was auto-set to `-skills`.

My question is the second-to-last point. If ranking or listing is derived from install counts,
then a new repo has no path to being listed, and being listed is what would generate the first
install. That would be a bootstrapping problem rather than a bug, and I would rather spend my
effort on the README than on guessing.

If instead listings are crawled independently of installs, then something about this repo is
invisible to the crawler and I would like to know what, because I suspect other repos are in the
same position and do not know it.

Happy to be a test case - give me a curl or a CLI command that tells me what the indexer sees for
a given repo and I will run it.
```

**Why this is worth posting:** either answer is useful, and if it is a bootstrapping problem the
answer applies to every new skill in the ecosystem. Low risk, genuinely curious question.

---

## 3. cloudflare/security-audit-skill — a structural question about validation

23.5k stars, one skill, tiny repo. Their approach is the opposite of mine and the reason it worked:
one narrow job, deterministic validators that *fail*, machine-readable output validated against a
schema.

That gives me a question I cannot answer from outside. My `falsify.mjs` has no schema. Its output
is a human-readable transcript, because the consumer is an agent reading a diff. But that means
nothing machine-checks its claims, and I am not certain that is the right trade.

```markdown
Title: Question on your validator pattern: is the human-readable transcript deliberately the wrong call?

Your repo is the clearest example I found of validators that fail rather than prose that advises -
validate-coverage-ledger.cjs, validate-findings.cjs, findings.json checked against a schema.

I built the opposite and I am unsure it was right. `falsify.mjs` breaks code one line at a time
and requires the test suite to go red, then prints a transcript naming the lines with no test. No
schema, no JSON mode.

My reasoning for the transcript: the consumer is an agent reading a diff, and the output it needs is
"these lines have no test, go write the assertion". A schema would be a second format to keep
honest, and I did not trust myself to maintain it.

The cost is real though - nothing machine-checks that the output is complete, and I already shipped
one case where a run reported a clean result that meant "no runner found" instead of "no gap".
A schema would have made that unrepresentable.

Two questions, if you have a moment:
1. Did you move from human-readable to schema because the schema version turned out to be worth
   it, or because a downstream consumer needed to parse it?
2. Is there a middle state you landed on - machine-readable output that is still prose, or the
   reverse?

Not asking for anything. If the answer is "you need the schema", I will build it.
```

**Why this is worth posting:** it is a real design question with a real downside I can name, and
the maintainer has clearly thought about it at a depth I have not.

---

## 4. Hcoles/pitest, stryker-mutator/stryker-js — a zero-config counterpoint

Lower priority. These are mature projects and the pitch is "your tool is great but too slow for an
agent's loop", which they have heard before, probably.

Only worth posting if it gets rewritten around a concrete result rather than a positioning. I would
suggest waiting until `falsify.mjs` supports enough of a language that the comparison is fair -
right now a Stryker user would read my regex rules as unserious, and they would be right to.

---

## When not to

Two of these drafts would be dishonest as written, and the conditions below are what stops them.

**Do not post the oh-my-agent one without the corrections.** I found two bugs in my own tool while
building the demo. If I post the pitch and someone runs it on a file with one covered guard, the
old version would have said "clean". The draft above includes both bugs. Stripping them out to make
the tool look better would be the exact failure the skill teaches against - and a maintainer who
finds them unprompted will assume I did not know.

**Do not post any of them as an announcement of a finished tool.** The repo's own
`eval-runs/RESULTS.md` says the skill found no bug the baseline missed, and that the evidence is
one model, one run per arm, with no comparison against a competing skill. If a draft implies more
than that, it contradicts the repo. The honest framing is "here is a gap I measured, here is one
thing that closes part of it, here is what it does not do" - which is also the framing most likely
to get an answer.

**Do not seed issues to drive traffic.** These are four specific findings about specific repos.
If the intent were reach rather than the finding, the right move would be to build the thing
better. The A/B evidence says the current thing is worth exactly one verification step; that is a
narrow enough claim that padding it is the only reliable way to lose it.

**Timing.** Post 1 and 3 first - both are design questions a maintainer can answer in a paragraph,
and both carry a finding rather than a request. Post 2 whenever, since it is a question not a
pitch. Hold 4.

---

## The honest summary

If all four land and every reply is "interesting, but I have not adopted it", the repo is still
correct to ship and still correct to describe as one verification step, mechanised. Distribution is
not adoption, and this file should not become a way to confuse the two.

The measurable version of this file is not the number of issues posted. It is whether anyone runs
`demo.sh`, and whether `falsify.mjs` finds a gap in *their* code that they did not expect. The
second one is the only signal that this was worth building.