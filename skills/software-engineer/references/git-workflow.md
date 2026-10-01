# Git Workflow

Git is the project's memory. The rules below keep history readable, changes reversible, and
secrets out of it.

## Before staging

`git status` and `git diff`, **every time**, before **every** stage. Never commit something
you have not read. Confirm you are on the right branch. Scan the diff for `.env`, credentials,
tokens, keys, real user data, internal URLs with embedded passwords. Keep build output and
dependencies out of commits.

## Branches and commits

- One branch per unit of work. One commit for **one concern** - a commit doing two things can
  only be reverted entirely or not at all.
- **Every commit leaves the tree working**: it compiles, tests pass. A commit that leaves
  `main` broken is a release incident waiting to deploy.
- Separate refactors from behavior changes. Mixing them makes the diff unreviewable and the
  revert unsafe.
- Message: an imperative subject under ~72 characters, a blank line, then the **why**. A
  message that only repeats the diff is a message that is missing.

```text
fix(order): reject orders placed after the cutoff

The cutoff was compared against request time instead of created_at, so a
delayed request could place a stale order. Compare against created_at and
add a regression test for a 23:59 order.
```

Read the message as a changelog entry. That is the point of the format.

## Never

- `git commit -a` or `git add .` without having read status and diff.
- Committing secrets or real credentials. If one gets in, **rotate immediately** and treat
  it as disclosed.
- Force-pushing a shared branch, or rewriting public history. Only rebase commits nobody has
  pulled.
- Amending or squashing someone else's commit.
- `--no-verify` to get around a failing hook.
- `git checkout .` / `restore .` to discard changes you have not checked.

## Recovery

The commands you know by heart, the judgment below you do not: a loss is almost always
recoverable, so check before concluding it is lost, and prefer `revert` for anything already
published. Use `git reflog` to find commits you think are gone.

## Pull requests

A PR is an **artifact for review**, not a notification. Small enough to read in one sitting -
400 lines is already a lot.

```text
<type>(<scope>): <what changed>

Why             <the problem, issue link>
What            <the design, and which decision matters>
Verification    <command> -> <result>, for each gate
Risk/rollback   <what can break, how you would notice, how to undo it>
Out of scope    <what you deliberately did not do>
```

Call out what the reviewer **must** scrutinize: security, data, concurrency. Attach a
screenshot or a trace for UI changes and for logs. When review asks for a change: make it or
explain it - do not silently rewrite the PR.

## Release

- Honest sem versioning. A breaking API change is major **even when it feels small**.
- A changelog entry in the same change as the behavior change.
- Tag the commit actually released. Build **from the tag**, never from a branch tip.
- Release notes are for users: what changed, what broke, what to do.

## The user's existing history

- Do not rewrite, reformat, or reorder history you were not asked to touch.
- If the working tree already had uncommitted changes before you started, respect them and
  say so.
- When you are done, leave a clean tree: no junk files, no leftover branches, nothing
  half-staged.
