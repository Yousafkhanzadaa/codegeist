import type { PreparedRepro } from './contracts';
import { applicationTestOptions } from './application-test-plan';

/** Exact application-specific AI context. No original, fixture scalars or private fingerprints. */
export function applicationBriefContext(repro: PreparedRepro) {
  const spec = repro.verificationSpec;
  const evidence = repro.publicVerification;
  if (!spec || !evidence) throw new Error('Import a verified application workflow before requesting its AI brief.');
  const stats = repro.workflowSummary;
  return {
    publicTest: { id: spec.id, assertionId: spec.assertionId, failureKind: spec.failureKind,
      ...(spec.failureSite ? { failureSite: spec.failureSite } : {}), affectedRevision: spec.affected.revision,
      ...(spec.fixed ? { fixedRevision: spec.fixed.revision } : {}) },
    inputRequirements: repro.inputContract,
    reportedOutcome: { evidenceLevel: evidence.evidenceLevel, ordinaryControl: evidence.ordinaryControl,
      original: evidence.matrix.original?.outcome, synthetic: evidence.matrix.synthetic?.outcome,
      ...(evidence.adapters.fixed ? { fixedSynthetic: evidence.matrix.fixedSynthetic?.outcome } : {}), repetitions: evidence.repetitions },
    search: { candidates: Number(stats?.candidates ?? 0), minimizationChecks: Number(stats?.minimizationChecks ?? 0), removedParts: Number(stats?.removedParts ?? 0) },
    proposedTestOptions: applicationTestOptions(repro),
  };
}
