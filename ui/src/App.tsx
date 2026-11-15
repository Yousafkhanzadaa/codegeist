import { useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import type {
  AiBrief, AiInvestigation, AiJobResult, ApplicationCaseId, Candidate, IssueContext, IssueTypeChoice, ProjectChoice, PublicationStatus, PublishedIssue,
  RequiredField, ReviewDraft, ScanResult,
} from '../../src/shared/contracts';
import { api, isPreview, openLink } from './api';
import type { Sample } from './api';
import { AiBriefCard, AiPlanCard } from './components/AiPanels';
import { ApplicationCaseCard } from './components/ApplicationCaseCard';
import { LocalVerificationPanel } from './components/LocalVerificationPanel';
import { DisclosureReview } from './components/DisclosureReview';
import { EvidenceStatus, evidenceState } from './components/EvidenceStatus';
import { InputRequirementsPanel } from './components/InputRequirementsPanel';
import { ApplicationWorkflowIntake } from './components/ApplicationWorkflowIntake';
import { ApplicationWorkflowSummary } from './components/ApplicationWorkflowSummary';
import { AiBriefConsent } from './components/AiBriefConsent';
import { RecentReviews } from './components/RecentReviews';
import { hermesInputContract, deburrInputContract } from '../../src/domain/default-contracts';

type Step = 1 | 2 | 3 | 4;
type IconName = 'arrow' | 'check' | 'shield' | 'file' | 'download' | 'external' | 'warning' | 'sun' | 'moon' | 'refresh' | 'braces' | 'copy';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" /></>,
    braces: <><path d="M9 3H7a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h2M15 3h2a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The request could not be completed. Try again or check your Jira permissions.';
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  return <div className={`notice notice-${tone}`}><Icon name={tone === 'success' ? 'check' : tone === 'warning' ? 'warning' : 'shield'} /><div>{children}</div></div>;
}

function Button({ children, onClick, disabled, loading, variant = 'primary', type = 'button', buttonRef }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost'; type?: 'button' | 'submit'; buttonRef?: Ref<HTMLButtonElement>;
}) {
  return <button ref={buttonRef} type={type} onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined} className={`button button-${variant}`}>
    {loading && <span className="spinner" aria-hidden="true" />}{children}
  </button>;
}

function JsonPreview({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const tokens = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi;
  let previous = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index ?? 0;
    if (index > previous) parts.push(text.slice(previous, index));
    const kind = match[2] ? 'key' : match[1] ? 'string' : match[3] ? 'literal' : 'number';
    parts.push(<span className={`json-${kind}`} key={index}>{match[0]}</span>);
    previous = index + match[0].length;
  }
  parts.push(text.slice(previous));
  return <>{parts}</>;
}

