# ReproShare: uncoached pilot protocol

This is a prepared study protocol. No participants have been recruited or tested by writing it. Authored acceptance cases and controlled second accounts are not independent user evidence. Do not fill results with estimated savings or simulated participants.

Recruitment or messages to other people require the user's authorisation. The user may supply three to five consenting escalation engineers, developers or maintainers. Record a pseudonymous participant ID and role, not email addresses or customer identities. Begin with the provided fictional application inputs. Running a private customer case requires the participant's existing authorisation and an appropriate environment.

Give participants only the public installation guide, [application workflow guide](application-workflow.md), application source and task instructions below. Do not explain implementation details unless requested. Log each hint as assistance. Separate cold setup from repeated use. A short pilot produces observations from that pilot; it does not establish enterprise ROI or statistical generality.

1. **Cold setup.** In a clean authorised local application environment, connect an actual test, declare its input contract, initialise one service profile and reproduce the first failing input. Start timing when the participant first opens the instructions. Record active minutes, elapsed minutes, failures, hints and missing prerequisites. The suggested 10–15 minute connection target is a target, not an achieved result.
2. **Repeated inputs.** Supply three new supported payloads using the same profile. Record adapter/source changes separately from normal input changes. Time generation, local checking, disclosure review and completion. The suggested two-minute repeat handoff target is not a claim until observed.
3. **Manual comparison.** Use matched input pairs rather than repeating the same exact learned case. Alternate which task starts with manual fixture editing versus ReproShare. Count completion, active minutes, retained private data, unrelated failures and receiver questions. Include the one-time setup cost when presenting a short pilot; also report warm repeated cost separately.
4. **Negative controls.** Include a passing original, invalid input, unsupported dependency/state requirement and a failure that cannot survive changing a protected value. Refusal is a correct safety/scope outcome; it is not a reproduced bug. Publish denominators and all attempts.
5. **Disclosure comprehension.** Ask the participant what changed, which information remains visible, where original execution happens and what a receiver can independently run. Score against a prewritten answer key. Keep a first 30-second explanation check separate from a participant who has already used the product.
6. **Receiving engineer.** A different consenting participant receives only the approved synthetic fixture/test and ordinary code access. They must run the actual application assertion without the original customer input or source Jira issue. Record the exact command, environment, result, hints and follow-up questions.
7. **Jira/MCP lifecycle.** Use only brand-new dedicated test resources. Do not use or modify existing projects. Record resource IDs before writing. Publish a new current-version reviewed package, retrieve it as the receiving user, and test unavailable unapproved/tampered/stale artifacts plus a third user without destination access. Controlled accounts establish permission behaviour; they do not add independent participants to the usability sample.

Use an evidence table with these columns:

```csv
participant_id,role,task_id,condition,order,cold_setup_active_min,task_active_min,elapsed_min,completed,adapter_changes,hints,private_value_retained,receiver_reproduced,outcome_reason
```

Use outcome labels such as `reproduced`, `refused`, `invalid`, `inconclusive`, `setup_failed` and `assisted`. Record a successful real task only after the actual receiving assertion runs. Keep raw private inputs outside the results table and public report. Publish sample size, selection, assistance, task boundaries and every failure alongside medians or individual times. Avoid percentage savings when the comparator, setup treatment or sample size would make them misleading.

Judge-facing evidence should distinguish: implementation regression tests; frozen authored application tasks; current controlled account/access tests; and independent human observations. They answer different questions and cannot substitute for each other.
