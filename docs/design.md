# ReproShare: a focused workspace

Design work: **14 November 2026**. The current interface applies research from Linear's March 2026 refresh, Vercel's Geist system, Atlassian's design guidance, and original usability research. See [sources and decisions](design-research.md).

## What changed

- **One working column.** Removed the enclosing page card and repeated explanatory sidebars. The editor, evidence and next action now share one alignment at every width.
- **Quiet navigation.** A compact wordmark and issue breadcrumb replace the large header and source card. Four small steps keep progress visible with a restrained active underline.
- **Readable product typography.** Self-hosted Geist Sans and Mono, 14px body text, 13px supporting text and a limited heading scale replace the mixed font stack and oversized presentation. Font source, hashes and distributed license notices are [recorded](../ui/src/assets/fonts/provenance.json).
- **Fewer surfaces.** White or charcoal backgrounds, subtle dividers and consistent 6px controls replace nested tinted cards. Violet identifies selection and primary actions; green and amber retain their semantic meaning.
- **Source first.** A compact public Hermes entry sits beside the example selector on desktop. The JSON editor and code-only preparation action precede optional investigation.
- **Evidence before explanation.** Verification uses a flat comparison strip and aligned check rows. Review opens with files, then the local runner command and optional provenance. The exact distinction between a reference check and application execution remains visible.
- **Focus follows the task.** Results, confirmation and success receive focus; Go back returns to the initiating action. New errors scroll into view and receive focus without disrupting ordinary edits.
- **Review at the decision point.** One required checklist sits directly above the destination action. AI investigation and briefing retain consent, limitations and explicit inclusion controls.

Generation, AI processing, storage, permissions, runner and publication behavior were not changed. No Jira issues, projects, memberships or settings were modified during this design work.

## See the result

The [local preview](http://127.0.0.1:5173/?demo=1) uses the actual generation engine. Jira context and publication are explicitly simulated, and no AI response is simulated.

Run `npm ci` and `npm run dev` from the repository root, then open the local preview. Source, Verification, Review and Share states are implemented in the [UI source](../ui/src/). [Browser workflow tests](../tests/browser/workflow.spec.ts) exercise the local flow, and the [application-workflow test](../tests/browser/application-workflow.spec.ts) covers source-side import and recipient execution.

Historical screenshots and unpublished video working files are excluded from this source release. The [public installation and evaluation guide](https://reproshare-policies.musfk.chatgpt.site/install/) provides the available demonstration package. Local preview imagery is not evidence of a live Jira publication.

## Validation

- TypeScript, the production UI build and Forge lint passed.
- All **7 existing browser workflow tests passed** after the final layout change. They cover actual fixture downloads/execution, review gating, invalidation, supported profiles and simulated publication.
- Captures at **1180, 1000, 800 and 390px** have no page overflow or browser errors; desktop and mobile light/dark captures were inspected.
- Additional **320px Source/Review** and **590px layout equivalent to a 1180px window at 200% zoom** checks have no page overflow. The latter is a layout-width check, not a claim of native browser-zoom accessibility certification.
- Both fonts load from local app resources. Arrow, Home and End keys select the correct artifact tabs; visible focus and named copy/download controls are preserved.

These checks describe the minimalist revision's local test scope; they are not an accessibility certification or a claim that every later release repeated every capture. Use `npm run typecheck`, `npm run build` and `npm run test:browser` to run the corresponding source checks in a prepared environment. Browser tests create local preview output, not Jira issues.
