# Compliance and Data

Data classification, audit trail, access control, retention, dependency provenance, and the
questions to answer before merging.

The biggest risk-acceptance number in most products is "we have an audit trail". When there is an
incident, or when a customer asks, the only answer worth anything
is the artefact - a log line, a config, a commit - not a policy PDF. What is not present in
the system does not exist, and that is true for compliance too.

**A control that is not implemented in code is not a control.** "Every action is logged" is
an intention. It becomes a control when the log runs, has the right fields, is retained for
the right period, and somebody reads it. The engineer's job is to make the evidence exist -
not to make the documentation look right. Everything below points at that.

The code-level safety part (authN/authZ, input validation, secrets) is in the Security
section of `references/design-guide.md`. What is here needs a system, a policy, and evidence.

## 1. What "compliant" means in operations

The definition an engineering team should use: a control **exists** when you can point to
where it lives and show evidence that it has run. Evidence can live in three places, in
increasing order of trust:

- **Code** - the authZ check in the right place, running on every request.
- **Config** - the value in effect, readable, not a default nobody has changed.
- **Run log** - proof that it ran, timestamped, produced by the system itself.

The table below is not a tour of a legal framework. It answers the only question an engineer
actually hits: *"what artefacts exactly do I need in my repo?"*

| Framework | What you need evidence for | Artefact in the system |
| --- | --- | --- |
| SOC 2 | Controlled access, reviewed changes | authZ on every route, SSO/MFA config, `CODEOWNERS`, login and permission-change logs |
| ISO 27001 | Defined controls, recorded operation | risk register, periodic access review with a trail, tested restore |
| HIPAA | PHI protection | encryption at rest + in transit, per-record PHI access logs, agreements with data processors |
| GDPR | Data subject rights | export / delete / anonymise by id, record of processing, response deadlines |
| PCI DSS | Card data never touches your systems | where PAN/CVV are not stored, tokenization, secret vault access logs, network segmentation |

Why: a line you cannot map to a file you own is **your** gap, and saying so early costs
orders of magnitude less than at audit time.

Do not derive legal obligations from this table. It is a translation into engineering
language; the legal question belongs to legal and security, not to you.

## 2. Classifying data at the boundary

Classify before you write, not after you already have a few million rows.

| Class | Examples | Must have |
| --- | --- | --- |
| Public | docs, marketing pages, public pricing | No security requirement. Still do not pass user input straight to the UI. |
| Internal | feature flags, application logs without PII, internal tickets | Does not leave the org. Retention is defined. Not used as test data. |
| Confidential | contracts, internal pricing, applicant records | Real authZ on the server, encryption in transit, access logs, not in application logs |
| Regulated PII | email, address, phone number, health data, card data | All of the above, **plus**: retention per class, an anonymise/export/delete path, audit trail, masking in every log |

Classification must **live in the schema**, not in a wiki:

- A distinct type for sensitive fields (`CustomerEmail` vs `FreeText`) so the compiler blocks
  the wrong write. The make-invalid-states-unrepresentable rule in
  `references/design-guide.md` applies to data classification unchanged.
- A list of PII columns next to the schema, reviewed on every migration, because that is the
  worst moment: a new field slipping into a production table before anyone thought about the
  consequence.
- Validation at the boundary stops forbidden fields from reaching a place they must not be
  stored - a read-only endpoint rejects `national_id` in the payload instead of accepting it
  and dropping it.

Why: classification written in a document is not consulted when somebody writes a new query.
Classification sitting in the migration means a stranger reading the diff knows what is
sensitive.

## 3. PII and secrets, end to end

- **Collect the minimum.** A field that does not exist creates no storage obligation, no
  risk, no "what is this for now" question.
  Why: every field you store is a long-term obligation. Deleting a field after three years
  of data costs hundreds of times more than never storing it.
- **No PII in** logs, traces, span attributes, error messages, URL paths or query strings,
  analytics events, crash reports, screenshots in tickets.
  Why: the three most common leaks are **URL** (in the access log of every downstream
  infrastructure and in the `Referer` of the next request), **log** (shipped out through
  third parties), and **analytics** (almost nobody opens the config to check).
