# Plan Templates

The plan is a contract with the user, not a rehearsal. It says what changes, what does not,
how it is proven, and what could go wrong. It contains no code.

## T2 - inline, 5-7 lines

```text
Plan
- Goal: <observable behavior change, one sentence>
- Approach: <2-3 sentences: the design and where it lives>
- Files: <paths you expect to touch>
- Verify: <exact commands and expected result>
- Risk: <the one thing most likely to surprise us>
```

Proceed after presenting it unless the task hits a risky path. No ceremonial approval
needed for a small, well-understood change.

## T3 - structured, then stop

```text
Problem     <what is actually wrong, with evidence: file:line, logs, docs>
Goal        <one sentence: the world after this change>
Non-goals   <explicitly out of scope>
Current     <entry point, owning module, existing pattern, what tests assert today>

Options     1. <name> - <mechanism> - cost: <effort, blast radius> - risk: <what breaks>
            2. <name> - <mechanism> - cost: <effort, blast radius> - risk: <what breaks>
            Recommend: <option> because <reason tied to the goal>

Design      <signatures, data shapes, error cases, config surface, dependency direction>
Data        <schema changes, backfill, back-compat window, rollback>
Steps       1. <independently verifiable>  2. ...  3. ...
Verify      <command> -> <expected result>, per gate, plus the observable check
Risks       <risk> -> <mitigation>
Questions   <what the user must answer before or during step N>
```

## The bar

Verifiable goal (someone else can tell whether it landed) · explicit non-goals (the real
cause of scope creep is an unstated boundary) · named files, not "update the backend" ·
design written as a contract, not a vibe · real commands that exist in this project · risks
named honestly, since a plan with none is incomplete · options with a recommendation, never
a bare menu.

## Plan drift

When reality breaks an assumption: stop, state what changed and the evidence, present the
delta rather than rewriting the plan, and wait for re-approval on T3. Continue on T2 after
stating the delta. Silent drift is the failure mode this exists to prevent.

```text
Plan update: <what changed and why>
Impact: <files, risk, effort>
Revised step N: <old> -> <new>
Continuing unless you say stop.
```
