# Reusable local application workflow

ReproShare can search for a changed-value input using an actual application test, then remove unnecessary fields or records while the same declared failure remains. This is bounded local execution. It can refuse. A matching assertion and failure site do not establish identical root cause or anonymity.

The primary operator is an escalation engineer in an environment authorised to hold the customer input and execute the application. An application engineer connects the test profile once. A receiving engineer needs the reviewed test/application source or an authorised matching checkout, but does not need the original customer input or private Jira issue.

## Connect once

Use a meaningful existing application invariant: a parsed identity must remain exact, an import must preserve a record, an output must obey a declared relation. An unrelated exception is an error, not a reproduced bug. Do not label every test-process nonzero exit as the same failure.

The Node and Python [adapter templates](../examples/workflow-templates/) show the structured protocol. They deliberately require an application test function you provide. They are not a preconfigured test or a claim of automatic support for arbitrary Jest/pytest suites. An existing test can share its underlying assertion function with these adapters; a framework-specific wrapper must establish the selected assertion rather than infer it from exit status.

Create an oracle configuration with a pinned entry point and every critical application/test file. Use safe relative paths. Hash the actual bytes with SHA-256. Example:

```json
{
  "version": 1,
  "id": "my-service-import",
  "assertionId": "service.selected-invariant.v1",
  "failureKind": "selected-invariant-failed",
  "failureSite": "service.selected-assertion.v1",
  "affected": {
    "revision": "your-reviewed-commit-or-build",
    "command": ["node", "adapter.mjs", "{input}"],
    "files": [
      { "path": "adapter.mjs", "sha256": "REPLACE_WITH_64_HEX_DIGEST" },
      { "path": "application-test.mjs", "sha256": "REPLACE_WITH_64_HEX_DIGEST" }
    ]
  }
}
```

The placeholders are intentionally invalid. A fix is optional. If you configure one, its declared tests must pass. Add critical application files and lock/build identities, not only the wrapper. Reports describe the declared-file scope rather than attesting to an entire unlisted dependency graph.

Define a closed JSON Schema for the application input. Import supports a bounded subset: closed objects, required fields, arrays and length bounds, scalar types, numeric bounds, supported string formats, and explicitly public enums/constants. Unsupported keywords such as `$ref`, `pattern`, unions and conditional schemas fail rather than disappear silently. OpenAPI documents need an explicit pointer to an inline supported schema. A ReproShare contract additionally supports bounded scalar relations.

```sh
node scripts/reproshare-workflow.mjs init --id my-service-import \
  --schema input-schema.json --oracle oracle.json --out service-profile.json
```

Use `--contract contract.json` instead of `--schema` for the existing contract language. For OpenAPI, add `--pointer /components/schemas/MyInput`. Enums/constants require `--public-constants` after reviewing every literal as safe for the destination. A schema's observed private values must not be promoted to public constants just to obtain a green result.

Keep the service profile local. It contains commands and file paths. Reuse it for subsequent inputs; do not write another bespoke generator per ticket. Recheck code pins when the application/test revision changes.

The `--id` service profile identifier must match `oracle.id`. A mismatch is rejected during initialisation rather than after running a search. Both identify the same predeclared public application test specification.

## Generate, test and minimise

```sh
node scripts/reproshare-workflow.mjs run --profile service-profile.json \
  --source private-original.json --cwd /absolute/authorised-application \
  --allow-command --out new-private-result-directory
```

`--allow-command` authorises the reviewed local executable with your OS permissions. The runner strips inherited secret environment variables, uses argv without a shell, limits output/time and checks pinned files before and after execution. It is not an OS sandbox. The app must be prepared to run without secret environment variables. No cloud/model/network request is made by the workflow command itself; explicitly authorised application code can use its normal OS permissions.

The source is parsed strictly and checked against the declared contract before application execution. The generator transforms private string and numeric values, preserves explicitly public constants, runs candidate tests, then attempts valid removals. It uses fresh private entropy; the seed is not exported. Original and accepted candidate trials must have stable matching failure identities. The bounded strategies include scalar lengths, ranges and supported formats; unsupported combinations can refuse even when a human could find a valid alternative.

