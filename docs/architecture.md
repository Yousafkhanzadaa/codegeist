# ReproShare architecture

## Current application workflow (15 November 2026)

A reusable local service profile declares the application assertion, optional failure site, input contract, pinned affected files and optional fixed files before execution. The bounded local search consults the real application test, checks stability and validity, changes required private string/number values and attempts to remove unnecessary content. Unsupported or unsafe inputs can be refused. A fix is not required to establish reproduction. Ordinary replacement is a measured control; fixed validation, when requested, requires all three valid inputs to pass.

The source-side review import contains synthetic/control inputs, public requirements/specification, private self-report bindings and a reviewed portable runner. It contains no original customer JSON. Forge validates source/fixture/config/contract/report checksums, the predeclared test and file pins, embedded source hashes, the approved runtime hashes and the exact audited wrapper template without executing uploaded code. The source-authorised private review keeps the original report for revalidation.

Publication projects the report into an explicit public allowlist. Original source hashes, private configuration/command hashes and the private report checksum do not enter descriptions, runners, receipts or MCP responses. A fresh opaque binding links the public projection to its private record. The public checksum covers only the public projection. Keys, constants, lengths, relationships, file pins, reversible Boolean changes and failure conditions can still disclose information; this is not anonymity.

Reviews are stored for 24 hours, with a one-hour publication validity window. A bounded actor/source navigation index has a one-day TTL. Explicit resumption rechecks current actor, source access/version, artifact integrity and test/report binding; creates a new review; and requires renewed human approval. It does not rerun the application. Any source issue update remains conservatively invalidating, including unrelated updates; there is no silent exception. AI jobs retain their one-hour lifetime.

Application AI briefs use the exact allowlist in `src/shared/ai-context.ts`: reviewed schema, test labels/revisions, reported outcomes and bounded search counts. They exclude original and synthetic scalar values, commands, application source and private fingerprints. Labels and public constants themselves still need review. The model selects one to three supplied schema-derived test-option IDs. Code renders the proposals and computes the factual summary from the report. Unrecognised/duplicate IDs and extra prose are refused. Old free-text application jobs are retired before display, publication or a queued call. Reference-example prose modes remain separately reviewed. Application execution and approval remain separate; see [AI scope and observed correction](ai.md).

MCP returns only approved bytes under current destination access. A forbidden/missing issue returns the same neutral unavailable result. Legacy receipts containing private commitments require a new reviewed publication; existing Jira files/issues are not rewritten. New application runners execute the reviewed actual application assertion on synthetic input only. Optional CI signatures remain separate from execution attestation.

ReproShare is a Forge Custom UI issue panel for Jira. Forge hosts the backend, queue, optional AI jobs and private storage; Jira stores the reviewed handoff. The CLI and recipient execute application code locally. See the [application workflow](application-workflow.md) and [local verification](local-verification.md) for commands and evidence boundaries.

## Components

| Component | Responsibility |
| --- | --- |
| [Local workflow](../local/workflow.mjs) and [CLI](../scripts/reproshare-workflow.mjs) | Validate a reusable profile, search bounded candidates using actual test feedback and attempt valid removals. |
| [Local protocol](../local/protocol.mjs) | Execute inspected argv without a shell, strip inherited secrets, enforce limits and check declared input/file pins before and after a run. |
| [Portable exporter](../local/portable.mjs) | Require code review and generate a readable, pinned recipient assertion package. |
| [Workflow importer](../src/domain/local-workflow.ts) | Validate the private transport, test specification, evidence, source pins and exact portable runtime/template without executing it. |
| [Evidence projection](../src/domain/verification.ts) | Keep private source/configuration/command commitments out of the public receipt and shared runner. |
| [UI](../ui/src/) and [resolver](../src/index.ts) | Obtain trusted Jira context, require human review, manage publication and serve approved artifacts under current access. |
| [AI context](../src/shared/ai-context.ts) and [test-plan selector](../src/shared/application-test-plan.ts) | Preview bounded metadata, select supplied unexecuted next-test IDs and render measured facts in code. |

## Data flow and permissions

1. A developer connects a meaningful assertion, bounded input contract and critical application/test-file pins once. Local execution requires explicit command consent and uses OS account permissions; it is not an OS sandbox.
2. The source operator supplies the private original locally. Original and accepted synthetic inputs must satisfy the contract and stably fail the declared assertion/site. The ordinary comparison is measured, and an optional fix must pass all three inputs.
3. Reviewed export produces a source-side private transport plus the synthetic fixture and portable runner. It does not embed the original customer input. Heuristic code scanning supplements human review; it cannot establish that arbitrary source is safe to disclose.
4. The source-authorised Jira panel imports the transport, validates bindings and creates a new review. Import clears human approvals and any AI brief. Source access/version and review age are checked again before publication.
5. The operator reviews retained information and code, completes both disclosure confirmations, chooses a destination and explicitly confirms creation of a new issue. The source reference and optional AI plan are off by default.
6. Publication saves the reviewed description and exactly two approved artifacts. A private receipt is authoritative for retrieval. An editable Jira issue property alone cannot establish approval.
7. MCP checks the caller's current destination access, approved attachment membership, successful user-authorised reads and exact hashes before returning public artifacts. It does not require receiver access to the source or retrieve the private investigation. The recipient separately inspects and runs the synthetic assertion locally.