function CodeBlock({ text, title }: { text: string; title: string }) {
  const [copyStatus, setCopyStatus] = useState<'Copy' | 'Copied' | 'Unavailable'>('Copy');
  return <div className="code-block"><div className="code-bar"><span><i className="file-dot" />{title}</span><button className="icon-button copy-button" aria-label={`Copy ${title}`} onClick={() => {
    if (!navigator.clipboard) { setCopyStatus('Unavailable'); return; }
    void navigator.clipboard.writeText(text).then(() => { setCopyStatus('Copied'); setTimeout(() => setCopyStatus('Copy'), 1800); }).catch(() => setCopyStatus('Unavailable'));
  }}><Icon name={copyStatus === 'Copied' ? 'check' : 'copy'} size={15} /><span role="status">{copyStatus}</span></button></div><div className="code-body"><div className="code-lines" aria-hidden="true">{text.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre><code>{title.endsWith('.json') ? <JsonPreview text={text} /> : text}</code></pre></div></div>;
}

function RequiredInput({ field, value, onChange }: { field: RequiredField; value: unknown; onChange: (value: unknown) => void }) {
  const id = `required-${field.id}`;
  return <div className="field"><label htmlFor={id}>{field.name}<span className="required-mark">Required</span></label>
    {field.type === 'option' ? <select id={id} value={String(value ?? '')} onChange={e => onChange(e.target.value)} required>
      <option value="">Select {field.name.toLowerCase()}</option>{field.choices?.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select> : field.type === 'options' ? <select id={id} multiple value={Array.isArray(value) ? value.map(String) : []} onChange={e => onChange(Array.from(e.target.selectedOptions, option => option.value))} required>
      {field.choices?.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select> : field.type === 'unsupported' ? <p className="field-error">This required field is not supported here. Choose another issue type or update its Jira create screen.</p>
      : <input id={id} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={String(value ?? '')} required onChange={e => onChange(field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />}
    {field.type === 'options' && <p className="field-help">Use Ctrl or Command to select more than one option.</p>}
  </div>;
}

const stages = [
  { title: 'Source', detail: 'Choose an input' }, { title: 'Verify', detail: 'Keep the condition' },
  { title: 'Review', detail: 'Inspect the fixture' }, { title: 'Share', detail: 'Create a dev issue' },
] as const;

async function beforeDeadline<T>(request: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('AI did not finish within 150 seconds. You can continue with manual checks or try again.')), Math.max(1, deadline - Date.now()));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export default function App() {
  const [step, setStep] = useState<Step>(1);
  const [context, setContext] = useState<IssueContext | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [sourceJson, setSourceJson] = useState('');
  const [inputContract, setInputContract] = useState('');
  const [selectedSample, setSelectedSample] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [activeApplicationCaseId, setActiveApplicationCaseId] = useState<ApplicationCaseId | undefined>();
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [observedBehavior, setObservedBehavior] = useState('');
  const [consentToAi, setConsentToAi] = useState(false);
  const [investigation, setInvestigation] = useState<AiInvestigation | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiJobPhase, setAiJobPhase] = useState<'queued' | 'running'>('queued');
  const [briefConsent, setBriefConsent] = useState(false);
  const [aiBrief, setAiBrief] = useState<AiBrief | null>(null);
  const [aiBriefJobId, setAiBriefJobId] = useState('');
  const [includeAiBrief, setIncludeAiBrief] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [conditionConfirmed, setConditionConfirmed] = useState(false);
  const [seed, setSeed] = useState('');
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [fieldsReviewed, setFieldsReviewed] = useState(false);
  const [contentReviewed, setContentReviewed] = useState(false);
  const [artifactTab, setArtifactTab] = useState<'fixture' | 'report' | 'test'>('fixture');
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [projectId, setProjectId] = useState('');
  const [issueTypes, setIssueTypes] = useState<IssueTypeChoice[]>([]);
  const [issueTypeId, setIssueTypeId] = useState('');
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [extraFields, setExtraFields] = useState<Record<string, unknown>>({});
  const [summary, setSummary] = useState('');
  const [includeSourceReference, setIncludeSourceReference] = useState(false);
  const [showPublishConfirmation, setShowPublishConfirmation] = useState(false);
  const [published, setPublished] = useState<PublishedIssue | null>(null);
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatus | null>(null);
  const [publicationStatusError, setPublicationStatusError] = useState('');
  const [recoverIssueKey, setRecoverIssueKey] = useState('');
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [schemaError, setSchemaError] = useState('');
  const [fieldsLoaded, setFieldsLoaded] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { const saved = localStorage.getItem('reproshare-theme'); if (saved === 'light' || saved === 'dark') return saved; } catch { /* unavailable in some embedded contexts */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const publicationReviewTrigger = useRef<HTMLButtonElement>(null);
  const restorePublicationReviewFocus = useRef(false);
  const errorBanner = useRef<HTMLDivElement>(null);
  const schemaRequest = useRef(0);
  const typeRequest = useRef(0);
  const aiEpoch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; aiEpoch.current += 1; }; }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.getContext(), api.getSamples()]).then(results => {
      if (!active) return;
      const [contextResult, sampleResult] = results;
      if (contextResult.status === 'fulfilled') setContext(contextResult.value);
      else setError(message(contextResult.reason));
      if (sampleResult.status === 'fulfilled') setSamples(sampleResult.value);
      else { const reason = message(sampleResult.reason); setError(previous => previous || reason); }
      setInitializing(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('reproshare-theme', theme); } catch { /* optional preference */ }
  }, [theme]);

  useEffect(() => { heading.current?.focus(); }, [step]);

  useEffect(() => { if (draft) heading.current?.focus(); }, [draft?.reviewId]);
  useEffect(() => { if (published) heading.current?.focus(); }, [published]);
  useEffect(() => {
    if (showPublishConfirmation) confirmationHeading.current?.focus();
    else if (restorePublicationReviewFocus.current) {
      restorePublicationReviewFocus.current = false;
      publicationReviewTrigger.current?.focus();
    }
  }, [showPublishConfirmation]);
  useEffect(() => {
    if (!error) return;
    errorBanner.current?.focus({ preventScroll: true });
    errorBanner.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  useEffect(() => {
    if (step !== 4 || projects.length) return;
    let active = true;
    setBusy('projects');
    void api.getProjects().then(data => { if (active) setProjects(data); }).catch(err => { if (active) setError(message(err)); }).finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [step]);

  function resetRecovery() {
    setPublicationStatus(null); setPublicationStatusError(''); setRecoverIssueKey(''); setRecoveryConfirmed(false);
    setShowPublishConfirmation(false); setIncludeSourceReference(false);
  }
  function clearBrief() {
    setAiBrief(null); setAiBriefJobId(''); setIncludeAiBrief(false); setBriefConsent(false);
  }
  function invalidateAnalysis() {
    aiEpoch.current += 1;
    setInvestigation(null); setConsentToAi(false); setAiError(''); clearBrief();
    if (busy === 'investigate' || busy === 'brief') setBusy('');
    setScan(null); setDraft(null); setSelectedCandidate(''); setConditionConfirmed(false);
    setFieldsReviewed(false); setContentReviewed(false); setPublished(null); setShowPublishConfirmation(false); setError('');
    resetRecovery();
  }
  function changeSource(value: string) { setSourceJson(value); setInputContract(''); setActiveApplicationCaseId(undefined); invalidateAnalysis(); }
  function selectSample(id: string) {
    setSelectedSample(id); setAttachmentId('');
    const sample = samples.find(item => item.id === id);
    if (!sample) { setActiveApplicationCaseId(undefined); invalidateAnalysis(); return; }
    changeSource(sample.sourceJson);
    setActiveApplicationCaseId(sample.applicationCaseId);
    setInputContract(sample.applicationCaseId ? JSON.stringify(sample.applicationCaseId === 'hermes-integer-coercion' ? hermesInputContract : deburrInputContract, null, 2) : '');
    setExpectedBehavior(sample.expectedBehavior ?? ''); setObservedBehavior(sample.observedBehavior ?? '');
  }
  function changeReport(kind: 'expected' | 'observed', value: string) {
    if (kind === 'expected') setExpectedBehavior(value); else setObservedBehavior(value);
    invalidateAnalysis();
  }
  function chooseCandidate(id: string) {
    aiEpoch.current += 1; setSelectedCandidate(id); setConditionConfirmed(false); clearBrief();
    setFieldsReviewed(false); setContentReviewed(false); setDraft(null); resetRecovery();
  }
  function moveTo(next: Step) { setStep(next); setError(''); setShowPublishConfirmation(false); }
  const allChecksPass = Boolean(draft && draft.repro.checks.length && draft.repro.checks.every(check => check.passed));
  const reviewComplete = fieldsReviewed && contentReviewed && allChecksPass;
  const aiCanRecommend = investigation?.outcome === 'recommended' || investigation?.outcome === 'relevance_unconfirmed';
  const suggestedCandidate = aiCanRecommend ? investigation?.candidates.find(item => item.id === investigation.recommendedCandidateId) : undefined;
  const availableCandidates = investigation ? suggestedCandidate ? [suggestedCandidate] : [] : scan?.candidates ?? [];
  const candidate = availableCandidates.find(item => item.id === selectedCandidate);
  const briefMatchesFixture = Boolean(aiBrief && draft && aiBrief.fixtureHash === draft.repro.fixtureHash);
  const reviewedBriefIncluded = includeAiBrief && briefMatchesFixture && Boolean(aiBriefJobId);
  const selectedProject = projects.find(item => item.id === projectId);
  const selectedType = issueTypes.find(item => item.id === issueTypeId);
  const requiredComplete = requiredFields.every(field => {
    const value = extraFields[field.id];
    if (field.type === 'unsupported') return false;
    if (field.type === 'options') return Array.isArray(value) && value.length > 0;
    if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === 'string' && value.trim() !== '';
  });
  const readyToPublish = Boolean(reviewComplete && projectId && issueTypeId && fieldsLoaded && !schemaError && requiredComplete && summary.trim() && !published);
  const recoveryRequired = publicationStatus?.phase === 'unknown';
  const knownExistingIssue = publicationStatus?.issueKey;
  const resumingIssue = recoveryRequired || Boolean(knownExistingIssue);
  const publicationPending = publicationStatus?.phase === 'creating' && !knownExistingIssue;
  const recoveryReady = recoveryRequired && recoveryConfirmed
    && /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(recoverIssueKey)
    && Boolean(selectedProject && recoverIssueKey.startsWith(`${selectedProject.key}-`));
  const readyToSubmit = readyToPublish && !publicationStatusError && !publicationPending && (!recoveryRequired || recoveryReady);

  async function pollAiJob(jobId: string, kind: AiJobResult['kind'], epoch: number, deadline: number): Promise<AiJobResult | null> {
    while (Date.now() < deadline) {
      if (!mounted.current || aiEpoch.current !== epoch) return null;
      const result = await beforeDeadline(api.getAiJob({ jobId }), deadline);
      if (!mounted.current || aiEpoch.current !== epoch) return null;
      if (result.jobId !== jobId || result.kind !== kind) throw new Error('The AI response did not match this request. Try again or continue manually.');
      if (result.status === 'failed') throw new Error(result.error || 'The AI service could not complete this request. Manual verification remains available.');
      if (result.status === 'complete') return result;
      setAiJobPhase(result.status);
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(1, deadline - Date.now()))));
    }
    throw new Error('AI did not finish within 150 seconds. You can continue with manual checks or try again.');
  }
  function stopWaitingForAi() {
    aiEpoch.current += 1; setBusy(''); setAiError('Stopped waiting. The submitted AI job may still complete; its result will not be applied here.');
  }
  async function investigateWithAi() {
    if (isPreview || !consentToAi || !sourceJson.trim() || !expectedBehavior.trim() || !observedBehavior.trim() || !context) return;
    const epoch = ++aiEpoch.current;
    const deadline = Date.now() + 150_000;
    setBusy('investigate'); setAiJobPhase('queued'); setAiError(''); setError('');
    setInvestigation(null); setScan(null); setSelectedCandidate(''); setConditionConfirmed(false); setDraft(null);
    clearBrief(); setFieldsReviewed(false); setContentReviewed(false); setPublished(null); resetRecovery();
    try {
      const job = await beforeDeadline(api.startAiInvestigation({ sourceJson, expectedBehavior: expectedBehavior.trim(), observedBehavior: observedBehavior.trim(), consentToAi: true }), deadline);
      if (!mounted.current || epoch !== aiEpoch.current) return;
      const result = await pollAiJob(job.jobId, 'investigation', epoch, deadline);
      if (!result) return;
      if (!result.investigation) throw new Error('The AI job completed without a usable investigation. Continue with manual checks or try again.');
      setInvestigation(result.investigation); setStep(2);
    } catch (err) { if (mounted.current && epoch === aiEpoch.current) setAiError(message(err)); }
    finally { if (mounted.current && epoch === aiEpoch.current) setBusy(''); }
  }
  async function generateAiBrief() {
    if (isPreview || !draft || !briefConsent || !allChecksPass) return;
    const epoch = ++aiEpoch.current;
    const fixtureHash = draft.repro.fixtureHash;
    const deadline = Date.now() + 150_000;
    setBusy('brief'); setAiJobPhase('queued'); setAiError('');
    setAiBrief(null); setAiBriefJobId(''); setIncludeAiBrief(false); setContentReviewed(false); setShowPublishConfirmation(false);
    try {
      const job = await beforeDeadline(api.startAiBrief({ reviewId: draft.reviewId, consentToAi: true }), deadline);
      if (!mounted.current || epoch !== aiEpoch.current) return;
      const result = await pollAiJob(job.jobId, 'brief', epoch, deadline);
      if (!result) return;
      if (!result.brief || result.brief.fixtureHash !== fixtureHash) throw new Error('The AI brief did not match this fixture. Nothing was included in the handoff.');
      setAiBrief(result.brief); setAiBriefJobId(job.jobId);
    } catch (err) { if (mounted.current && epoch === aiEpoch.current) setAiError(message(err)); }
    finally { if (mounted.current && epoch === aiEpoch.current) setBusy(''); }
  }

  async function scanSource() {
    aiEpoch.current += 1; setInvestigation(null); setAiError(''); clearBrief();
    setBusy('scan'); setError(''); setDraft(null); setFieldsReviewed(false); setContentReviewed(false); resetRecovery();
    try {
      const result = await api.scan({ sourceJson }); setScan(result); setSelectedCandidate(''); setConditionConfirmed(false); setStep(2);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function prepare() {
    if (!candidate || !conditionConfirmed) return;
    aiEpoch.current += 1; clearBrief(); setAiError(''); setBusy('prepare'); setError(''); resetRecovery();
    try {
      const result = await api.prepare({ sourceJson, candidateId: candidate.id, seed: seed.trim(),
        ...(inputContract.trim() ? { inputContract } : {}),
        ...(investigation && suggestedCandidate?.id === candidate.id ? { investigationId: investigation.investigationId } : {}),
        ...(activeApplicationCaseId ? { applicationCaseId: activeApplicationCaseId } : {}),
      });
      setDraft(result); setSummary((/^ReproShare\b/i.test(result.repro.title) ? result.repro.title : `ReproShare: ${result.repro.title}`).slice(0, 255));
      setFieldsReviewed(false); setContentReviewed(false); setPublished(null);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function importLocalReport(reportJson: string) {
    if (!draft) return;
    setBusy('local-report'); setError('');
    try {
      if (!reportJson) throw new Error('Choose a local report of at most 24 KiB.');
      const result = await api.importLocalVerification({ reviewId: draft.reviewId, reportJson });
      aiEpoch.current += 1; clearBrief(); resetRecovery();
      setDraft(result); setFieldsReviewed(false); setContentReviewed(false); setPublished(null);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function importApplicationPackage(packageJson: string) {
    setBusy('workflow-import'); setError('');
    try {
      if (!packageJson || new Blob([packageJson]).size > 256 * 1024) throw new Error('Choose the source-side workflow-review.json package, at most 256 KiB. Do not select the private original or local-result.json.');
      const result = await api.importLocalWorkflow({ packageJson });
      aiEpoch.current += 1; clearBrief(); resetRecovery();
      setSourceJson(''); setSelectedSample(''); setAttachmentId(''); setActiveApplicationCaseId(undefined);
      setExpectedBehavior(''); setObservedBehavior(''); setConsentToAi(false);
      setInvestigation(null); setScan(null); setSelectedCandidate(''); setConditionConfirmed(false);
      setDraft(result); setSummary((/^ReproShare\b/i.test(result.repro.title) ? result.repro.title : `ReproShare: ${result.repro.title}`).slice(0, 255));
      setFieldsReviewed(false); setContentReviewed(false); setPublished(null); setStep(3);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function resumeReview(reviewId: string, renewExpired: boolean) {
    setBusy('resume-review'); setError('');
    try {
      const result = await api.resumeReview({ reviewId, ...(renewExpired ? { renewExpired: true } : {}) });
      aiEpoch.current += 1; clearBrief(); resetRecovery();
      setSourceJson(''); setSelectedSample(''); setAttachmentId(''); setActiveApplicationCaseId(undefined);
      setExpectedBehavior(''); setObservedBehavior(''); setConsentToAi(false);
      setInvestigation(null); setScan(null); setSelectedCandidate(''); setConditionConfirmed(false);
      setDraft(result); setSummary((/^ReproShare\b/i.test(result.repro.title) ? result.repro.title : `ReproShare: ${result.repro.title}`).slice(0, 255));
      setFieldsReviewed(false); setContentReviewed(false); setPublished(null); setStep(3);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function loadAttachment(id: string) {
    setAttachmentId(id); setActiveApplicationCaseId(undefined); invalidateAnalysis(); if (!id) return;
    setBusy('attachment'); setError('');
    try { const result = await api.readAttachment({ attachmentId: id }); changeSource(result.text); setSelectedSample(''); }
    catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function changeProject(id: string) {
    resetRecovery();
    const request = ++typeRequest.current; ++schemaRequest.current;
    setProjectId(id); setIssueTypeId(''); setIssueTypes([]); setRequiredFields([]); setExtraFields({});
    setFieldsLoaded(false); setSchemaError(''); setShowPublishConfirmation(false);
    if (!id) return;
    setBusy('issueTypes');
    try { const data = await api.getIssueTypes({ projectId: id }); if (request === typeRequest.current) setIssueTypes(data); }
    catch (err) { if (request === typeRequest.current) setSchemaError(message(err)); }
    finally { if (request === typeRequest.current) setBusy(''); }
  }
  async function changeIssueType(id: string) {
    resetRecovery();
    const request = ++schemaRequest.current;
    setIssueTypeId(id); setRequiredFields([]); setExtraFields({}); setFieldsLoaded(false); setSchemaError(''); setShowPublishConfirmation(false);
    if (!id) return;
    setBusy('fields');
    try {
      const data = await api.getFields({ projectId, issueTypeId: id });
      if (request === schemaRequest.current) { setRequiredFields(data); setFieldsLoaded(true); }
    } catch (err) { if (request === schemaRequest.current) setSchemaError(message(err)); }
    finally { if (request === schemaRequest.current) setBusy(''); }
  }
  async function refreshPublicationStatus() {
    if (!draft || !projectId) return;
    setBusy('status'); setPublicationStatusError(''); setShowPublishConfirmation(false);
    try { setPublicationStatus(await api.getPublicationStatus({ reviewId: draft.reviewId, projectId })); }
    catch (err) { setPublicationStatusError(`Publication status could not be checked. ${message(err)}`); }
    finally { setBusy(''); }
  }
  async function publish() {
    if (!draft || !readyToSubmit || !showPublishConfirmation) return;
    setBusy('publish'); setError('');
    try {
      const result = await api.publish({ reviewId: draft.reviewId, projectId, issueTypeId, summary: summary.trim(), extraFields, includeSourceReference, confirmedReview: reviewComplete,
        ...(recoveryRequired ? { recoverIssueKey } : {}),
        ...(reviewedBriefIncluded ? { aiBriefJobId } : {}),
      });
      setPublished(result); setShowPublishConfirmation(false);
    } catch (err) {
      setError(message(err)); setShowPublishConfirmation(false); setRecoveryConfirmed(false);
      try { setPublicationStatus(await api.getPublicationStatus({ reviewId: draft.reviewId, projectId })); setPublicationStatusError(''); }
      catch (statusError) { setPublicationStatusError(`Publication status could not be checked. ${message(statusError)}`); }
    } finally { setBusy(''); }
  }

  const artifact = draft ? artifactTab === 'fixture' ? draft.repro.fixtureJson : artifactTab === 'report' ? draft.repro.reportMarkdown : draft.repro.harnessCode : '';
  const artifactTitle = artifactTab === 'fixture' ? 'fixture.json' : artifactTab === 'report' ? 'report.md' : draft?.repro.profileId === 'application' ? 'application-reproducer.mjs' : 'repro.mjs';
  const applicationBrief = draft?.repro.profileId === 'application';

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><Icon name="braces" size={20} /></span><strong>ReproShare</strong><span className="brand-divider" /><span className="brand-view">Reproducer</span></div>
      <div className="header-actions"><button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div>
    </header>

    {isPreview && <div className="preview-banner"><span className="preview-dot" /><strong>Local engine preview</strong><span>Real checks. Jira context and publishing are simulated.</span></div>}

    <div className="workspace">
      <section className="source-context" aria-label="Source issue"><span className="context-label">Source</span><span className="context-slash" aria-hidden="true">/</span>
        {initializing ? <div className="skeleton context-skeleton" /> : context ? <><span className="issue-key">{context.key}</span><span className="context-title" title={`${context.projectName} · ${context.summary}`}>{context.summary}</span></> : <span className="context-title">Open ReproShare from a Jira issue to prepare a handoff.</span>}
      </section>

      <nav className="stepper" aria-label="Fixture preparation steps">{stages.map((stage, index) => {
        const number = (index + 1) as Step;
        const enabled = number === 1 || number === 2 && (!!scan || !!investigation || !!draft) || number === 3 && !!draft || number === 4 && reviewComplete;
        const complete = number < step;
        return <button key={stage.title} aria-label={`${stage.title} ${stage.detail}`} disabled={!enabled || !!busy} className={`step ${step === number ? 'step-active' : ''} ${complete ? 'step-complete' : ''}`} onClick={() => moveTo(number)} aria-current={step === number ? 'step' : undefined}>
          <span className="step-number">{complete ? <Icon name="check" size={16} /> : number}</span><span><strong>{stage.title}</strong></span>
        </button>;
      })}</nav>

      {error && <div ref={errorBanner} role="alert" tabIndex={-1} className="error-banner"><Icon name="warning" /><div><strong>We couldn’t complete that request</strong><p>{error}</p></div><button className="icon-button dismiss-error" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

      <main>
        {step === 1 && <div className="content-grid source-grid"><section className="panel main-panel"><div className="section-heading"><h1 ref={heading} tabIndex={-1}>Prepare a reproducer</h1><p>For escalation engineers handling restricted reports: share changed values that preserve a declared failure. Run the original only in your authorised environment and review what engineering receives.</p></div>
          <ApplicationWorkflowIntake disabled={!!busy || !context} onImport={importApplicationPackage} />
          <div className={`source-options ${sourceJson ? 'source-options-loaded' : ''}`}>{!sourceJson && <button className="sample-launch" type="button" disabled={!!busy || !samples.some(sample => sample.id === 'hermes-integer-coercion')} onClick={() => selectSample('hermes-integer-coercion')}><span><strong>Explore a real application bug</strong><small>Hermes regression · public input · offline runner</small></span><Icon name="arrow" size={16} /></button>}
          <div className="input-tools"><div className="field"><label htmlFor="sample">Try a synthetic example</label><select id="sample" value={selectedSample} disabled={!!busy} onChange={event => selectSample(event.target.value)}><option value="">Choose an example…</option>{samples.map(sample => <option key={sample.id} value={sample.id}>{sample.title}</option>)}</select></div>
            {context && context.attachments.length > 0 && <div className="field"><label htmlFor="attachment">Or read a JSON attachment</label><select id="attachment" value={attachmentId} disabled={!!busy} onChange={e => void loadAttachment(e.target.value)}><option value="">Choose an attachment…</option>{context.attachments.map(item => <option key={item.id} value={item.id}>{item.filename} · {Math.ceil(item.size / 1024)} KB</option>)}</select></div>}
          </div></div>
          {activeApplicationCaseId && <section className="application-case-intake" aria-labelledby="application-case-intake-title">
            <div className="application-case-topline"><span className="eyebrow">PUBLIC APPLICATION CASE</span><span className="application-case-badge">{activeApplicationCaseId === 'hermes-integer-coercion' ? 'Hermes Agent' : 'es-toolkit'}</span></div>
            <h2 id="application-case-intake-title">Real application regression</h2>
            <p>{activeApplicationCaseId === 'hermes-integer-coercion' ? 'Large chat IDs change during integer conversion. Prepare new IDs that retain the precision condition, with pinned application code to check locally.' : 'Text cleanup leaves some combining marks behind. Prepare different text that triggers the same incomplete cleanup, with unchanged affected and merged-fix code to run locally.'}</p>
            <details className="intake-details"><summary>Input requirements and scope</summary>
              <p>{activeApplicationCaseId === 'hermes-integer-coercion' ? 'The runner calls unchanged coerce_tool_args at affected and proposed-fix revisions. Use 2–32 calls with canonical positive 16–19 digit calls[].chat_id strings, at most 9223372036854775807. Node.js 22+ and Python 3.11+ are required.' : 'The runner calls the unchanged deburr function at affected and merged-fix revisions. Input contains only text: 1–256 code points consisting of printable ASCII and the declared combining-mark ranges, with an ASCII letter or digit. Node.js 24.22+ is required.'}</p>
              <p>No network or API key. Forge prepares the runner; application execution happens locally. Editing JSON or choosing an attachment clears this case; changing the seed keeps it.</p>
            </details></section>}
          <div className="field source-field"><div className="label-row"><label htmlFor="source-json">Source JSON</label><span>{sourceJson ? `${new Blob([sourceJson]).size.toLocaleString()} bytes` : 'Paste your input'}</span></div><div className="source-editor"><div className="source-editor-bar"><span><i className="file-dot" />source.json</span><span>Original input</span></div><textarea id="source-json" className="json-input" spellCheck={false} autoCapitalize="off" autoComplete="off" value={sourceJson} disabled={!!busy && busy !== 'investigate'} placeholder={'{\n  "records": [\n    { "id": "…" }\n  ]\n}'} onChange={e => { setSelectedSample(''); setAttachmentId(''); changeSource(e.target.value); }} aria-describedby="source-help" /></div><p className="field-help" id="source-help">Use the smallest relevant input. Field names and structure can also reveal context.</p></div>
          <div className="manual-action"><div><span className="action-icon"><Icon name="braces" size={17} /></span><span><strong>{activeApplicationCaseId ? 'Check the public regression' : 'Find a condition to preserve'}</strong><small>Code only. No AI request.</small></span></div><Button variant={activeApplicationCaseId || isPreview ? 'primary' : 'secondary'} onClick={() => void scanSource()} disabled={!sourceJson.trim() || !context || !!busy} loading={busy === 'scan' || busy === 'attachment'}>{activeApplicationCaseId ? 'Check this regression input' : 'Find supported conditions'} <Icon name="arrow" size={16} /></Button></div>
          <details className="optional-ai-panel" open={!!sourceJson.trim() && !activeApplicationCaseId}><summary><span className="ai-summary-icon">✧</span><span><strong>Investigate with Claude</strong><small>Optional · connect the report to a testable condition</small></span><span className="disclosure-plus" aria-hidden="true">+</span></summary><div className="optional-ai-body">
            <div className="report-fields"><div className="field"><label htmlFor="expected-behavior">Expected behavior <span className="optional-label">For AI investigation</span></label><textarea id="expected-behavior" rows={3} maxLength={2000} value={expectedBehavior} disabled={!!busy && busy !== 'investigate'} onChange={event => changeReport('expected', event.target.value)} placeholder="Two distinct order IDs should remain two orders." /></div><div className="field"><label htmlFor="observed-behavior">Observed behavior <span className="optional-label">For AI investigation</span></label><textarea id="observed-behavior" rows={3} maxLength={2000} value={observedBehavior} disabled={!!busy && busy !== 'investigate'} onChange={event => changeReport('observed', event.target.value)} placeholder="The import result contains one order after IDs are converted." /></div></div>
            <section className="ai-intake" aria-labelledby="ai-intake-title"><div className="ai-card-topline"><span className="ai-label">AI-ASSISTED INVESTIGATION</span><span className="ai-model">Atlassian-hosted Claude</span></div><h2 id="ai-intake-title">Get a reasoned plan for this report</h2><p>AI proposes a connection between your report and computed data conditions. Review its assumptions before choosing a check.</p><label className="checkbox-row ai-consent"><input type="checkbox" checked={consentToAi} disabled={isPreview || !!busy} onChange={event => setConsentToAi(event.target.checked)} /><span><strong>Send my report text, field paths and computed observations to Atlassian-hosted Claude.</strong><small>The server excludes original JSON scalar values. Report text is sent as entered; remove private details from it. Field names and paths may reveal context.</small></span></label>{isPreview && <p className="ai-unavailable" role="note">AI is unavailable in local preview. The deterministic checks above run locally; no model response is simulated.</p>}{aiError && <p className="ai-inline-error" role="alert">{aiError}</p>}<div className="ai-intake-actions"><span className="field-help">Expected behavior, observed behavior and consent are required for AI.</span><Button onClick={() => void investigateWithAi()} disabled={isPreview || !context || !sourceJson.trim() || !expectedBehavior.trim() || !observedBehavior.trim() || !consentToAi || !!busy} loading={busy === 'investigate'}>Investigate with AI <Icon name="arrow" size={16} /></Button></div>{busy === 'investigate' && <div className="ai-job-status" role="status"><span>{aiJobPhase === 'queued' ? 'AI investigation queued' : 'AI is analyzing the report'} · checking every 2 seconds</span><button type="button" className="text-button" onClick={stopWaitingForAi}>Stop waiting</button></div>}</section>
          </div></details>
          <div className="source-bottom-note"><Icon name="shield" size={15} /><span>Only reviewed output is published. Source access stays under Jira permissions.</span></div>{context && <RecentReviews issueId={context.id} disabled={!!busy} onResume={resumeReview} />}
        </section></div>}

        {step === 2 && <div className="content-grid"><section className="panel main-panel"><div className="section-heading"><h1 ref={heading} tabIndex={-1}>{draft ? draft.repro.publicVerification || draft.repro.localVerification ? evidenceState(draft.repro).title : draft.repro.applicationCase ? 'Reference condition retained; runner ready' : 'The condition survives replacement' : 'Choose the condition to retain'}</h1><p>{draft && (draft.repro.publicVerification || draft.repro.localVerification) ? 'Local execution results are bound to this package. Reproduction can be shared before a fix exists. Forge validated report consistency; it did not execute or attest to the application.' : draft?.repro.applicationCase ? 'Forge verified the reference data condition. Run the downloaded application check locally to execute the pinned application entrypoint.' : draft ? 'Compare the same bounded check across the source and generated fixture.' : 'These are candidate data characteristics. Confirm the one that matters to this report.'}</p></div>
          {investigation && (draft ? <details className="ai-plan-disclosure"><summary>AI investigation plan <span>Hypothesis, not diagnosis</span></summary><AiPlanCard investigation={investigation} selectedCandidateId={selectedCandidate} onChooseCandidate={chooseCandidate} disabled /></details> : <AiPlanCard investigation={investigation} selectedCandidateId={selectedCandidate} onChooseCandidate={chooseCandidate} disabled={!!busy} />)}
          {!draft && !!scan?.warnings.length && <div className="discovery-notes" role="note"><Icon name="warning" size={15} /><ul>{scan.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          {!draft && (!availableCandidates.length ? <div className="empty-state"><span className="empty-icon"><Icon name="braces" size={28} /></span><h2>{investigation ? 'No verified selection for this report yet' : 'No supported condition found'}</h2><p>{investigation ? 'Use the questions above to add context, or inspect the available conditions directly. No application reproduction has been established.' : 'ReproShare won’t invent a reproduction. Try a smaller relevant sample or inspect the report with a developer.'}</p><div className="empty-state-actions"><Button variant="secondary" onClick={() => moveTo(1)}>{investigation ? 'Revise the report' : 'Return to source'}</Button>{investigation && <Button variant="secondary" onClick={() => void scanSource()} disabled={!!busy}>Find supported conditions without AI</Button>}</div></div> : <>
            <fieldset className="candidate-group"><legend className="sr-only">Supported condition candidates</legend>{availableCandidates.map(item => <label key={item.id} className={`candidate-card ${selectedCandidate === item.id ? 'candidate-selected' : ''}`}><input type="radio" name="candidate" value={item.id} checked={selectedCandidate === item.id} disabled={!!busy} onChange={() => chooseCandidate(item.id)} /><div><span className="candidate-heading"><strong>{item.title}</strong><span className="count-tag">{item.occurrenceCount} {item.profileId === 'diacritics' ? item.occurrenceCount === 1 ? 'trigger mark' : 'trigger marks' : item.occurrenceCount === 1 ? 'value' : 'values'}</span></span><p>{item.description}</p><div className="path-tags">{item.paths.map(path => <code key={path}>{path}</code>)}</div></div></label>)}</fieldset>
            {candidate && <div className="condition-controls"><label className="checkbox-row"><input type="checkbox" checked={conditionConfirmed} disabled={!!busy} onChange={e => setConditionConfirmed(e.target.checked)} /><span><strong>This is the condition I want the fixture to retain.</strong><small>{investigation ? 'I considered the AI assumption above. This condition may still be unrelated to the original application failure.' : 'A candidate condition may be unrelated to the original application failure.'}</small></span></label><details className="seed-details"><summary>Advanced generation</summary><div className="field seed-field"><label htmlFor="seed">Generation seed <span className="optional-label">Private · optional</span></label><input id="seed" value={seed} placeholder="Fresh private randomness by default" disabled={!!busy} onChange={e => { setSeed(e.target.value); aiEpoch.current += 1; clearBrief(); setFieldsReviewed(false); setContentReviewed(false); }} maxLength={80} autoComplete="off" /><p className="field-help">Leave empty for fresh private randomness. A reused, guessable seed can link generations; keep any replay seed private. The received fixture is reproducible without this seed.</p></div></details></div>}
            {candidate && <InputRequirementsPanel value={inputContract} sourceJson={sourceJson} disabled={!!busy} onChange={value => { setInputContract(value); clearBrief(); setFieldsReviewed(false); setContentReviewed(false); }} />}
            <div className="panel-footer"><Button variant="ghost" onClick={() => moveTo(1)} disabled={!!busy}>Back</Button>{investigation && <Button variant="secondary" onClick={() => void scanSource()} disabled={!!busy}>Choose manually</Button>}<Button onClick={() => void prepare()} disabled={!candidate || !conditionConfirmed || !!busy} loading={busy === 'prepare'}>Generate and verify <Icon name="arrow" size={16} /></Button></div>
          </>)}
          {draft && <><div className={`proof-summary ${allChecksPass ? 'proof-summary-passed' : ''}`}><span className="proof-summary-icon"><Icon name={allChecksPass ? 'check' : 'warning'} size={22} /></span><div><strong>{draft.repro.checks.filter(check => check.passed).length} of {draft.repro.checks.length} data checks passed</strong><p>{draft.repro.profileId === 'application' ? 'Local disclosure check; inspect retained information' : `${draft.repro.changedValueCount} ${draft.repro.changedValueCount === 1 ? 'value' : 'values'} replaced`} · {evidenceState(draft.repro).detail}</p></div></div><div className="selected-condition"><span className="condition-icon"><Icon name="braces" /></span><div><span className="eyebrow">Selected condition</span><strong>{draft.repro.title}</strong></div><button className="text-button" disabled={!!busy} onClick={() => { aiEpoch.current += 1; clearBrief(); setDraft(null); setFieldsReviewed(false); setContentReviewed(false); resetRecovery(); }}>Change</button></div>
            {draft.repro.profileId === 'application' ? <><LocalVerificationPanel repro={draft.repro} disabled={!!busy} onImport={importLocalReport} /><ApplicationWorkflowSummary repro={draft.repro} /></> : <>            {draft.repro.applicationCase && <p className="reference-check-label">Reference-handler comparison · application code has not run in Forge</p>}<div className="comparison-heading"><h2>{draft.repro.comparison.label}</h2><span>Expected <strong>{draft.repro.comparison.expected}</strong> {draft.repro.comparison.unit}</span></div>
            <div className="comparison-grid">{([
              ['Source', draft.repro.comparison.source, 'Original input', 'source'],
              ['Ordinary replacement', draft.repro.comparison.ordinary, draft.repro.profileId === 'duplicates' ? 'Repeated IDs also retained' : 'Selected collision removed', 'ordinary'],
              ['Synthetic fixture', draft.repro.comparison.synthetic, 'Selected condition retained', 'synthetic'],
              ['Fixed handler', draft.repro.comparison.fixed, 'Reference correction', 'fixed'],
            ] as const).map(([label, count, caption, kind]) => <div className={`comparison-card comparison-${kind}`} key={label}><span>{label}</span><strong>{count}</strong><small>{caption}</small></div>)}</div>
            <p className="comparison-takeaway"><Icon name="braces" size={16} />Source and synthetic input {draft.repro.comparison.source === draft.repro.comparison.synthetic ? 'return the same result' : 'return different results'} in this reference check.</p></>}
            <div className="checks"><h2>Verification checks</h2>{draft.repro.checks.map(check => <div className={`check-row ${check.passed ? 'check-pass' : 'check-fail'}`} key={check.id}><span className="check-indicator"><Icon name={check.passed ? 'check' : 'warning'} size={15} /></span><div><strong>{check.label}</strong><p>{check.detail}</p></div><span className="check-result">{check.passed ? 'PASS' : 'FAIL'}</span></div>)}</div>
            {!allChecksPass && <Notice tone="warning">A verification check failed. You can inspect the output, but sharing is disabled. Return to the source or choose another condition.</Notice>}
            <div className="panel-footer"><span className="quiet-note">{draft.repro.profileId === 'application' ? 'Original values remain local' : `${draft.repro.changedValueCount} ${draft.repro.changedValueCount === 1 ? 'value' : 'values'} changed`}</span><Button onClick={() => moveTo(3)}>Review the output <Icon name="arrow" size={16} /></Button></div>
          </>}
        </section><aside className="sidebar"><section className="side-card">{draft?.repro.profileId === 'application' ? <><h2>Private original, received application test</h2><p>The source operator checked the original locally. The receiving engineer can run the reviewed synthetic fixture against the pinned application code without the original customer input.</p><div className="divider" /><p>Imported results are self-reported. Matching the declared assertion and failure site does not prove an identical root cause.</p></> : <><h2>Retained condition ≠ full reproduction</h2><p>The synthetic fixture should retain the selected characteristic. The fixed handler is a small reference check, not a patch to your application.</p><div className="divider" /><p>Run the generated test in the receiving environment before treating it as a regression test for the reported bug.</p></>}</section>{draft && <details className="side-card scope-limits"><summary>Scope and limits <span>{draft.repro.limits.length}</span></summary><p>These checks do not execute your application or certify anonymity.</p><ul>{draft.repro.limits.map((limit, i) => <li key={i}>{limit}</li>)}</ul></details>}</aside></div>}

        {step === 3 && draft && <div className="content-grid review-grid"><section className="panel main-panel"><div className="section-heading"><h1 ref={heading} tabIndex={-1}>Review the output</h1><p>Inspect the shared values, retained information and actual test. You choose what leaves the source issue.</p></div>
          <EvidenceStatus repro={draft.repro} reviewed={reviewComplete} />
          <DisclosureReview key={draft.reviewId} sourceJson={sourceJson} repro={draft.repro} />
          <div className="artifact-toolbar"><div className="artifact-tabs" role="tablist" aria-label="Generated artifacts">{(['fixture', 'report', 'test'] as const).map((tab, index, tabs) => <button key={tab} id={`artifact-tab-${tab}`} role="tab" aria-selected={artifactTab === tab} aria-controls="artifact-panel" tabIndex={artifactTab === tab ? 0 : -1} className={artifactTab === tab ? 'artifact-tab-active' : ''} onClick={() => setArtifactTab(tab)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            setArtifactTab(tabs[next]); document.getElementById(`artifact-tab-${tabs[next]}`)?.focus();
          }}>{tab === 'fixture' ? 'Synthetic JSON' : tab === 'report' ? 'Report' : 'Test harness'}</button>)}</div><button className="download-button" aria-label="Download" title={`Download ${artifactTitle}`} onClick={() => download(artifactTitle, artifact, artifactTab === 'fixture' ? 'application/json' : 'text/plain')}><Icon name="download" size={16} /><span>Download</span></button></div>
          <div id="artifact-panel" role="tabpanel" aria-labelledby={`artifact-tab-${artifactTab}`} tabIndex={0}><CodeBlock title={artifactTitle} text={artifact} /></div>
          <LocalVerificationPanel repro={draft.repro} disabled={!!busy} onImport={importLocalReport} />
          {draft.repro.profileId === 'application' && <ApplicationWorkflowSummary repro={draft.repro} />}
          {draft.repro.applicationCase && <ApplicationCaseCard applicationCase={draft.repro.applicationCase} repro={draft.repro} onOpenLink={openLink} />}
          <details className="transformations"><summary>Changes made <span>{draft.repro.transformations.length} rules</span></summary><p>Paths and transformation rules only. Original private values are not shown here.</p><div className="transformation-table">{draft.repro.transformations.map((change, i) => <div key={`${change.path}-${i}`}><code>{change.path}</code><span>{change.rule}</span></div>)}</div></details>
          <details className="optional-ai-panel optional-brief"><summary><span className="ai-summary-icon">✧</span><span><strong>Add an AI engineering brief</strong><small>{applicationBrief ? 'Optional · explain the application test and propose next checks' : 'Optional · based on the synthetic example'}</small></span><span className="disclosure-plus" aria-hidden="true">+</span></summary><div className="optional-ai-body"><section className="ai-brief-generator" aria-labelledby="brief-generator-title"><div className="ai-card-topline"><span className="ai-label">OPTIONAL ENGINEERING BRIEF</span><span className="ai-model">{applicationBrief ? 'Reviewed test metadata only' : 'Synthetic input only'}</span></div><h2 id="brief-generator-title">{applicationBrief ? 'Prioritise next checks for this application test' : 'Turn the verified example into an investigation brief'}</h2><p>{applicationBrief ? 'AI selects relevant checks from the displayed public schema options. The factual summary is computed from the execution report; AI cannot rewrite measured outcomes. Suggestions remain unexecuted proposals for your review.' : 'Ask AI to suggest reproduction steps, areas to inspect and acceptance criteria from this synthetic example. Its proposals are separate from the code-verified checks.'}</p><AiBriefConsent repro={draft.repro} checked={briefConsent} disabled={isPreview || !!busy} onChange={setBriefConsent} />{isPreview && <p className="ai-unavailable" role="note">AI briefs are unavailable in local preview. The fixture, report and executable harness remain available.</p>}{aiError && <p className="ai-inline-error" role="alert">{aiError}</p>}<div className="ai-intake-actions"><span className="field-help">A generated brief is omitted until you explicitly review and include it.</span><Button variant="secondary" onClick={() => void generateAiBrief()} disabled={isPreview || !briefConsent || !allChecksPass || !!busy} loading={busy === 'brief'}>{aiBrief ? 'Regenerate AI brief' : 'Generate AI brief'}</Button></div>{busy === 'brief' && <div className="ai-job-status" role="status"><span>{aiJobPhase === 'queued' ? 'AI brief queued' : 'AI is drafting the brief'} · checking every 2 seconds</span><button type="button" className="text-button" onClick={stopWaitingForAi}>Stop waiting</button></div>}{aiBrief && briefMatchesFixture && <AiBriefCard brief={aiBrief} included={includeAiBrief} disabled={!!busy} onIncludeChange={value => { setIncludeAiBrief(value); setContentReviewed(false); setShowPublishConfirmation(false); }} />}</section></div></details>
          <details className="fingerprint-card"><summary>Fixture fingerprint</summary><code className="fingerprint">{draft.repro.fixtureHash}</code><p className="field-help">Identifies this fixture. A fingerprint does not certify its safety.</p></details>
          <p className="review-boundary">Generated replacements do not guarantee anonymity. Review the output under your organization’s data-sharing rules.</p>
          <section className="review-checklist review-gate"><h2>Finish your review</h2><label className="checkbox-row"><input type="checkbox" checked={fieldsReviewed} disabled={!!busy} onChange={e => { setFieldsReviewed(e.target.checked); setShowPublishConfirmation(false); }} /><span><strong>I reviewed field names and structure.</strong><small>Keys, nesting and relationships may themselves reveal private information.</small></span></label><label className="checkbox-row"><input type="checkbox" checked={contentReviewed} disabled={!!busy} onChange={e => { setContentReviewed(e.target.checked); setShowPublishConfirmation(false); }} /><span><strong>I reviewed the fixture, report and test.</strong><small>{reviewedBriefIncluded ? 'I also reviewed the included AI brief. I am authorized to share this output with the destination team.' : 'I am authorized to share these values, evidence and any embedded application/test code with the destination team.'}</small></span></label><div className="review-status"><span className={reviewComplete ? 'status-dot status-ready' : 'status-dot'} /><span>{reviewComplete ? 'Review complete' : `${Number(fieldsReviewed) + Number(contentReviewed)} of 2 review steps complete`}</span></div></section>
          <div className="panel-footer"><Button variant="ghost" onClick={() => moveTo(2)} disabled={!!busy}>Back to verification</Button><Button disabled={!reviewComplete || !!busy} onClick={() => moveTo(4)}>Choose a destination <Icon name="arrow" size={16} /></Button></div>
        </section></div>}

        {step === 4 && draft && <div className="content-grid"><section className="panel main-panel"><div className="section-heading"><h1 ref={heading} tabIndex={-1}>{published ? isPreview ? 'Preview complete' : 'Ready for the receiving team' : resumingIssue ? 'Resume the existing development issue' : 'Create the reviewed development issue'}</h1><p>{published ? isPreview ? 'You completed the sample flow. No Jira issue was created.' : 'The receiving team can inspect the fixture and run its declared checks.' : resumingIssue ? 'Confirm the existing issue before resuming this reviewed handoff.' : 'Choose a destination and confirm exactly what will be created.'}</p></div>
          {published ? <div className="publish-success"><span className="success-icon"><Icon name="check" size={29} /></span><h2>{isPreview ? 'No live issue created' : `${published.key} ${published.reused ? 'was already created' : 'created'}`}</h2><p>{isPreview ? 'The local engine checked your fixture. Jira context and publishing were simulated; use ReproShare inside Jira to create a live handoff.' : published.reused ? 'ReproShare reused the existing issue and completed this handoff. A duplicate issue was not created.' : draft.repro.applicationCase ? 'The synthetic input and offline runner were shared with a labelled public upstream baseline.' : 'The original source report was not copied to this issue.'}</p>{!isPreview && reviewedBriefIncluded && published.aiBriefIncluded !== true && <div className="success-brief-notice"><Notice tone="warning">The existing handoff was reused without adding this new AI brief. Its original report is preserved. Use a fresh generation seed and review a new fixture if you need a separate handoff with the new brief.</Notice></div>}{!isPreview && published.aiBriefIncluded === true && <p className="success-brief-included">The handoff includes its reviewed AI brief.</p>}{!isPreview && published.url && <Button onClick={() => openLink(published.url)}>Open {published.key} <Icon name="external" size={16} /></Button>}<div className="success-download"><Button variant="secondary" onClick={() => download('fixture.json', draft.repro.fixtureJson, 'application/json')}><Icon name="download" size={16} /> Download fixture</Button></div></div> : <>
            <div className="field-row"><div className="field"><label htmlFor="destination-project">Destination project <span className="required-mark">Required</span></label><select id="destination-project" value={projectId} disabled={!!busy || showPublishConfirmation} onChange={e => void changeProject(e.target.value)}><option value="">{busy === 'projects' ? 'Loading projects…' : 'Choose a project…'}</option>{projects.map(project => <option value={project.id} key={project.id}>{project.key} — {project.name}</option>)}</select>{!busy && !projects.length && <p className="field-help">No destination projects are available with your current access.</p>}</div><div className="field"><label htmlFor="destination-type">Issue type <span className="required-mark">Required</span></label><select id="destination-type" value={issueTypeId} disabled={!projectId || !!busy || showPublishConfirmation} onChange={e => void changeIssueType(e.target.value)}><option value="">{busy === 'issueTypes' ? 'Loading types…' : 'Choose an issue type…'}</option>{issueTypes.map(type => <option value={type.id} key={type.id}>{type.name}</option>)}</select></div></div>
            <div className="field"><label htmlFor="issue-summary">Summary <span className="required-mark">Required</span></label><input id="issue-summary" value={summary} disabled={!!busy || showPublishConfirmation} maxLength={255} onChange={e => setSummary(e.target.value)} /><p className="field-help">Use a neutral title. Don’t include customer names, private identifiers or source details.</p></div>
            {busy === 'fields' && <p className="loading-line"><span className="spinner" /> Checking required Jira fields…</p>}
            {schemaError && <div className="schema-error"><Notice tone="warning">{schemaError}</Notice><Button variant="secondary" onClick={() => void changeIssueType(issueTypeId)} disabled={!!busy}><Icon name="refresh" size={15} /> Retry field check</Button></div>}
            <fieldset disabled={!!busy || showPublishConfirmation} className="required-fields">{requiredFields.length > 0 && <legend>Additional required fields</legend>}{requiredFields.map(field => <RequiredInput key={field.id} field={field} value={extraFields[field.id]} onChange={value => setExtraFields(previous => ({ ...previous, [field.id]: value }))} />)}</fieldset>
            <div className="source-reference"><label className="checkbox-row"><input type="checkbox" checked={includeSourceReference} disabled={!!busy || showPublishConfirmation || resumingIssue} onChange={e => setIncludeSourceReference(e.target.checked)} /><span><strong>Include a reference to {context?.key ?? 'the source issue'}</strong><small>{resumingIssue ? 'Recovery leaves the existing issue’s report and fields unchanged.' : 'Optional. A source key or link can reveal context. People opening it still need the source issue’s permissions.'}</small></span></label></div>
            {publicationStatusError && <div className="schema-error"><Notice tone="warning">{publicationStatusError} Check its status before taking another publication action.</Notice><Button variant="secondary" onClick={() => void refreshPublicationStatus()} disabled={!!busy} loading={busy === 'status'}>Check publication status</Button></div>}
            {publicationPending && <div className="schema-error"><Notice tone="warning">The earlier creation is still in progress. Reference: <code>{publicationStatus?.marker}</code>. Check its status before continuing.</Notice><Button variant="secondary" onClick={() => void refreshPublicationStatus()} disabled={!!busy} loading={busy === 'status'}>Check publication status</Button></div>}
            {recoveryRequired && <section className="recovery-panel" aria-labelledby="recovery-heading"><h2 id="recovery-heading">Resume an existing handoff</h2><p>The earlier creation was not confirmed. Find the existing engineering issue and check that its ReproShare publication reference matches this one.</p><div className="publication-reference"><span>Publication reference</span><code>{publicationStatus.marker}</code></div><div className="field"><label htmlFor="recover-issue-key">Existing engineering issue key <span className="required-mark">Required</span></label><input id="recover-issue-key" value={recoverIssueKey} maxLength={64} placeholder={`${selectedProject?.key ?? 'PROJECT'}-123`} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={!!busy || showPublishConfirmation} onChange={event => { setRecoverIssueKey(event.target.value.trim().toUpperCase()); setRecoveryConfirmed(false); }} aria-describedby="recover-issue-help" /><p id="recover-issue-help" className="field-help">Use an existing issue in {selectedProject?.key ?? 'the selected project'}. Recovery resumes its attachments; it does not create another issue.</p></div><label className="checkbox-row"><input type="checkbox" checked={recoveryConfirmed} disabled={!!busy || showPublishConfirmation || !recoverIssueKey} onChange={event => setRecoveryConfirmed(event.target.checked)} /><span><strong>I checked that this issue has the matching publication reference.</strong><small>The server also verifies the destination project, creator and reference before resuming.</small></span></label></section>}
            {knownExistingIssue && !recoveryRequired && <div className="resume-note"><Notice>This handoff already belongs to <strong>{knownExistingIssue}</strong>. Continuing resumes that issue’s reviewed files without creating another issue.</Notice></div>}
            {showPublishConfirmation ? <section className="publish-confirmation" aria-label={resumingIssue ? 'Confirm issue recovery' : 'Confirm issue creation'}><div className="confirmation-heading"><Icon name="shield" /><h2 ref={confirmationHeading} tabIndex={-1}>{resumingIssue ? 'Confirm the existing handoff' : 'Confirm the destination and content'}</h2></div><dl><div><dt>Destination</dt><dd>{selectedProject?.key} · {selectedProject?.name}</dd></div>{resumingIssue ? <><div><dt>Existing issue</dt><dd>{recoveryRequired ? recoverIssueKey : knownExistingIssue}</dd></div><div><dt>Reference</dt><dd><code>{publicationStatus?.marker}</code></dd></div><div><dt>Files</dt><dd>Reviewed synthetic JSON and test harness</dd></div><div><dt>Evidence</dt><dd>{evidenceState(draft.repro).title} · local self-report</dd></div><div><dt>AI brief</dt><dd>Original handoff selection is preserved</dd></div></> : <><div><dt>Issue type</dt><dd>{selectedType?.name}</dd></div><div><dt>Summary</dt><dd>{summary}</dd></div><div><dt>Evidence</dt><dd>{evidenceState(draft.repro).title}{(draft.repro.publicVerification || draft.repro.localVerification) && " · local self-report"}</dd></div><div><dt>Source reference</dt><dd>{includeSourceReference ? `Include ${context?.key ?? 'source reference'}` : 'Omitted'}</dd></div><div><dt>AI brief</dt><dd>{reviewedBriefIncluded ? 'Include the reviewed AI brief' : 'Omitted'}</dd></div></>}</dl><p>{resumingIssue ? <>Resumes the reviewed files on <strong>the existing issue</strong>. Its report and fields stay unchanged. No new issue will be created.</> : <>Creates <strong>one new issue</strong> with the reviewed synthetic fixture, report and test harness. The destination’s Jira permissions control who can see them.</>}</p>{isPreview && <Notice tone="warning">Preview only. This action will not create a real Jira issue.</Notice>}<div className="confirmation-actions"><Button variant="secondary" onClick={() => { restorePublicationReviewFocus.current = true; setShowPublishConfirmation(false); }} disabled={!!busy}>Go back</Button><Button onClick={() => void publish()} disabled={!readyToSubmit || !!busy} loading={busy === 'publish'}>{isPreview ? 'Complete preview' : resumingIssue ? 'Confirm and resume issue' : 'Confirm and create issue'}<Icon name="arrow" size={16} /></Button></div></section> : <div className="panel-footer"><Button variant="ghost" onClick={() => moveTo(3)} disabled={!!busy}>Back to review</Button><Button buttonRef={publicationReviewTrigger} disabled={!readyToSubmit || !!busy} onClick={() => { setShowPublishConfirmation(true); setError(''); }}>{resumingIssue ? 'Review recovery details' : 'Review creation details'} <Icon name="arrow" size={16} /></Button></div>}
          </>}
        </section><aside className="sidebar"><section className="side-card share-package"><h2>Only the reviewed output</h2><EvidenceStatus repro={draft.repro} reviewed={reviewComplete} published={!!published} /><ul><li><Icon name="check" size={16} /> Synthetic JSON fixture</li><li><Icon name="check" size={16} /> Verification report and limits</li><li><Icon name="check" size={16} /> Reproduction check harness</li>{reviewedBriefIncluded && <li><Icon name="check" size={16} /> Reviewed AI engineering brief</li>}</ul><div className="divider" /><p>{draft.repro.applicationCase ? 'The runner includes a labelled public upstream baseline. Arbitrary private source values are not embedded; an optional private original is read locally with --source. Review the remaining structure and narrative.' : 'The source attachment is excluded. Any declared public constants, field names, structure and AI narrative still need your review.'}</p><span className="reviewed-badge"><Icon name="check" size={14} /> Human review complete</span></section><Notice>Publishing does not change the source issue’s visibility or give the receiving team access to the original report.</Notice></aside></div>}
      </main>
      <footer className="app-footer"><span><Icon name="shield" size={14} /> Supported conditions. Explicit checks. Human review.</span><span>ReproShare · {isPreview ? 'Local preview' : 'Built on Forge'}</span></footer>
    </div>
  </div>;
}
