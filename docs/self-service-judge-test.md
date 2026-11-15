# ReproShare: self-service judge test

This kit contains the current dependency-free local workflow, an intentionally faulty authored HTTP import application, frozen acceptance evidence, and two separately labelled historical upstream regressions. The HTTP app and all six inputs are fictional demonstration data. They are not customer incidents or a newly discovered upstream vulnerability. The optional independent-human pilot is **not performed**.

Use Node.js 24.22 or later. Python 3.11 or later is needed only for the historical Hermes replay. Local workflow testing does not require Jira, an AI account, a model key, npm installation or external network access. The HTTP example opens an ephemeral server on `127.0.0.1`; the environment must allow loopback sockets. Application code runs locally with the explicitly authorising user's OS permissions, not inside an OS sandbox.

## 1. Read and inspect

For the downloadable kit, extract the ZIP and open its `reproshare-workflow-judge-kit` folder. The same current-workflow commands work from the repository root of a source checkout. The historical replay folder in section 7 and `installation-url.txt` are kit-only additions, available through the [public download guide](https://reproshare-policies.musfk.chatgpt.site/install/). All commands below run from the extracted folder or repository root as appropriate. Inspect `examples/heldout/app.mjs`, `adapter.mjs` and `profile.json` before authorising execution. The application truncates a validated customer reference during invoice lookup. A changed, valid input should still expose that exact assertion failure.

The application profile pins those files relative to the extracted root. Keep this path layout. Use the absolute extracted folder as `--cwd`. The sample profile is already connected; [application-workflow.md](application-workflow.md) explains connecting your own application once.

## 2. Generate a new changed-value reproducer

```sh
node scripts/reproshare-workflow.mjs run \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --cwd "$PWD" --allow-command --out my-private-result-T01
```

Expected: exit zero and “Failure reproduced using changed values.” The new private directory contains a fixture, ordinary control, search summary and local result. Existing output directories are refused; choose a new name for another run.

Inspect `my-private-result-T01/search-summary.json`: runs, candidates, removals and elapsed search time are actual results from this run. It reports bounded minimisation, not a globally smallest fixture. The original input and accepted fixture must satisfy declared requirements and fail the same application assertion. A fixed revision is not required.

Repeat with `T02.json` and `T03.json`, choosing new result directories. All three use the byte-identical `profile.json` and adapter. These are three authored inputs for one intentional defect, not three independently discovered bugs or three users.

## 3. Review source and export

Inspect all source listed in the profile. The exported runner embeds this reviewed application/test code. For a real case, remove customer literals, credentials and unauthorised source before export. The automatic scanner is heuristic; the human review covers short strings, small constants and encoded values too.

```sh
node scripts/reproshare-workflow.mjs export \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --result my-private-result-T01/local-result.json \
  --cwd "$PWD" --reviewed-code --out my-reviewed-package-T01
```

Expected: a new directory with `fixture.json`, `application-reproducer.mjs`, `workflow-review.json` and instructions.

**`workflow-review.json` is a source-side review transport.** It contains private report bindings. Import it privately into ReproShare; never attach that JSON directly to the receiving issue. The app validates it and projects a separate public receipt. The original input, local service profile, local oracle, private verification inputs and local result are not recipient artifacts.

## 4. Act as the receiving engineer

Copy **only** `fixture.json` and `application-reproducer.mjs` to a new empty folder. Do not copy any original input or source-side review file. Inspect the embedded source, then run:

```sh
node application-reproducer.mjs --allow-command fixture.json
```

Expected: exit zero with `kind: reproshare-recipient-result`, the declared invoice assertion, and `results.affected.outcome: fail` with `matchedExpected: true`. This is a successful reproduction of the intended application failure. Exit zero does not mean the intentionally affected application is fixed.

The runner checks the fixture hash, materialises the reviewed pinned application/test files in a new temporary directory, executes the actual HTTP route and removes the temporary directory. No original data is required. The recipient independently validates the synthetic input's execution; original-input execution remains the source operator's labelled local self-report.

For a real prepared dependency environment, add `--cwd /authorised/application-checkout` after the fixture argument. That checkout must have the declared pinned files. The runner does not install dependencies or overwrite source files in that checkout. Explicitly authorised application tests can themselves use OS resources, so use a suitable test environment.

## 5. Check honest refusal

Run the generation command with these inputs and new output directories:

| Input | Profile | Expected |
|---|---|---|
| `fixtures/T04.json` | `examples/heldout/profile.json` | Refuse: the original passes the selected test |
| `fixtures/T05.json` | `examples/heldout/profile.json` | Refuse: the original violates input requirements |
| `fixtures/T06.json` | `examples/heldout/profile-private-prerequisite.json` | Refuse: no safe changed-value variant found within the bounded strategy/budget |

The fixture paths above are relative to `examples/heldout`. These commands should exit nonzero and leave no successful package. A safe refusal is an expected negative result; it is not a reproduced bug. The third input's token is explicitly fictional, provided to demonstrate that the workflow refuses to retain a protected prerequisite.

The automated evaluator can repeat all six authored tasks and optional fix controls:

```sh
node scripts/evaluate-workflow.mjs --engine current --round regression \
  --out my-new-evaluation
```

This is a regression run on now-visible tasks. The preserved first-seen snapshot and task hashes are under `examples/heldout/engine-snapshot.json`, `freeze.json` and `first-http-evaluation/evaluation.json`. Do not call a rerun a new blind or human evaluation.

## 6. Optional Jira review and handoff

Open the public [installation guide](https://reproshare-policies.musfk.chatgpt.site/install/). The guide links to the authorised Atlassian installer; the extracted kit also includes `installation-url.txt`. Install only on a newly dedicated evaluation site/project. Do not select an existing work project or issue. No Forge contributor invitation or new app registration is needed for a shared production installation.

Create fresh dedicated source and receiving projects with obvious test names. In a newly created source issue, open ReproShare and import `my-reviewed-package-T01/workflow-review.json` through the application workflow import. Review changed values, retained information, embedded code and execution scope. Import creates a new review; complete the human approval steps again. Publish only to the newly created receiving project.

The receiving engineer's account needs access to the new destination and ordinary application/test code, but no access to the source issue or original input. Retrieve the approved fixture/runner through the receiving issue or the approved MCP tool, then execute the actual assertion as in step 4. A denied or unavailable source must remain unavailable; do not change existing permissions to make the demonstration pass.

The public fixture/runner and projected receipt must not contain original-source hashes, private configuration/oracle checksums or the private report checksum. They may contain reviewed application/test hashes, public schema constants, field names, structural relations and synthetic artifact hashes. Review the retained disclosure rather than treating replacement as anonymity. MCP retrieves approved artifacts under the current caller's permissions; it does not execute application code or independently attest to the private original.

## 7. Historical real upstream regressions

These are preserved evidence and runnable checks from earlier build versions. They are not the current generic workflow demonstration, a new current Jira publication, or a private customer report.

```sh
node historical-upstream/hermes/repro.mjs historical-upstream/hermes/fixture.json
node historical-upstream/es-toolkit/repro.mjs historical-upstream/es-toolkit/fixture.json
```

Hermes executes the pinned Python integer-coercion entry point with unchanged source modules, not a whole agent session. Its fix was a public proposed revision at capture; see the included dated provenance. es-toolkit executes the actual pinned `deburr` utility module; its dated provenance records a merged fix. Both historical runners compare original, ordinary, synthetic and fixed controls and include MIT notices. Use their own saved results and source pins; do not treat old local reports as current runtime evidence.

The kit's `manifest.json` fingerprints every included file. `kit-validation.json` outside the extracted tree records a clean extraction and actual replay when available. Raw installation/publication account records and unpublished media are excluded from this source release. A passing local kit does not claim that remote installation, handoff or publication steps have already occurred.

The separate [generic-engine capability matrix](../examples/heldout/upstream-generic-evaluation/README.md) records attempts on the already known pinned upstream inputs, without bespoke generators: one of two positive tasks reproduced; es-toolkit safely refused; four negative controls correctly refused. In the frozen first record the Hermes ordinary control also failed. The later [source-independent-scalar seen regression](../examples/heldout/upstream-generic-evaluation/regression-source-independent-scalars/results/evaluation.json) again reproduces Hermes, with an ordinary control that now passes. Both records are preserved. This is neither a blind upstream study nor independent user evidence; the specialised es-toolkit runner above remains a separate supported path.

## Optional human pilot

Status: **not performed**. The [pilot protocol](pilot-protocol.md) is ready for consenting future participants. Authored tests, controlled second accounts, search runtimes and automated browser tests do not establish user comprehension, adoption or time savings. No participant outreach is performed by these scripts.