Resolver operations take actor, site and source issue identity from trusted Forge context. A payload cannot choose a different actor or source. Source reads, AI submission/polling and review operations require source view/edit access. Attachment reads require membership in the fetched issue's attachment list and a successful user-authorised content request.

Publication requires destination Browse Projects, Create Issues and Create Attachments permissions, enabled attachments and supported required fields. Jira fields are reloaded rather than accepting arbitrary client overrides. Jira enforces its own permissions on every write. Missing consent never falls back to app permissions.

## Storage and lifetime

Forge KVS is scoped to the app installation and environment. Private reviews retain synthetic artifacts and source/report bindings rather than arbitrary original customer JSON. Their 24-hour storage lifetime and one-hour publication validity are separate. Explicit renewal rechecks current actor, source version/access and artifact integrity, creates a new review, and requires fresh human approval. It does not rerun the application. The recent-review navigation index expires after one day.

Private AI jobs expire after one hour and remain bound to their actor and source/review version. Each request needs separate consent, is budgeted and has bounded input/output/deadline limits. A failed job can consume a slot. There is no automatic provider retry or fabricated fallback; local preview does not simulate a model result. See [AI scope](ai.md).

Publication/recovery state and approval receipts have no configured TTL. They preserve the issue identity, upload phases, approved attachment hashes and original optional brief selection. Jira stores the reviewed description and artifacts under its normal site retention controls.

## Write recovery

Publication reservations and upload claims use atomic KVS `FAIL_IF_EXISTS`. A failed reservation cannot confer ownership. Known issue identity is persisted before attachments are uploaded. Validated issue keys produce relative `/browse/KEY` links; returned API self URLs are not trusted as browser destinations.

Definite creation/upload rejections can release an owning reservation. Timeouts, lost responses and other uncertain outcomes retain it. A retry does not blindly create another issue or upload another attachment. A lost upload response can be recovered only by a positive filename, byte-length and SHA-256 match; a missing match does not prove the earlier write failed.

For an unknown creation outcome, a reviewer may explicitly identify the existing issue by its publication reference. Recovery checks destination, creator, creation window, issue property and current permissions against the private binding, then atomically claims one issue before continuing. It never treats an editable issue property as sufficient approval. This reduces duplicate writes; it is not a distributed exactly-once guarantee.

Retries still need a current review and source version. An existing handoff keeps the original reserved brief selection; a later AI job cannot silently amend it. New evidence or changed reviewed artifacts require a new review/package rather than rewriting earlier claims.

## Supported proof and limits

The application workflow handles bounded UTF-8 JSON and declared scalar/structural requirements. It rejects duplicate/prototype-related keys, unsafe numeric literals, invalid contracts, changed pins, unrelated failure identities, timeouts and mutation of the input or declared files. Current limits are enforced in the [JSON parser](../local/json.mjs), [input contract](../local/input-contract.mjs), [protocol](../local/protocol.mjs) and [workflow importer](../src/domain/local-workflow.ts); the [workflow guide](application-workflow.md) describes export budgets and supported schema imports.

Earlier reference profiles check Number conversion, Unicode normalization and duplicate-event conditions. These reference handlers are not arbitrary customer applications. The specialised Hermes runner executes a pinned integer-coercion entry point, and the [es-toolkit runner](second-application-case.md) executes pinned `deburr` modules. Their declared boundaries and upstream revision provenance remain explicit.

The [authored HTTP acceptance example](../examples/heldout/README.md) covers three failing inputs for one intentional defect and three negative controls. The [generic upstream exercise](../examples/heldout/upstream-generic-evaluation/README.md) records one reproduced family, one safely refused family and all four negative controls. These are controlled tests, not independent human adoption or universal bug coverage. The [pilot](pilot-protocol.md) and provider-backed [CI attestation](ci-provenance.md) remain unperformed.

The [public installation and evaluation guide](https://reproshare-policies.musfk.chatgpt.site/install/) explains shared-app installation and downloadable testing. A source build, local run or receipt checksum is not remote execution attestation, proof of an identical root cause, anonymity or a guarantee of application correctness.
