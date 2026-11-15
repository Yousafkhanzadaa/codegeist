# Verify a ReproShare fixture against an application

Reproduction and fix validation are separate. A valid original and a changed synthetic input must repeatedly fail the same predeclared meaningful assertion and, when supplied, failure site. A fixed revision is optional. When a fix is supplied, all three inputs must pass it. Ordinary replacement is a measured control: it may hide the failure, preserve it too, fail differently, or be inconclusive.

These are local self-reports. Forge checks their consistency and binding; it does not run uploaded application code or attest that a remote machine executed it. Matching the assertion/site is bounded failure evidence, not proof of an identical root cause or anonymity.

## Recommended: connect a service once

Use the [application workflow](application-workflow.md). Its `init`, `run` and reviewed `export` commands combine reusable profiles, bounded real-test feedback, minimisation and an actual portable application assertion. The original stays local. Import `workflow-review.json` into the source-authorised Jira panel, then review and publish only the approved public files.

The [self-service judge guide](self-service-judge-test.md) includes a complete fictional HTTP application and three inputs using the same profile. The [frozen upstream evaluation](../examples/heldout/upstream-generic-evaluation/README.md) records both success and refusal. Neither establishes performance on arbitrary applications.

## Verify an already-prepared package

Requires Node.js 24. The local CLI has no npm dependencies; the inspected adapter may require its own runtime/dependencies. Choose a built-in public case or declare an application test specification before preparing/exporting the package. A generic reference condition by itself is not an application test.

```sh
node scripts/reproshare-check.mjs \
  --package verification-inputs.json \
  --source /absolute/private/original.json \
  --oracle /absolute/owned-app/oracle.json \
  --cwd /absolute/owned-app \
  --allow-command \
  --out verification-evidence.json
```

**Both JSON files in this command are source-side private working files.** Verification inputs contain a private original-byte hash and configuration binding. The report contains private source/configuration/command commitments. Neither is a receiving-issue attachment. Import the report through ReproShare; publication creates a separately checksummed public projection.

The exact original bytes are required locally. Saving with different whitespace, encoding or line endings changes their hash. Use the same file used for preparation; do not substitute a convenient public baseline. The package validates original/ordinary/fixture/contract hashes before executing an adapter.

`--cwd` is required. `--allow-command` explicitly authorises inspected argv; `shell:false` prevents shell interpolation. This is **not an OS sandbox**: the executable still has OS account file/network permissions. Inherited environment secrets are stripped, raw stdout/stderr are suppressed, and time/output/file limits are enforced. Review code and dependencies first.

The output path must be new. Exit 0 means verified, 2 means completed but rejected, and 1 means a configuration/file/binding/invocation error. Errors use bounded codes rather than input values or raw logs.

## Declare the actual test

The local oracle configuration has version, service `id`, `assertionId`, `failureKind`, optional `failureSite`, an affected adapter and an optional fixed adapter. Each adapter has a revision, argv with exactly one standalone `{input}`, and 1–24 pinned relative file paths/hashes. Its entry point must be among those files. Service/profile IDs must agree.

The public `VerificationSpec` is chosen before execution. It contains the service/test identity, optional failure site and revision/file bindings, without local commands. The prepared package includes its canonical hash. Known Hermes and es-toolkit cases automatically declare their exact assertions and critical source pins. A report with an unrelated test or manifest cannot use those identities merely by copying a revision label and recomputing a checksum.

The adapter exits normally and emits exactly one small JSON result:

```json
{"version":1,"assertionId":"invoice-import.preserves-customer-reference.v1","outcome":"fail","failureKind":"valid-import-reference-resolution","failureSite":"invoice-import.resolve-customer.v1"}
```

A passing result names the same assertion and uses `outcome: "pass"`. Nonzero process exit, unrelated assertion/kind/site, malformed output, timeout, changed input or changed declared files cannot establish the required original/synthetic failure. If an adapter emits a failure site, declare it in the configuration/specification rather than attaching an undeclared signature afterward.

Repeated checks (1–3, configured locally) reject unstable results. Application search requires at least two matching runs and has an overall candidate/time budget. The ordinary-control observation does not make a failed original or unrelated synthetic crash acceptable. A fixed adapter, if supplied, must pass original, ordinary and synthetic inputs.

## Report import and publication

The version-1 private report binds exact inputs, contract, configuration, oracle, local runner and declared files. Its checksum is not a signature. Import also checks the predeclared test specification. Unsupported keys, raw logs, commands, absolute paths and duplicate paths are rejected. All required inputs must satisfy the declared contract; undeclared application preconditions remain outside that contract.

Import creates a new review and clears human approvals and the AI brief. A later report never adds claims silently to a previously published package. The public receipt includes the assertion, optional site, measured matrix, evidence level, public file pins, public fixture/contract hashes and opaque review binding. Its hash covers only this public projection. Original source/configuration/command hashes and the private report checksum are excluded from the report Markdown, shared runner, publication receipt and MCP response.

The source-side stored report remains private for revalidation. Reviews have a 24-hour storage TTL and one-hour publication validity. Explicit resumption up to 24 hours requires the same current actor, source issue/version and intact artifacts; creates a fresh review; and requires fresh human approval. Resumption does not rerun the application. Any source issue update conservatively invalidates the prior review.

A portable application package contains explicitly reviewed code and no original customer input. Forge verifies the embedded source/specification, approved runtime hashes and exact audited wrapper before accepting it. The receiving user inspects it and explicitly runs the synthetic fixture. The original baseline remains the source operator’s self-report. Where a recipient uses their own prepared checkout, its declared files must match.

Source/test code can contain private literals, credentials or sensitive names. Export performs heuristic checks and requires explicit review; short values, encoded secrets and business meaning still need human inspection. Public schema constants, keys, relationships and reversible Boolean changes can reveal information even when values change.

Optional [CI signatures](ci-provenance.md) verify exact public-artifact integrity under separately trusted keys. They do not automatically promote evidence to remote attestation; no provider-backed CI run has been performed for this project.