- **Mask, do not truncate.** `a***@example.com` keeps the shape so you can debug, while
  `ada...` is useless data that is still personal data.
  Why: logs need the value to debug, but logs do not need the identifier.
- **Test data must be synthetic, same shape**: same length, same unicode edge cases, same
  date and timezone format, no real ids, not taken from production.
  Why: real data in a fixture outlives the system, and repos usually have broader read
  access than you think. Removing it from git is not deleting it.
- A secret never shares a diff with anything else - the process is in
  `references/git-workflow.md`.
- **Once it has leaked**: this is no longer a bug. It is an incident with a notification
  duty, and the clock starts when you *know*, not when you are sure.
  Why: the gap between discovery and notification is what decides how serious the incident
  is. "Probably nobody saw it" is not an incident response plan.

## 4. Audit trail

Every event needs all seven fields; missing one makes it useless for answering the question:

| Field | Why it is needed |
| --- | --- |
| actor | Who or what. Without it the log only proves *something happened* |
| action | A specific verb, not a generic `access` |
| target | Which resource, by an id that really exists |
| outcome | Allowed, denied, error. Denied is the most worth reading after an incident |
| timestamp | UTC, with timezone, not local machine time |
| source | IP, service identity, credential id |
| correlation id | Ties the app log, the trace, and the audit events of the same request |

| Not an audit log | Why |
| --- | --- |
| `console.log` in a handler | Nobody keeps it long, it is unstructured, and it is deletable |
| A log line you grep to debug | Changing the format loses history; nobody sets separate retention for it |
| A metric counting calls | Tells you *how many*, not *who did what to what* |
| An audit table in the same DB as app data | `DROP TABLE` deletes the evidence |

- **Append-only.** No `UPDATE`, no `DELETE` in any code path.
  Why: a log that can be edited proves nothing.
- **Tamper-evident.** Hash chain, signature, or stored somewhere it cannot be overwritten;
  checked periodically. Why: whoever causes the damage also has write access to the log.
- **Retained longer than application logs**, and stored where the app cannot delete it - a
  separate bucket, a retention lock, signed. Why: evidence that expires with the debug log
  is evidence that does not exist.
- **Mandatory**: login / logout including failures, role and permission changes, read /
  write / delete by data subject, bulk export, every access through an admin path.
- **Written at the application layer, not the database layer.** Why: a trigger in the DB
  misses the reads the app blocked, and - worse - it does not know who the actor is.

## 5. Access control as code

`references/design-guide.md` already covers authN + authZ at every boundary, deny by
default. What is here is the part a linter does not see and a new endpoint forgets.

- **"It is on the internal network" is not an authorization decision.**
  Why: a credential copied into another container is an access grant, and the network has
  no idea that credential exists. How to verify: call service A to service B with the
  credential you obtained - if it succeeds, that is a vulnerability, not a configuration.
- **Service-to-service: mTLS, or a signed token with an audience and a short expiry.**
  Why: a static secret shared through env vars cannot answer "who took it" - and every
  request after that is blind.
- **The server checks, even when the UI hides the button.** Why: the UI is a hint for the
  user, not a fence.
- **authZ at the data access layer, not just at the route.** A query that forgets
  `WHERE tenant_id = ?` means all tenants see each other, and a test at the route layer is
  still green. Why: this is the most expensive bug on the list, and no layer tests it by
  default.
- **Separate roles.** Read roles and privileged roles are different; a privileged role has
  an expiry or a recorded reason.
  Why: one compromised account holding all admin rights is a different class of incident
  from leaking a single record.
- **Break-glass access**: a separate mechanism, a separate credential, separate logs, a
  post-hoc approver.
  Why: with no break-glass, during an incident people use personal credentials - and you
  lose exactly the trail you needed most.