Current numeric and date proposals use public requirements and private random entropy rather than known offsets of the original values. This removes a simple reversible-offset path; it does not hide retained constraints, shape or the selected failure property. Frozen older evaluation snapshots remain labelled historical evidence and should not be used to process new private inputs.

An authored local HTTP example is available under `examples/heldout`. Its profile pins paths relative to the repository root, so its `--cwd` must be the absolute repository root, not `examples/heldout`. It is an acceptance example, not a production customer incident or independent human trial. Frozen first-seen outcomes are recorded separately; later tests must not be relabelled as first unseen results.

Profile `budget` optionally sets `maxRuns` (8–128), `maxDurationMs` (500–120000) and `repeats` (2–3). These bound the **search**. The final report is a separate bounded verification using oracle limits; it is not included in the search-run count. The current report executor also supports its own repetitions and total-duration bounds. Report the two stages separately.

The result directory is new and private. Existing output directories are refused. It contains the synthetic fixture, an ordinary changed-value control, the local oracle, private verification inputs and `local-result.json`. Do not attach these private records directly to the receiving issue. The local result has private source/report commitments even though it does not contain the original payload.

`search-summary.json` reports candidates, actual runs, removals, budgets and byte counts without private values. Bounded minimisation is not proof of a globally smallest fixture. Object keys, structure, public constants and selected constraints can remain revealing. Boolean inversion is reversible and must be reviewed as retained information.

## Review code and export

Inspect all pinned application/test source, including comments and literals, before export. Remove or parameterise customer literals, credentials and private paths. The automatic scanner blocks matching protected strings of four or more characters, matching numeric literals with at least four digits, and some obvious credentials. It is heuristic: small constants, short strings, encoded/computed values and secrets outside those patterns still require human review.

```sh
node scripts/reproshare-workflow.mjs export --profile service-profile.json \
  --source private-original.json --result new-private-result-directory/local-result.json \
  --cwd /absolute/authorised-application --reviewed-code --out new-reviewed-directory
```

Export checks the source, fixture, test specification and current code pins. `--reviewed-code` confirms that the embedded application/test source is authorised for the receiving destination. The portable runner has a 140KiB limit and the source-side review JSON has a 220KiB limit; large dependency closures require a prepared authorised checkout or a smaller reviewed test boundary. These limits must not be bypassed by dropping necessary code pins.

Import **`workflow-review.json` into ReproShare from the source-authorised issue**. It is a private review transport, not a public receipt. Forge checks the fixture/test/report binding and creates a new review with new human approval. Public artifacts contain only the reviewed synthetic fixture, portable application test and allowlisted projected evidence. Check the public projection before publishing.

## Recipient execution

The receiving files are `fixture.json` and `application-reproducer.mjs`. The runner contains readable embedded reviewed source, not the generic reference handler. Inspect it, then run:

```sh
node application-reproducer.mjs --allow-command fixture.json
```

For a prepared application checkout with the pinned adapter/application files and dependencies:

```sh
node application-reproducer.mjs --allow-command fixture.json --cwd /authorised/checkout
```

The default path materialises the reviewed files in a fresh temporary directory and removes it afterward. The checkout path checks the same pins and executes there; it does not copy source files into the checkout. Explicitly authorised test code may itself write files or use services, so choose an appropriate test environment.

The receiver independently executes the synthetic input only. The original-input result remains the source operator's labelled local self-report. A missing dependency, altered fixture, wrong file pin, unrelated exception or failed fix cannot become a verified recipient result. The runner outputs allowlisted result fields, not private stdout/stderr. It makes no claim that running synthetic input independently validates the original private report.

## Evidence and limits

Authored local acceptance tests exercise search, removal, private-literal refusal, stable failure identity, three-input profile reuse, schema refusal, portable execution, missing consent and tampering. They are not independent customer trials or proof of unfamiliar upstream bug coverage. Frozen authored HTTP acceptance tasks are recorded separately. Cold setup cost and repeat-ticket savings still need consenting target users and an honestly reported baseline study.

The source repository includes [workflow unit tests](../tests/local/workflow.test.ts), [import acceptance tests](../tests/acceptance/local-workflow-import.test.ts) and a [fictional source-side review fixture](../tests/fixtures/application-workflow-review.json). That regression fixture is a private-transport *format* example made from fictional data, not a public recipient receipt or a customer record. Generate a fresh package for your own application and review it before sharing.
