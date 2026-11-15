# Authored application acceptance suite

This directory contains a small, realistic invoice-import HTTP application with an intentional regression. The request parser validates formats, unique IDs and cross-entity customer references before persistence. The affected invoice lookup truncates an otherwise valid customer ID to 32 characters; the fixed variant uses its exact value. The oracle checks the real HTTP response and invoice ownership. This is **an authored evaluation app**, not a newly discovered upstream vulnerability or customer incident.

Six tasks and a reusable profile were frozen before sharing them with the generic-generator author. The app defect was selected before inspecting the engine's implementation; shared workspace access means this is not a blinded human study. The exact first engine/runtime snapshot is preserved in `engine-snapshot/`. The first successful socket-enabled evaluation is immutable in `first-http-evaluation/`; the preceding sandbox socket failure is separately recorded in `first-evaluation/environment-failure.json` and is not counted as an algorithm result.

| Task | Input | Expected outcome | First recorded result |
|---|---|---|---|
| T01 | Valid 33-character customer IDs, two customers/invoices | Reproduce | Reproduced; portable actual-application test passed its expected failure check |
| T02 | Valid 48-character customer IDs | Reproduce using unchanged profile | Reproduced |
| T03 | Valid 64-character customer IDs | Reproduce using unchanged profile | Reproduced |
| T04 | Valid short IDs | Refuse because original passes | Correct refusal |
| T05 | Missing customer foreign key | Refuse invalid original | Correct refusal |
| T06 | Required fictional private token cannot change without rejection | Refuse after bounded search | Correct refusal |

The first result is **3/3 positive payloads for one defect family and 3/3 correct negative refusals**. It does not establish broad bug coverage or independent developer adoption. Each successful task used the same byte-identical profile, tried two candidates and removed six unnecessary parts. Recorded original-to-fixture sizes were 954→398, 1014→428 and 1092→464 bytes. Local timing is machine-specific and includes no human setup or review time. These are not ROI measurements.

`regression-with-optional-fix/evaluation.json` is a later seen-task regression. It separately verifies the optional fix after pre-fix reproduction and recipient replay. It must not replace or be relabelled as the first unseen result.

From the repository root, use Node.js 24.22+ and a new output directory:

```sh
node scripts/evaluate-workflow.mjs --engine frozen --out new-frozen-replay
node scripts/evaluate-workflow.mjs --engine current --out new-current-regression
```

The app binds loopback only; environments that prohibit local sockets need their normal local-test permission. The evaluation never calls Jira or changes a project. Oracle commands are explicitly authorised local code with OS user permissions, not an OS sandbox.

To generate a current source-side package and reuse the same profile:

```sh
node scripts/reproshare-workflow.mjs run \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json --cwd "$PWD" \
  --allow-command --out new-private-results

node scripts/reproshare-workflow.mjs export \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --result new-private-results/local-result.json --cwd "$PWD" \
  --reviewed-code --out new-reviewed-package
```

Review all pinned application/test source before giving `--reviewed-code`. In a source-authorised Jira panel, import only `workflow-review.json` through **Import application workflow**. This packet contains private verification commitments and must not be attached directly to the receiving issue. After review, ReproShare publishes the fixture and application runner with a public-only evidence receipt.

The receiver inspects the embedded code and runs:

```sh
node application-reproducer.mjs --allow-command fixture.json
```

The current local example artifact is `judge-review-package/`. It is separate from the frozen historical evidence and may be refreshed when the approved runner template/runtime changes. The receiver gets no original input. The fixture still discloses public constants, keys, necessary structure and bounded relationships; replacement and shrinking do not establish anonymity or root-cause equivalence.

See [PILOT.md](PILOT.md) for an optional self-service external-user protocol. It has not been performed. Known upstream cases are evaluated separately in `upstream-generic-evaluation/`, so the authored application is never presented as an upstream discovery.