- **Negative test for every new route**: call it with a different role, not just the happy
  path. Why: a test that only tests the success path is the most common authZ failure mode,
  and it looks completely normal. Details in `references/testing-guide.md`.

## 6. Data lifecycle

| Mechanism | What you can still do afterwards | Why they differ |
| --- | --- | --- |
| Delete | Nothing, it is gone | The simplest and the most expensive when discovered late |
| Pseudonymise - keep the id, drop the identifying fields | Still joinable and still aggregatable | Cheaper than deleting, but **still PII** under most legal frameworks |
| Anonymise | Usable for statistics, no longer traceable to a person | Hard to guarantee: you must handle free text, names, IPs, phone numbers, inferable ids |

Confusing these three is the source of most wrong answers to a data subject request.

- **Retention per data class and per region.** Why: one global number means you either keep
  data longer than acceptable or delete it earlier than the business can absorb.
- **Deleting from the main table is not deleting.** Why: replicas, snapshots, backups, search
  indexes, caches, and data already sent to third parties are all still there. Before you
  write the delete function, list every place a row can exist - that is a task, not a
  thought.
- **Backup expiry is a scheduled job with evidence it ran.** Why: this is the easiest answer
  to get wrong in a data subject request - "we deleted it", then finding the data is still
  in a 30-day backup.
- **Export/right-to-access must cover caches, replicas, the analytics warehouse, and third
  parties.** Why: an export missing one part is a wrong export, and the recipient has no way
  to know it is missing.
- **Legal hold must be a flag in the schema**, not a verbal decision. Why: deleting while a
  hold is in place is a far worse incident than keeping slightly longer than needed.

## 7. Supply chain and provenance

### Dependencies

- **The lockfile must be committed.** Why: if the build is not reproducible then "what ran
  during the incident" is a question with no answer - and every answer starts with a version
  number.
- **Adding a dependency is a decision, not a command line.** Read the `install script`
  before you run it. Why: an install script executes someone else's code before your code
  runs, and it is the least reviewed part of the entire supply chain.
- **Pin versions for core libraries.** Why: a `^` range means you are trying a new release on
  production every time somebody pushes to the registry.
- **SBOM generated in CI** in CycloneDX or SPDX, attached to the release, stored longer than
  the build lifecycle. Why: an SBOM hand-assembled during an incident is an SBOM you do not
  have - and the only thing it leaves behind is the feeling that you had one.
- **Vulnerability scanning needs a real severity policy.** Why: a firehose nobody triages
  creates a false sense of safety and makes the team disable alerts, which reduces real
  detection. The policy must say what blocks a release, what creates a ticket, and who
  handles it.
- **Check the licence before adding the dependency.** Why: this is a legal decision, and
  removing a dependency that already shipped in a release is close to irreversible. Checking
  at `npm install` takes thirty seconds; checking at audit takes months.

### Provenance of generated code

- **A package's terms are the terms of whoever published it, not of upstream.**
  Why: sublicence chains and derived terms are where contradictions appear latest, and you
  cannot decide them on your own.
- **Tool-generated code still goes through the same rules.** Who is credited as author,
  which terms apply, whether packaging and redistribution are permitted.
- **Vendor terms and the indemnification clause decide who is liable when there is a
  claim.** That is contract language, not something you infer from the tool's documentation.
- **The origin of the material or code the tool relies on is not an engineer's call.** The
  honest answer when asked is "we do not know and cannot verify it". Why: this is the
  easiest place to over-claim, and one wrong IP claim costs far more than an "unclear".
- **When a scanner or a reviewer flags something**: stop, split the flagged part from the
  verified part, record how it was handled and what the conclusion was. Why: deleting it
  silently and merging is the worst outcome - you lose both the signal and the trail, and the
  next person wrongly believes it was handled.

