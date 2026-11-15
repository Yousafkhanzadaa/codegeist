# Generic-engine capability on known upstream regressions

This is a predeclared capability exercise using the existing pinned Hermes and es-toolkit public cases. They were already known to the project; **this is not a blind benchmark, newly discovered upstream bug or independent user study**. No bespoke ReproShare precision/diacritics generator is invoked. The exact generic engine/runtime, task inputs and profiles were snapshotted before this run. The fixed oracle variants are the already documented pinned controls; this exercise makes no new claim about upstream merge status.

| Task | Expected task | Recorded result |
|---|---|---|
| U01 | Try the public Hermes precision-collision input | Reproduced with changed values; original, ordinary and synthetic fail the same assertion; all three fixed-code inputs pass |
| U02 | Try the public es-toolkit combining-mark input | Safe refusal: no safe failing variant after the bounded candidate search |
| U03 | Valid exactly representable Hermes integers | Correct refusal because original passes |
| U04 | Valid ASCII es-toolkit text | Correct refusal because original passes |
| U05 | Wrong Hermes JSON scalar type | Correct refusal of invalid source |
| U06 | Undeclared es-toolkit property | Correct refusal of invalid source |

Recorded denominator: **one of two positive upstream tasks reproduced; one safely refused. Four of four negative controls were correctly refused. Zero negatives were falsely verified.** This is a tiny selected sample, not an estimated real-world success rate.

Hermes' first valid replacement already preserved the failure, so this task demonstrates no advantage over the recorded ordinary control. The separate authored invoice-import tasks do show ordinary replacement passing while searched synthetic input retains failure. Preserve that distinction in presentations.

`first-results/evaluation.json` retains all six outcomes and candidate/run counts, including the unsupported case. It covers generation plus local original/ordinary/synthetic/fixed assertions. It does not demonstrate a new portable-package export, receiving-account permissions, MCP retrieval or a Jira publication. The existing specialised public-case runner remains a separate supported path for es-toolkit.

Run from the repository root with Node.js 24.22+ and Python 3.11+ in PATH, choosing a new directory:

```sh
node examples/heldout/upstream-generic-evaluation/evaluate.mjs --out new-upstream-generic-replay
```

The command executes explicitly configured local oracle code with bounded runtime/output and no inherited secrets. It makes no Jira changes. Re-running frozen tasks is a regression/replay; retain the first result rather than presenting later tuning as unseen performance.
