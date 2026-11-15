# AI in ReproShare

AI is optional. The local application runner synthesises and minimises inputs, validates declared requirements and executes the reviewed application assertion without a model. Forge validates the imported evidence and artifact bindings; it does not execute the application or attest to a local run.

## Application workflow: prioritise next tests

The application workflow gives Atlassian-hosted Claude Haiku 4.5 one narrow job: select one to three next-test options derived by code from the public input schema and declared relations. These are **unexecuted proposals**. The model cannot supply the factual summary, change outcomes, infer a fix, produce application code or approve publication.

Before a request, the panel previews the exact application task data: title, preparation checks, public schema/constants, assertion and failure-site labels, declared revisions, reported outcomes, bounded search counts and the available test-option IDs. Original input, synthetic scalar values, local commands, application source and private fingerprints are excluded. Field names, public constants, titles and test labels can themselves reveal context and still require review. Standard task/scope instructions accompany that preview.

The server accepts only `selectedCheckIds` with one to three unique, supplied IDs. Unknown IDs, duplicate IDs, prose, extra fields and malformed responses are rejected. Code renders the selected proposals and derives the summary from the public report, including whether ordinary replacement passed, also failed, failed differently or was inconclusive, and whether a fix was actually tested. This constraint applies to **application workflow plans**; earlier reference-example investigation/brief modes still accept reviewed model prose.

The implementation is in [application-test-plan.ts](../src/shared/application-test-plan.ts), [ai-context.ts](../src/shared/ai-context.ts) and [ai.ts](../src/server/ai.ts). Older free-text application jobs are retired before display, publication or a queued provider call. A saved historical draft is not silently converted into a new plan.

## Observed hosted result and correction

One metadata-only request was explicitly authorised and executed on production **3.9.0** for the fictional invoice-import workflow. The model returned a structurally valid draft, but wrongly said the ordinary control also failed. The measured ordinary control passed. It also inferred that this meant the issue was not a regression, which the evidence did not establish.

The draft was **not included** in the approved Jira handoff. This observed semantic failure motivated the ID-only selector and code-derived summary described above. The [application test-plan tests](../tests/server/ai.test.ts) cover invented and duplicate IDs, extra prose and code-derived facts. No successful live result for the new selector is claimed here. Requests require separate consent and are never automatically retried.

## Investigation and reference examples

The older optional investigation mode sends entered expected/observed report prose, field paths and code-computed observations. Original JSON scalar values are excluded, but entered prose is sent as written. Its suggested supported condition remains an assumption for a person to review.

Reference-example briefs may send selected synthetic field values and public handler facts after separate consent. They remain reviewed proposals rather than measured application evidence. Public Hermes/es-toolkit runners do not need AI; see [local verification](local-verification.md).

## Consent, lifetime and availability

Each request needs separate in-app consent. Usage goes through Forge with `@forge/llm`; no separate provider API key is required. The application uses `claude-haiku-4-5-20251001`. A request may incur hosted usage under the site's allowance and terms; no unlimited or permanently free usage is promised.

Private jobs expire after one hour and are bound to the actor, source issue/version and, for a plan, the exact review and fixture. Requests are limited to ten per user and forty per installation/environment per UTC day. A failed or unfinished job can consume a slot. Prompt/output size and worker deadlines are bounded. There is no provider retry or fabricated fallback. Local preview has no model response simulation.

The user separately reviews any resulting plan before including it. Omitting AI does not prevent synthesis, the runnable handoff or current-access MCP retrieval. Neither AI nor MCP executes the recipient's application, grants Jira permission or replaces the two publication review confirmations.
