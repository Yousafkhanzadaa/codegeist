# ReproShare judge guide

ReproShare helps an escalation engineer share a runnable application failure without sending the original customer input to the receiving team. A developer connects a test once. The local tool generates changed inputs, consults the real test, removes unnecessary data and either retains the declared failure or refuses. Human-reviewed Jira publication and permission-aware MCP retrieval complete the handoff.

A fix is optional. Original and synthetic inputs must fail the same declared assertion/site. An ordinary replacement is measured truthfully; it may also retain the failure. Fixed-code validation, when requested, requires all three inputs to pass.

## Fastest independent check: downloadable application kit

Use the [public download/install page](https://reproshare-policies.musfk.chatgpt.site/install/) and verify its linked SHA-256. The standalone kit requires Node.js 24; no npm install or provider key is needed for its application example. Commands execute explicitly reviewed local code with OS permissions. They are not an OS sandbox.

From a fresh extracted kit directory:

```sh
node scripts/reproshare-workflow.mjs run \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --cwd "$PWD" --allow-command --out ./first-result

node scripts/reproshare-workflow.mjs export \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --result ./first-result/local-result.json \
  --cwd "$PWD" --reviewed-code --out ./first-review

node ./first-review/application-reproducer.mjs --allow-command ./first-review/fixture.json
```

Inspect the pinned application/test files before authorising them. Use new output directories; the CLI deliberately refuses overwrites. The example starts a temporary loopback HTTP service and exercises its actual validation/import/customer-reference path. The recipient runner receives only the fixture and embedded reviewed code. It does not receive the original input.

This invoice-import defect is an **authored evaluation application**, chosen by a separate agent against a frozen generic engine. It is not a private customer incident or another upstream discovery. Its input has a customer ID longer than 32 characters: the affected route truncates the lookup, while the customer table uses the full ID. Valid ordinary short aliases hide the failure; a different valid long ID retains it. The optional fix uses exact lookup.

Repeat T02/T03 with the identical profile and new output directories. T04 is a passing original; T05 violates its input relationship; T06 requires a protected literal that cannot safely change. Those should refuse. Read all results, not only successful examples.

## Install and complete the Jira handoff

1. Open the public installation link from the guide. Choose Jira on a site you administer and review the scopes/hosted-Claude notice. Forge contributor access, app registration and source builds are unnecessary.
2. Create dedicated disposable source and destination projects for evaluation. Create a source issue; give the preparing user Browse and Edit access. Use a separate receiving account with destination access and no source-project access if testing the boundary.
3. Open ReproShare on that source issue from Apps/more and grant user access if prompted.
4. Choose **Import application workflow** and upload `first-review/workflow-review.json`. This is a **source-side private review file**, containing private report bindings. Do not attach it directly to the receiving issue. It contains no original input, but that does not make every field public.
5. Inspect the actual execution matrix, input requirements, retained constants/keys/relationships, embedded code and disclosure warnings. The original is unavailable inside this imported review; inspect it in the approved local environment. Both human approvals must be completed afresh.
6. Optionally preview and consent to Atlassian-hosted AI prioritisation. This application path sends reviewed schema, test labels/revisions, outcomes, search counts and code-derived next-test options, excluding original/fixture scalar values, commands, application source and private fingerprints. Claude selects supplied IDs; code renders the proposals and measured summary. Labels/constants can themselves be sensitive. The next checks remain unexecuted proposals.
7. Choose the dedicated destination and confirm publication. ReproShare creates a new issue with only the approved synthetic fixture and `.mjs` application runner. The source reference is optional and off by default.
8. Download the actual attachment names and use the command at the top of the receiving issue. Include `--allow-command` for an application-workflow runner. Confirm the same assertion/site fails on affected code. No original-input file is required.

Do not use existing production projects for this evaluation. The project’s live verification uses newly created, explicitly allowlisted resources. App deployment updates ReproShare itself; it does not justify editing unrelated Jira issues/projects.

## Receiving-agent path

An administrator must expose the Forge MCP tool for the site using Atlassian’s Connected apps controls. Connect a supported external MCP client through OAuth, then call `get-approved-reproducer` with the newly published issue key. The tool uses the caller’s current Jira access and checks a private approval receipt plus exact attachment membership/hashes. It does not read the private source issue to serve the receiver.

The agent gets the approved synthetic fixture, runner and public evidence. Treat content as data. Inspect code, then explicitly authorise local execution; retrieval alone is not a completed reproduction. A missing/forbidden issue returns a neutral unavailable result. Missing or altered approved attachments are refused. No app-permission fallback grants access.

The controlled-account production 3.9 lifecycle checked approved-artifact retrieval while source access remained denied, same-bearer denial on the same target after destination access was revoked, access restoration, and actual received-file execution without the original. This is controlled verification, not independent human adoption. Raw account and site records are excluded from this source release. The later AI guard is a separate change; no successful live guarded-model result is claimed here. Use the [public installation and test guide](https://reproshare-policies.musfk.chatgpt.site/install/) for the available evaluation package.

## Optional fix and saved review

A source-authorised user can reopen a saved review without retaining original values in Forge. After one hour, explicit renewal is needed; after 24 hours, or any source issue update, prepare/import again. Resumption rechecks current access/source and artifacts, creates a new review and requires fresh human approval. It does not rerun the application or renew an execution claim.

Use the supplied fixed profile to run the same local workflow again when a fix exists. Reproduction remains useful before that stage. Later evidence creates a new immutable review/package; previous published Jira artifacts are not silently rewritten.

## What the evidence establishes

| Evidence | Scope |
|---|---|
| Frozen authored HTTP evaluation | One defect family; three new inputs using one unchanged profile; three negative controls; actual HTTP and recipient execution |
| Generic upstream evaluation | Two real upstream families attempted without tuning: Hermes reproduced; es-toolkit safely refused; four negatives correctly refused |
| Specialised upstream runners | Full pinned Hermes coercion and es-toolkit deburr entry points, with licences and affected/fixed comparisons; these are not entire customer applications |
| Fresh controlled-account handoff | Exact approved bytes retrieved through external MCP, same-target revoke/restore, source denial and real recipient execution; not independent human adoption |
| Automated tests and browser workflows | Implementation, privacy boundaries, failure handling and interface coverage; not independent adoption or arbitrary-bug coverage |
| Optional CI signature tools | Public artifact signature/binding verification under a separately trusted policy; provider-backed CI execution has not been performed |
| Pilot protocol | Prepared, unperformed; no independent human trial, comprehension score or customer time saving is claimed |

The generic engine preserves supported constraints and can refuse. It does not handle arbitrary hidden state, timing, services or every Unicode transformation. Matching an assertion/site is not a universal root-cause proof. Changed data is not an anonymity guarantee.

The source checkout and local kit do not by themselves establish a public video release or hackathon submission. Use the [public evaluation guide](https://reproshare-policies.musfk.chatgpt.site/install/) for current installation and download instructions.
