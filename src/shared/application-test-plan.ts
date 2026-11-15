import type { InputSchema } from '../domain/input-contract';
import type { AiBrief, PreparedRepro } from './contracts';

export interface ApplicationTestOption { id: string; path: string; kind: string; proposal: string }
export interface ApplicationPlanSeed {
  fixtureHash: string;
  summary: string;
  options: ApplicationTestOption[];
}

/** The model may prioritise these proposals; it cannot author measured facts. */
export function applicationTestOptions(repro: PreparedRepro): ApplicationTestOption[] {
  if (!repro.inputContract) return [];
  const options: ApplicationTestOption[] = [];
  const add = (path: string, kind: string, proposal: string) => {
    if (options.length < 12) options.push({ id: `check-${options.length + 1}`, path, kind, proposal });
  };
  for (const relation of repro.inputContract.relations ?? []) {
    const path = `${relation.left} ${relation.operator} ${relation.right}`;
    add(path, 'declared-relation', `Proposed check: preserve and deliberately violate the declared ${relation.operator} relation at ${path.slice(0, 160)}.`);
  }
  function visit(schema: InputSchema, path: string) {
    if (options.length >= 12) return;
    if (schema.type === 'object') for (const key of Object.keys(schema.properties).sort()) visit(schema.properties[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    else if (schema.type === 'array') {
      add(path, 'array-boundary', `Proposed check: exercise valid and invalid array-size boundaries at ${path.slice(0, 160)}.`);
      visit(schema.items, `${path}/*`);
    } else if (schema.type === 'string') {
      if (schema.public && schema.enum) add(path, 'public-enum', `Proposed check: validate the explicitly public enum requirements at ${path.slice(0, 160)}.`);
      else if (schema.format === 'date' || schema.format === 'date-time') add(path, 'calendar-boundary', `Proposed check: exercise valid leap-day and calendar-boundary inputs at ${path.slice(0, 160)}.`);
      else if (schema.format === 'integer-string') add(path, 'integer-boundary', `Proposed check: exercise exact integer-string bounds and identity at ${path.slice(0, 160)}.`);
      else add(path, 'string-boundary', `Proposed check: exercise valid values near declared length and format boundaries at ${path.slice(0, 160)}.`);
    } else if (schema.type === 'number') add(path, 'number-boundary', `Proposed check: exercise declared numeric bounds and integer requirements at ${path.slice(0, 160)}.`);
  }
  visit(repro.inputContract.schema, '');
  return options;
}

export function applicationPlanSeed(repro: PreparedRepro): ApplicationPlanSeed {
  const evidence = repro.publicVerification;
  if (!evidence || evidence.verdict !== 'verified') throw new Error('A verified public application report is required.');
  const ordinary: Record<string, string> = {
    'hides-failure': 'Ordinary replacement passed and hid this failure.',
    'preserves-failure': 'Ordinary replacement also preserved this failure; no comparative advantage is claimed.',
    'different-failure': 'Ordinary replacement produced a different failure.',
    invalid: 'The ordinary comparison was invalid.',
    inconclusive: 'The ordinary comparison was inconclusive.',
  };
  const summary = `The local report records original and synthetic inputs failing the same declared assertion. ${ordinary[evidence.ordinaryControl] ?? ordinary.inconclusive} ${evidence.evidenceLevel === 'fix-validated' ? 'All three fixed-code inputs passed.' : 'Fix pending; no fixed revision was tested.'} These facts are computed from the report, not authored by AI.`;
  const options = applicationTestOptions(repro);
  if (!options.length) throw new Error('This public contract provides no supported next-test proposals.');
  return { fixtureHash: repro.fixtureHash, summary, options };
}

export function renderApplicationPlan(seed: ApplicationPlanSeed, selectedIds: unknown, model: string): AiBrief {
  if (!Array.isArray(selectedIds) || selectedIds.length < 1 || selectedIds.length > 3 || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => typeof id !== 'string' || !seed.options.some(option => option.id === id))) throw new Error('Unsupported application test-plan selection.');
  const selected = selectedIds.map(id => seed.options.find(option => option.id === id)!);
  return {
    fixtureHash: seed.fixtureHash, title: 'Proposed next checks for this application test', summary: seed.summary,
    reproductionSteps: ['Inspect the published fixture, application source and test requirements.', 'Use the exact reproduction command on the receiving issue.'],
    investigationAreas: selected.map(option => option.proposal),
    acceptanceCriteria: ['Run the proposed cases against the declared application assertion before drawing conclusions.', 'Keep unexecuted or unsupported proposals separate from measured results.'],
    caution: 'AI prioritised these unexecuted schema-based proposals. The factual summary is computed from the local report. Priorities can be irrelevant; review them. This does not establish a root cause, anonymity or a production fix.',
    model, planningMode: 'schema-selection', selectedChecks: selected.map(option => option.id),
  };
}