| Signal | What it means | Who decides | Where the evidence lives |
| --- | --- | --- | --- |
| Lockfile diff in the PR | Whether the build is reproducible | The reviewer | The lockfile diff in that same PR |
| Advisory with a CVE you can reach | React first, regardless of severity | The engineer fixing it | Fix PR + advisory link |
| Advisory you cannot reach | Record it, no rush to fix | Severity policy owner | Ticket with a reachability analysis |
| Licence incompatible with how you distribute | **Stop the merge** | Legal + tech lead | Decision recorded in the ticket |
| Package unmaintained, or with a new install script | Supply chain risk | Tech lead | Decision recorded in the ticket |
| SBOM job failed | You shipped something untraceable | Release owner | Build log + long-retained artifact |
| Generated material flagged for IP or licence | Provenance not verified | Legal | Investigation result, conclusion recorded |

The "who decides" column matters as much as the "what it means" column. A signal with no
owner goes nowhere.

## 8. Change control

| Change | What must exist before merging |
| --- | --- |
| Schema or data migration | Migration plan in the PR: additive?, how is the rollback?, how does existing data cope |
| AuthN / authZ / permission | Review by the auth owner, mandatory |
| Money path or billing | Review by the billing owner; idempotency proven by running it twice |
| Retention or deletion | Review by the data owner; confirm the delete path is still correct after the change |
| New log field or PII path | Confirm the field is masked and has its own retention |
| Adding a dependency | Licence and advisory checked, result recorded in the PR |

- **An approval record is a trace in the system** - a PR approval, a `CODEOWNERS`-required
  review - not a chat message. Why: *"we announced it in Slack"* does not answer "who allowed
  this in, and when", which is exactly the question an audit asks.
- **`CODEOWNERS` is the cheapest control and the most often skipped.** A file that is marked
  but never actually edited is evidence that does not exist.
  Why: fake ownership makes every "reviewed" claim meaningless, and it fails silently -
  nothing goes red.
- **An emergency change still goes through a PR**, labelled, with a retro-review deadline.
  Why: deploying straight during an incident is reasonable operations; nobody ever looking at
  it again is where the second incident starts.
- **The PR template forces answers to the questions in section 9.** Why: a field in the
  template is a question asked every time; no field means the question is never asked. PR
  format in `references/git-workflow.md`.

## 9. Questions to ask before merging

This is the table from section 6 of `SKILL.md`, at enterprise scale. Apply it only when the
diff touches **data, permissions, money, or regulated fields** - otherwise the table in
`SKILL.md` is enough.

| Question | If you cannot answer it |
| --- | --- |
| Which data class is this field, and who classified it? | Unclassified means treat it as confidential |
| Where else does this data still exist? | You find out when it must be deleted, which is late |
| Is there a deletion path, and does it cover everywhere? | Cannot delete = cannot handle a data subject request |
| If the UI disappears, who can still call this endpoint? | A new route with no authZ |
| Is this query scoped by tenant/user? | Cross-tenant data leak; a route-layer test does not catch it |
| Does this event reach the audit log with all fields? | During an incident you cannot answer "who did what" |
| What new data do logs, errors, traces push out? | PII leaking through logs, not reversible |
| If this is the money path, what happens when it runs twice? | Double charge, double ship |
| What does the new dependency's licence say? | A legal decision that is close to irreversible |
| What is the rollback for this change? | A second incident, and this time there is no clean data left |

## When this file applies

| Situation | Read sections |
| --- | --- |
| Adding an endpoint, storage, a log field, or a third party | 2, 3, 5 |
| Touching real data, retention, export, delete | 6 |
| Adding a dependency, or changing the build/release pipeline | 7 |
| The question "is this legal?" | 1 - then ask legal, do not derive it yourself |
| Diff touches permissions, money, or a data subject | 9 |
| An incident involving data or access | 4 - and start from the correlation id |

No need for this file on T1. You need it before writing the first line of code, not after
deploying - because both of those fixes cost far more after a deploy than writing it right
from the start.

## One question

> If somebody today asked *"who looked at this data, since when, and on what evidence?"*
> - do you answer with an artefact, or with an opinion?

The second answer fails every audit. And most repos answer with an opinion, because during an
incident nobody remembers what they logged.
