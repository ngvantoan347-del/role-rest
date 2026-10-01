# Plan Templates

A plan is a contract with the user, not a rehearsal. It states **what changes, what does not
change, how it is proven, and where it can break**. It contains no code.

Why write the plan early: it surfaces a misunderstanding while a misunderstanding is still
cheap. Changing direction at the start costs a few lines of text. Changing direction after
600 lines of code cost a refactor and your credibility.

## T2 - inline, 5-7 lines

```text
Plan
- Goal: <the observable behavior change, one sentence>
- Approach: <2-3 sentences: the design and where it lives>
- Files: <the paths you expect to touch>
- Verify: <the specific command and the expected result>
- Risk: <the one thing most likely to surprise you>
```

Present it and keep going, unless you hit a risk line. A small, well-understood change does not
need a formal approval step.

A good T2 plan is **one read that is enough to start**. If the reader has to ask a question,
it is not enough.

## T3 - structured, then stop

```text
Problem     <what is actually wrong, with evidence: file:line, log, docs>
Goal        <one sentence: what the world looks like after this change>
Non-goals   <out of scope, explicitly>
Current     <entry point, owning module, existing pattern, what tests assert today>

Options     1. <name> - <mechanism> - cost: <effort, blast radius> - risk: <what breaks>
            2. <name> - <mechanism> - cost: <effort, blast radius> - risk: <what breaks>
            Recommend: <option> because <reason tied to the Goal>

Design      <signature, data shape, error case, config surface, dependency direction>
Data        <schema change, backfill, backward compatibility window, rollback>
Steps       1. <independently verifiable step>  2. ...  3. ...
Verify      <command> -> <expected result>, for each gate, plus observable checks
Risks       <risk> -> <mitigation>
Questions   <what the user must answer before or at step N>
```

## T4 - a change with blast radius outside the project

Same as T3, plus two mandatory lines. They exist because this is the kind of change the next
person cannot infer on their own if you do not write it down.

```text
Blast radius  - who else runs this: service name, package, endpoint, data table
Rollback      - be specific: revert the commit, flip a flag, or write the data back; and
                how long that takes
Owner         - the team/person to notify before deploy
```

If there is no simple rollback path, that is information the T3 plan has to state, not
something to leave at the end of the handoff.

## Quality

Verifiable goals (someone else can tell whether you hit them without asking you) · **explicit
non-goals** (the real cause of scope creep is an unstated boundary) · files named, not "update
the backend" · the design written out like a contract · the real commands that exist in the
project · risks stated plainly, because a plan with no risk is a plan that is **not done** ·
**options with a recommendation**, not a bare menu.

## Plan drift

When reality breaks an assumption:

1. **Stop.** Do not keep going with the old plan while the new assumption loads in.
2. Say what changed: which assumption broke, the evidence, the impact on scope and risk.
3. Present **the delta**, do not rewrite the whole plan - the reader has to see which parts
   are still correct.
4. T3: wait for re-approval. T2: state the delta and continue.

```text
Plan update: <what changed and why>
Impact: <file, risk, effort>
Revised step N: <old> -> <new>
Continuing unless you say stop.
```

Silent drift is the failure mode this section exists to block. It is worse than a plan that is
slightly off, because the user is approving something that is no longer what you are building.

## When a plan is redundant

No plan for T1 - a typo and a one-line fix have no design decision to present. Writing a plan
for work where you do not need anyone's opinion wastes both people's time.
