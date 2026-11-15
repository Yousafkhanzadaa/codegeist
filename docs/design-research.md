# Modern minimalism for ReproShare

Research reviewed **14 November 2026**. This document records the research and decisions behind the minimalist interface revision. Research alone does not establish usability or accessibility; see the [design implementation](design.md) and [browser workflow tests](../tests/browser/workflow.spec.ts) for the implemented behavior and test scope.

The references are primary sources: official product-redesign articles with app screenshots, live design-system documentation and original usability guidance. Marketing pages were not treated as evidence of an authenticated product workflow. Dated publications are identified below; undated system pages are living documentation reviewed on the research date.

## What the research supports

**Make the work more prominent than the surrounding interface.** Linear's **12 March 2026** product refresh reduces the prominence of navigation, makes tabs more compact, removes unnecessary icon treatments and simplifies supporting chrome. This is a current example of subtraction in an information-dense application. Its earlier **28 March 2024** redesign describes testing hierarchy, alignment, environment and both themes across real application states. ReproShare should borrow that discipline rather than reproduce Linear's workspace layout. [Linear's 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh), [Linear's 2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui).

**Use product typography rather than landing-page typography.** Geist identifies 14px copy as its common body style, 14px as its default button size, and 13px for secondary or space-constrained content. Its larger display styles are explicitly associated with marketing. Atlassian also specifies a 14px default body style and distinguishes semantic app headings from brand typography. The implication is readable, compact hierarchy—not oversized hero text or tiny metadata everywhere. [Geist typography](https://vercel.com/geist/typography), [Atlassian typography](https://atlassian.design/foundations/typography).

**Use spacing before extra containers.** Atlassian's spacing system uses an 8px base and proximity to communicate grouping, with smaller spacing within components and larger spacing between groups. Geist's everyday material uses a 6px radius and recommends the lowest useful elevation. These support fewer enclosing cards and predictable section spacing. They do not require removing the boundaries that identify an editable field. [Atlassian spacing](https://atlassian.design/foundations/spacing/), [Geist materials](https://vercel.com/geist/materials).

**Give the next action a clear priority.** Atlassian recommends one primary call to action within a page or area, concise action labels and icons only when they add a familiar affordance. Its form guidance keeps labels visible and places helper and error information with the relevant field. Essential instructions should not depend on placeholder text or a tooltip. [Button usage](https://atlassian.design/components/button/usage), [Form usage](https://atlassian.design/components/form/usage).

**Defer secondary detail without hiding the task.** Nielsen Norman Group's minimalist-design guidance, published **24 January 2021**, treats minimalism as preserving useful task information while reducing competing content. Its progressive-disclosure guidance, published **3 December 2006**, recommends keeping frequent essentials upfront and deferring advanced options. Geist's current Collapse guidance similarly reserves disclosure for optional or advanced content rather than primary page content. [Aesthetic and minimalist design](https://www.nngroup.com/articles/aesthetic-minimalist-design/), [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [Geist Collapse](https://vercel.com/geist/collapse).

**Keep narrow layouts and keyboard use in the design.** Apple's current layout guidance emphasizes the space actually available, alignment and grouping; a Jira panel cannot assume a full desktop viewport. Geist's tabs are for sibling views and preserve keyboard navigation. Its material guidance also calls for visible focus and checking separation in both themes. [Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout), [Geist tabs](https://vercel.com/geist/tabs), [Geist materials](https://vercel.com/geist/materials).

## Decisions for this revision

These are ReproShare-specific interpretations of the research, not universal requirements asserted by the sources.

| Decision | How it applies to the working app |
| --- | --- |
| Flat workspace | Remove large enclosing cards and repeated explanatory sidebars. Use one focused task column with section spacing and quiet rules. |
| Compact header | Keep the product identity, current issue and theme control. Reduce repeated taglines, status badges and source-separation messages. |
| Quiet progress navigation | Keep all four steps and their accessible names. Use a restrained selected state rather than a large tinted navigation container. |
| Readable type | Use 14px body text, a limited heading scale and restrained secondary text. Code remains readable and horizontally scrolls inside its viewer. |
| Geist font family | Choose self-hosted Geist Sans for interface text and Geist Mono for code. Vercel describes the family as designed for developer and design work. The separate [font provenance and license record](../ui/src/assets/fonts/provenance.json) identifies the pinned source commit, file hashes and bundled license. [Official Geist font](https://vercel.com/font). |
| Neutral surfaces | Use white and neutral gray in light mode, with corresponding neutral dark surfaces. Reserve violet for selection and key actions; retain semantic colors for results and errors. |
| Small, consistent radii | Use approximately 6px for normal controls and resting surfaces. Avoid layering several rounded, elevated containers around the same content. |
| One main action | Make manual preparation or the selected investigation action clear. Secondary sample selection, downloads and details remain discoverable without competing emphasis. |
| Necessary detail stays visible | Keep source input, generated artifacts, required review controls, consent and local-execution status at the point where the user needs them. |

The Source screen should lead with its editor and a compact public-example entry. Verification should emphasize the measured comparison through aligned rows or an unboxed strip. Review should lead with files, followed by local runner instructions and an optional provenance disclosure. Share should focus on the destination form and its explicit final confirmation. Package contents can appear as a compact receipt instead of a permanent explanatory sidebar.

## Constraints that minimalism must preserve

- Keep visible field labels, local errors, keyboard focus and named download/copy controls. Removing decoration must not remove affordances.
- Keep a single set of required human-review checkboxes beside the destination action. Do not duplicate hidden controls for responsive layouts.
- Preserve explicit consent for investigation and briefing, plus the separate choice to include a reviewed AI brief. A quieter AI section must not bypass these decisions.
- State that Forge preparation is **runner-ready**, and that **Forge has not executed Hermes**. The real application result requires the separate local runner.
- Keep the upstream entrypoint, local command, no-network/API-key requirements and a discoverable description of the pinned proposed fix and execution scope.
- Preserve source-change invalidation, case binding, permission checks and publication confirmation. This work changes presentation rather than the backend's trust or data boundaries.

The implementation was checked in light and dark themes at desktop, Jira-panel and mobile widths, with keyboard inspection and the existing workflow tests; see [design.md](design.md) for coverage and local preview instructions. A research-backed direction is not by itself evidence that the resulting interface is usable or accessible.
