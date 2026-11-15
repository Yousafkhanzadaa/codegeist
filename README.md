# ReproShare

**Keep the failure. Replace the data.**

ReproShare helps an escalation engineer turn a restricted JSON bug report into a reviewed, runnable synthetic application test. A local tool changes values, checks the real application assertion and removes unnecessary data. Jira carries the approved handoff; an engineering teammate or agent retrieves it through current-access Atlassian MCP checks. The original input stays in the source operator's local environment.

[Install and test on Jira](https://reproshare-policies.musfk.chatgpt.site/install/) · [Application workflow](docs/application-workflow.md) · [Judge guide](docs/judge-guide.md) · [Architecture](docs/architecture.md)

## How it works

1. Connect a reviewed application test once with a reusable profile. Declare valid inputs, a meaningful assertion, an optional failure site and pinned application/test files.
2. Run the local CLI with the original input and explicit command permission. It searches within fixed budgets for valid changed data that repeatedly fails the same assertion/site, then attempts to remove unnecessary fields or records. It can refuse.
3. Review the embedded code and export a source-side package. Import it privately into the ReproShare Jira panel.
4. Review retained information, the fixture, public report and runner, then explicitly confirm a new engineering handoff. The original and private report bindings are excluded from the public package.
5. Retrieve the approved fixture and runner through Jira or MCP. MCP checks current caller access, approval and attachment hashes. The receiver inspects the code and runs the actual application assertion using only synthetic input.

A fix is optional. The ordinary replacement is a measured comparison and can also retain the failure. If fixed-code validation is requested, all three valid inputs must pass. Optional Atlassian-hosted Claude prioritises predefined schema-based next checks; code supplies the measured factual summary. Those suggestions remain unexecuted proposals.

## Run the interface locally

Use **Node.js 24.22.1 or later in the 24.x series** and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173/?demo=1. The local engine runs real preparation checks. Jira context/publication are simulated, and AI is unavailable in this preview; no model response or real issue creation is simulated as live evidence.

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Browser checks use an installed Google Chrome. HTTP acceptance checks need permission to bind ephemeral loopback sockets; enable them with `REPROSHARE_HTTP_ACCEPTANCE=1 npm test -- tests/acceptance` when the environment permits. The tests use fictional or labelled public upstream data and do not require a Jira account or credentials.

## Try the local application workflow

The authored invoice-import example contains an intentional long-reference lookup defect. Inspect `examples/heldout/app.mjs`, its adapter and profile first. From this repository's root:

```sh
node scripts/reproshare-workflow.mjs run \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --cwd "$PWD" --allow-command --out .local-results/source

node scripts/reproshare-workflow.mjs export \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --result .local-results/source/local-result.json \
  --cwd "$PWD" --reviewed-code --out .local-results/review

node .local-results/review/application-reproducer.mjs \
  --allow-command .local-results/review/fixture.json
```

The commands require new output directories and an environment that permits local HTTP sockets. Original and synthetic fail the same declared assertion; ordinary short aliases hide this example's failure. Recipient exit zero with `matchedExpected: true` means the intended failure reproduced. Import `.local-results/review/workflow-review.json` privately into Jira; do not attach that source-side transport directly to the receiving issue.

The same profile handles `T02.json` and `T03.json`. `T04` is a passing original, `T05` is invalid and `T06` requires a protected prerequisite that cannot safely change; those cases should refuse. This is an authored evaluation application, not a customer incident or independent human study.

## Evidence and limits

The frozen authored evaluation reproduced three payloads for one intentional defect family and correctly refused three negative controls. A separate generic-engine exercise reproduced one of two known real upstream families and refused all four negative controls. Later seen regressions and specialised Hermes/es-toolkit runners remain separately labelled, with original licences and pinned source under `vendor/`. These results do not estimate arbitrary-bug coverage or customer time savings.

Original-input execution is a local self-report. Forge validates report/specification/package bindings and does not attest execution. Reviewed commands execute with local OS permissions, not an OS sandbox. A matching assertion/site does not establish identical root cause. Keys, constants, structure, lengths and relationships may disclose context; synthetic data is not an anonymity guarantee. Independent human trials and provider-attested CI execution have not been performed.

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | Forge resolvers, permission/receipt checks, synthesis domain and optional AI jobs |
| `ui/` | React/TypeScript Custom UI with minimalist review and disclosure flows |
| `local/`, `scripts/` | Reusable local execution, synthesis, schema import and verification CLI |
| `examples/` | Fictional application, public upstream inputs, reusable adapter and CI templates |
| `tests/` | Domain/server/process/browser checks with self-contained public test fixtures |
| `vendor/` | Pinned MIT upstream source, notices and provenance |
| `docs/` | Workflow, architecture, design, AI and testing guides |

Local credentials, development tool installations, raw Jira/account records, internal submission planning, generated production review transports and unpublished media are excluded by `.gitignore`. Authored evaluation snapshots may use filenames containing `private` to describe their protocol role; all inputs in those committed evaluation datasets are fictional or explicitly public.

The manifest references the existing registered ReproShare app. Install that app through the public guide. For an independently deployed fork, register your own Forge app and use its app ID; do not deploy a fork into the original registration. Build the UI before deployment. `scripts/forge` is a workspace convenience wrapper for locally installed tools under `.tools/`, which are not committed.

Vendored upstream code and Geist fonts retain their licence files and dated provenance. Codex assisted implementation, research, testing, design and demo preparation.
