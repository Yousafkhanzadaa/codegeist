# Second independent real upstream case

ReproShare now generates synthetic input for an actual Unicode bug in **es-toolkit's deburr function**, independently of the existing Hermes integer-precision case. Preparation uses the regular ReproShare scan and generation APIs. The downloaded runner executes the real unchanged upstream function on the original, ordinary replacement and generated fixture.

[Upstream PR #1807](https://github.com/toss/es-toolkit/pull/1807) is both the public bug report and its merged fix. The reported input contains a combining mark that affected deburr leaves behind. Its fix expands two incomplete character ranges. The PR was merged on June 27, 2026.

| Pinned source | Revision |
|---|---|
| Affected immediate parent | [282174c916c5ce125fe40eb5e952072cef2e97ce](https://github.com/toss/es-toolkit/blob/282174c916c5ce125fe40eb5e952072cef2e97ce/src/string/deburr.ts) |
| Merged fixed revision | [4f5e0074714a3d1ed943dfb08cda77217e34ead2](https://github.com/toss/es-toolkit/blob/4f5e0074714a3d1ed943dfb08cda77217e34ead2/src/string/deburr.ts) |

Each revision contains the **complete unchanged** small TypeScript module and the original MIT license. There are no imports or runtime dependencies. Node.js 24 runs the original TypeScript through its built-in type stripping. Provenance records source URLs, SHA-256, Git blob identity and byte counts in [vendor/second-case/provenance.json](../vendor/second-case/provenance.json); the fixed blob identity was also compared with GitHub's commit API.

## What is proved

Input has exactly one field, text, containing 1–256 code points. Allowed characters are printable ASCII and combining-mark ranges U+0300–036F, U+20D0–20FF and U+FE20–FE2F. At least one ASCII letter or digit is required. This boundary excludes unrelated deburring behavior.

The assertion is the same for every supported input: remove the declared combining marks and preserve the ASCII characters. The affected revision omits U+20D0–20FF and U+FE24–FE2F.

| Actual upstream execution | Affected | Merged fix |
|---|---|---|
| Public original reported in PR | FAIL: combining-mark-retained | PASS |
| Ordinary ASCII replacement | PASS | PASS |
| ReproShare-generated changed text | FAIL: combining-mark-retained | PASS |

The generator changes the text value, replaces each combining mark with a different mark from the same supported/omitted category, and preserves code-point length and trigger count. It accepts unfamiliar valid inputs, rather than substituting one predetermined string. Tests cover both public reported examples, all 60 omitted code points, all supported range boundaries, unfamiliar mixed text and the 256-code-point limit.

## Reproduce from source

Use Node.js 24.22.1 or later within the 24.x series, install the project dependencies and run the focused source tests:

```sh
npm ci
npm test -- tests/domain/second-case.test.ts
```

The [test suite](../tests/domain/second-case.test.ts) uses the regular `scanPayload` and `prepareRepro` APIs, executes exported standalone runners and checks the actual upstream adapters. It covers source pins and licenses, supported input boundaries, fixture tampering, private-original handling and affected/fixed behavior. Temporary generated files are removed after each test.

To inspect and download a package interactively, run `npm run dev`, open the local preview, and choose **Real upstream bug: combining marks survive cleanup**. Prepare and review the package, then download the fixture and runner into an empty folder. Jira context/publication are simulated in local preview; no AI response is simulated. Run the exact command shown beside those files, for example:

```sh
node repro.mjs fixture.json
```

To compare a private original locally, append `--source /absolute/path/private-original.json`. The standalone exported runner embeds the pinned modules, licenses and adapter. Replay needs no network, AI, API key, package installation or Jira project. It verifies the exact fixture hash and accepts proof only if all six matrix results match. Invalid input, runtime errors and changed fixtures are rejected; raw text and exception details are not printed.

For additional verification with a declared oracle, see [local verification](local-verification.md) and the [pinned oracle configuration](../vendor/second-case/oracle.json). Reports are local self-reports with checksums; Forge does not independently attest to application execution. Do not publish source-side private verification inputs or reports directly.

To regenerate the embedded source bundle after an intentional pinned-source update:

```sh
node vendor/second-case/build-bundle.mjs
npm test -- tests/domain/second-case.test.ts
```

The [public evaluation kit](https://reproshare-policies.musfk.chatgpt.site/install/) also includes a separately labelled historical standalone replay. That specialised generator is distinct from the generic workflow: in the [generic upstream exercise](../examples/heldout/upstream-generic-evaluation/README.md), this family was safely refused rather than reproduced.

This proves one real library entry point under a declared boundary. It does not run a complete customer application, guarantee anonymization or guarantee correct behavior for all Unicode input. Field names, text length, combining-mark positions and trigger counts remain visible. Existing Jira projects were not accessed or changed.
