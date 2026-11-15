#!/usr/bin/env node
// Current receiving-user probe restricted to fresh v4 project/issue allowlists.
// No Jira writes, credential-store access, browser control or artifact execution.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCiPublicReceipt } from '../local/ci-provenance.mjs';
import { parseVerificationSpec } from '../local/protocol.mjs';
import { canonicalJson } from '../local/json.mjs';

const ENDPOINT = 'https://mcp.atlassian.com/forge/9084b288-4229-48c6-940f-556f165a3e20';
const PROTOCOL = '2025-06-18';
const ALLOWED_ORIGINS = new Set(['https://mcp.atlassian.com', 'https://auth.atlassian.com', 'https://api.atlassian.com']);
const hash = value => createHash('sha256').update(value).digest('hex');
const READ_SCOPES = ['read:me', 'read:account', 'read:jira-work'];
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_ROOT = resolve(PROJECT_ROOT, 'artifacts/live/v4-current-workflow');
const ALLOWLIST_PATH = resolve(LIVE_ROOT, 'project-allowlist.json');
const HEX = /^[a-f0-9]{64}$/;
let options;
let REQUESTED_SCOPES;
let report;

export function parseWorkflowProbeOptions(args) {
  const result = { authenticated: true, authorize: false, sdkSession: false, noOpen: true, validateOnly: false, pauseForTargetDenial: false };
  const values = { '--allowlist': 'allowlist', '--issue': 'issueKey', '--deny-issue': 'denyIssueKey', '--unapproved-issue': 'unapprovedIssueKey',
    '--expected-fixture-sha256': 'fixtureSha256', '--expected-runner-sha256': 'runnerSha256', '--expected-actor-sha256': 'actorSha256',
    '--out': 'output', '--artifacts': 'artifacts' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw Error('duplicate-option');
    seen.add(flag);
    if (flag === '--authorize') result.authorize = true;
    else if (flag === '--sdk-session') result.sdkSession = true;
    else if (flag === '--no-open') result.noOpen = true;
    else if (flag === '--validate-only') result.validateOnly = true;
    else if (flag === '--pause-for-target-denial') result.pauseForTargetDenial = true;
    else if (values[flag] && typeof args[index + 1] === 'string' && args[index + 1] && !args[index + 1].startsWith('--')) result[values[flag]] = args[++index];
    else throw Error('invalid-options');
  }
  if (!result.allowlist || !result.issueKey || !result.denyIssueKey || !result.output || !result.artifacts
    || ![result.fixtureSha256, result.runnerSha256, result.actorSha256].every(value => typeof value === 'string' && HEX.test(value))) throw Error('required-policy-options-missing');
  if (!result.validateOnly && (!result.authorize || !result.sdkSession)) throw Error('fresh-sdk-authorization-required');
  return result;
}

export function validateWorkflowProbePolicy(value, input) {
  if (!value || value.site !== 'https://one-atlas-axke.atlassian.net' || value.existingProjectsMayBeWritten !== false
    || !Array.isArray(value.createdProjects) || value.createdProjects.length !== 2) throw Error('fresh-project-allowlist-required');
  const expected = { source: ['10204', 'R4S6A78'], destination: ['10205', 'R4D6A78'] };
  for (const [role, [id, key]] of Object.entries(expected)) {
    const item = value.createdProjects.find(project => project.role === role);
    if (!item || item.id !== id || item.key !== key) throw Error('unexpected-project-in-allowlist');
  }
  if (!Array.isArray(value.allowedIssueKeys) || value.allowedIssueKeys.length < 2 || value.allowedIssueKeys.length > 12
    || new Set(value.allowedIssueKeys).size !== value.allowedIssueKeys.length
    || value.allowedIssueKeys.some(key => typeof key !== 'string' || !/^(?:R4S6A78|R4D6A78)-[1-9][0-9]{0,9}$/.test(key))) throw Error('exact-new-issue-allowlist-required');
  if (!/^R4D6A78-[1-9][0-9]{0,9}$/.test(input.issueKey) || !/^R4S6A78-[1-9][0-9]{0,9}$/.test(input.denyIssueKey)
    || input.unapprovedIssueKey !== undefined && !/^R4D6A78-[1-9][0-9]{0,9}$/.test(input.unapprovedIssueKey)) throw Error('unexpected-project-key');
  const requested = [input.issueKey, input.denyIssueKey, input.unapprovedIssueKey].filter(Boolean);
  if (new Set(requested).size !== requested.length || requested.some(key => !value.allowedIssueKeys.includes(key))) throw Error('issue-not-explicitly-allowlisted');
  return { sourceProjectId: '10204', destinationProjectId: '10205', allowedIssueKeys: [...value.allowedIssueKeys], requestedIssues: requested };
}

let bearer;
let session;
let protocol = PROTOCOL;
let discoveredResource;
let discoveredAuthorizationServer;

function publicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    // Query/fragment may hold a transient OAuth code or state. Never save them.
    return url.origin + url.pathname;
  } catch { return undefined; }
}
function safeToken(value) { return typeof value === 'string' && /^[A-Za-z0-9._:/ -]{1,160}$/.test(value) ? value : undefined; }
function challenge(value) {
  if (!value) return undefined;
  const resource = /resource_metadata="([^"]+)"/i.exec(value)?.[1];
  const scope = /scope="([^"]+)"/i.exec(value)?.[1];
  const error = /error="([^"]+)"/i.exec(value)?.[1];
  return { scheme: /^Bearer\b/i.test(value) ? 'Bearer' : 'other', ...(publicUrl(resource) ? { resourceMetadataUrl: publicUrl(resource) } : {}),
    ...(safeToken(scope) ? { scope } : {}), ...(safeToken(error) ? { error } : {}) };
}
async function boundedBody(response, maximum, rpcId) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maximum) { await reader.cancel(); throw Error('response-byte-limit'); }
    chunks.push(Buffer.from(next.value));
    if (rpcId !== undefined && response.headers.get('content-type')?.startsWith('text/event-stream') && rpcPayload(Buffer.concat(chunks), rpcId)) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks);
}
async function request(label, url, init = {}, cap = 65_536, rpcId) {
  const parsed = new URL(url);
  if (!ALLOWED_ORIGINS.has(parsed.origin) || parsed.username || parsed.password || parsed.hash || parsed.search
    || parsed.origin === 'https://api.atlassian.com' && (!['/me', '/oauth/token/accessible-resources'].includes(parsed.pathname) || (init.method ?? 'GET') !== 'GET')) throw Error('discovery-url-rejected');
  const entry = { label, url: publicUrl(url), method: init.method ?? 'GET' };
  report.requests.push(entry);
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    entry.status = response.status;
    entry.contentType = (response.headers.get('content-type') ?? '').split(';')[0];
    const auth = challenge(response.headers.get('www-authenticate'));
    if (auth) entry.challenge = auth;
    const location = publicUrl(response.headers.get('location'));
    if (location && !['oauth-', 'actor-', 'site-'].some(prefix => label.startsWith(prefix))) entry.redirect = location;
    const bytes = await boundedBody(response, cap, rpcId);
    entry.responseBytes = bytes.length;
    if (!['oauth-', 'actor-', 'site-', 'tool-'].some(prefix => label.startsWith(prefix))) entry.responseSha256 = hash(bytes);
    else if (response.status >= 400) {
      try {
        const error = JSON.parse(bytes).error;
        if (['invalid_client_metadata', 'invalid_redirect_uri', 'invalid_request', 'invalid_scope', 'invalid_grant', 'invalid_client', 'unauthorized_client', 'unsupported_grant_type', 'access_denied', 'temporarily_unavailable', 'server_error'].includes(error)) entry.oauthError = error;
      } catch { /* never persist an arbitrary provider error body */ }
    }
    return { response, bytes, entry };
  } catch (error) {
    entry.errorCode = ['response-byte-limit', 'discovery-url-rejected'].includes(error.message) ? error.message
      : error.name === 'TimeoutError' ? 'network-timeout' : 'network-unavailable';
    return { entry };
  }
}
function rpcPayload(bytes, id) {
  const text = bytes.toString('utf8');
  const documents = text.trim().startsWith('{') ? [text] : text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean);
  for (const document of documents) {
    let value;
    try { value = JSON.parse(document); } catch { continue; }
    if (value?.jsonrpc === '2.0' && value.id === id) return value;
  }
  return undefined;
}
async function rpc(label, id, method, params) {
  if (method === 'tools/call' && (params?.name !== 'get-approved-reproducer' || !options.policy.allowedIssueKeys.includes(params?.arguments?.issueKey)
    || Object.keys(params.arguments).length !== 1)) throw Error('tool-call-not-allowlisted');
  const payload = { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) };
  const response = await request(label, ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocol, ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify(payload) }, method === 'tools/call' ? 524_288 : 65_536, id);
  if (response.response?.headers.get('mcp-session-id')) session = response.response.headers.get('mcp-session-id');
  const value = response.bytes && id !== undefined ? rpcPayload(response.bytes, id) : undefined;
  if (value?.error) response.entry.rpcErrorCode = Number.isInteger(value.error.code) ? value.error.code : 'unrecognized';
  return { ...response, value };
}
function metadataSummary(value) {
  const result = {};
  for (const key of ['resource', 'issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    const url = publicUrl(value?.[key]);
    if (url) result[key] = url;
  }
  for (const key of ['authorization_servers', 'scopes_supported', 'response_types_supported', 'grant_types_supported', 'code_challenge_methods_supported', 'token_endpoint_auth_methods_supported']) {
    if (Array.isArray(value?.[key]) && value[key].length <= 100) result[key] = value[key].filter(item => typeof item === 'string' && item.length <= 160).map(item => key === 'authorization_servers' ? publicUrl(item) : safeToken(item)).filter(Boolean);
  }
  if (typeof value?.authorization_response_iss_parameter_supported === 'boolean') result.authorization_response_iss_parameter_supported = value.authorization_response_iss_parameter_supported;
  return result;
}
async function discover(metadataUrl) {
  const candidates = metadataUrl ? [metadataUrl] : [
    'https://mcp.atlassian.com/.well-known/oauth-protected-resource/forge/9084b288-4229-48c6-940f-556f165a3e20',
    'https://mcp.atlassian.com/.well-known/oauth-protected-resource',
  ];
  let resource;
  for (const url of candidates) {
    const result = await request('protected-resource-metadata', url);
    if (result.response?.status !== 200) continue;
    try { resource = JSON.parse(result.bytes); } catch { continue; }
    report.metadata.protectedResource = metadataSummary(resource);
    discoveredResource = resource;
    break;
  }
  const server = resource?.authorization_servers?.[0];
  if (typeof server !== 'string') return;
  const issuer = new URL(server);
  if (!ALLOWED_ORIGINS.has(issuer.origin) || issuer.search || issuer.hash || issuer.username || issuer.password) return;
  const path = issuer.pathname.replace(/\/$/, '');
  const candidatesAs = [issuer.origin + '/.well-known/oauth-authorization-server' + path,
    issuer.origin + '/.well-known/openid-configuration' + path];
  for (const url of [...new Set(candidatesAs)]) {
    const result = await request('authorization-server-metadata', url);
    if (result.response?.status !== 200) continue;
    try {
      discoveredAuthorizationServer = JSON.parse(result.bytes);
      report.metadata.authorizationServer = metadataSummary(discoveredAuthorizationServer);
      break;
    } catch { /* try fallback */ }
  }
}

function oauthEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== 'https://auth.atlassian.com' || url.search || url.hash || url.username || url.password) throw Error('oauth-endpoint-rejected');
  return url.toString();
}
function equalState(left, right) {
  if (typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function authorize() {
  const metadata = discoveredAuthorizationServer;
  if (discoveredResource?.resource !== ENDPOINT || !metadata || !discoveredResource.authorization_servers.includes(metadata.issuer)
    || !metadata.code_challenge_methods_supported?.includes('S256') || !metadata.token_endpoint_auth_methods_supported?.includes('none')
    || !metadata.grant_types_supported?.includes('authorization_code')) throw Error('oauth-metadata-not-supported');
  for (const scope of REQUESTED_SCOPES) if (!discoveredResource.scopes_supported?.includes(scope)) throw Error('requested-scope-not-advertised');
  const authorizationEndpoint = oauthEndpoint(metadata.authorization_endpoint);
  const tokenEndpoint = oauthEndpoint(metadata.token_endpoint);
  const registrationEndpoint = oauthEndpoint(metadata.registration_endpoint);
  const requestedRegistrationGrantTypes = ['authorization_code', 'refresh_token'];
  report.oauth = { requestedScopes: REQUESTED_SCOPES, scopeBasis: options.sdkSession ? 'documented-sdk-session-profile-not-proven-required' : 'explicit-read-only-candidate-not-proven-minimal',
    clientProfile: 'sdk-session', pkce: 'S256', clientAuthentication: 'none',
    applicationType: 'native', requestedRegistrationGrantTypes, refreshExchange: 'never-used',
    tokenPersistence: 'process-memory-only', registration: 'not-started', callback: 'not-received' };
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  let resolveCallback;
  let rejectCallback;
  let consentRedirect;
  const callback = new Promise((done, failed) => { resolveCallback = done; rejectCallback = failed; });
  // Attach a rejection observer immediately, including while registration runs.
  callback.catch(() => {});
  let redirectUri;
  const server = createServer((request, response) => {
    const generic = (status, text) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" });
      response.end(text);
    };
    if (request.method !== 'GET' || typeof request.url !== 'string' || request.url.length > 8192 || request.headers.host !== new URL(redirectUri).host) return generic(400, 'Invalid OAuth callback.');
    const url = new URL(request.url, redirectUri);
    if (url.pathname === '/authorize') {
      if (url.search || !consentRedirect) return generic(400, 'Consent bridge unavailable.');
      response.writeHead(303, { Location: consentRedirect, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" });
      response.end(); return;
    }
    if (url.pathname !== '/callback' || url.searchParams.getAll('state').length !== 1 || !equalState(state, url.searchParams.get('state'))) return generic(400, 'Invalid OAuth state.');
    if ((metadata.authorization_response_iss_parameter_supported === true && !url.searchParams.has('iss'))
      || (url.searchParams.has('iss') && (url.searchParams.getAll('iss').length !== 1 || url.searchParams.get('iss') !== metadata.issuer))) return generic(400, 'Invalid OAuth issuer.');
    if (url.searchParams.has('error')) {
      generic(400, 'OAuth consent did not complete. You may close this tab.');
      rejectCallback(Error('oauth-consent-rejected'));
      return;
    }
    const code = url.searchParams.get('code');
    if (url.searchParams.getAll('code').length !== 1 || typeof code !== 'string' || code.length < 1 || code.length > 4096) return generic(400, 'Invalid OAuth code.');
    generic(200, 'ReproShare consent received. You may close this tab. The read-only check continues locally.');
    report.oauth.callback = 'state-validated';
    resolveCallback(code);
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  const timer = setTimeout(() => rejectCallback(Error('oauth-callback-timeout')), 10 * 60_000);
  try {
    await new Promise((done, failed) => { server.once('error', failed); server.listen(0, '127.0.0.1', done); });
    redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const registered = await request('oauth-public-client-registration', registrationEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_name: 'ReproShare read-only verification', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
        application_type: 'native', grant_types: requestedRegistrationGrantTypes, response_types: ['code'], scope: REQUESTED_SCOPES.join(' ') }) });
    if (![200, 201].includes(registered.response?.status)) throw Error('oauth-registration-failed');
    let registration;
    try { registration = JSON.parse(registered.bytes); } catch { throw Error('oauth-registration-malformed'); }
    if (typeof registration.client_id !== 'string' || registration.client_id.length < 1 || registration.client_id.length > 512
      || (registration.token_endpoint_auth_method !== undefined && registration.token_endpoint_auth_method !== 'none')
      || (registration.application_type !== undefined && registration.application_type !== 'native')
      || (registration.redirect_uris !== undefined && !registration.redirect_uris.includes(redirectUri))) throw Error('oauth-registration-mismatch');
    if (registration.grant_types !== undefined && (!Array.isArray(registration.grant_types)
      || registration.grant_types.length !== requestedRegistrationGrantTypes.length
      || new Set(registration.grant_types).size !== requestedRegistrationGrantTypes.length
      || registration.grant_types.some(grant => !requestedRegistrationGrantTypes.includes(grant)))) throw Error('oauth-registration-grants-mismatch');
    if (registration.scope !== undefined && (typeof registration.scope !== 'string' || registration.scope.split(/\s+/).filter(Boolean).some(scope => !REQUESTED_SCOPES.includes(scope)))) throw Error('oauth-registration-scope-mismatch');
    report.oauth.registration = 'public-client-registered';
    // A provider's optional secret/registration access token is never used,
    // logged or persisted. This client authenticates with PKCE and method none.
    const authorization = new URL(authorizationEndpoint);
    authorization.search = new URLSearchParams({ response_type: 'code', client_id: registration.client_id, redirect_uri: redirectUri,
      scope: REQUESTED_SCOPES.join(' '), state, code_challenge: codeChallenge, code_challenge_method: 'S256', resource: ENDPOINT,
      ...(options.sdkSession ? { prompt: 'consent' } : {}) }).toString();
    consentRedirect = authorization.toString();
    // Only a harmless local bridge URL leaves process memory. It contains no
    // OAuth client ID, code, state or PKCE verifier. Browser ownership is external.
    process.stdout.write(`Open receiving-user consent bridge: http://127.0.0.1:${server.address().port}/authorize\n`);
    const code = await callback;
    const exchanged = await request('oauth-code-exchange', tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.client_id, redirect_uri: redirectUri, code,
        code_verifier: verifier, resource: ENDPOINT }).toString() });
    if (exchanged.response?.status !== 200) throw Error('oauth-token-exchange-failed');
    let tokens;
    try { tokens = JSON.parse(exchanged.bytes); } catch { throw Error('oauth-token-response-malformed'); }
    // Registration compatibility metadata never enables a refresh path here.
    // Discard any unsolicited refresh token without logging or using it.
    if (tokens !== null && typeof tokens === 'object' && Object.hasOwn(tokens, 'refresh_token')) delete tokens.refresh_token;
    if (typeof tokens.access_token !== 'string' || !/^[A-Za-z0-9._~-]{16,16384}$/.test(tokens.access_token)
      || String(tokens.token_type).toLowerCase() !== 'bearer') throw Error('oauth-token-response-malformed');
    if (typeof tokens.scope === 'string') {
      const granted = tokens.scope.split(/\s+/).filter(Boolean);
      if (granted.some(scope => !REQUESTED_SCOPES.includes(scope))) throw Error('oauth-unrequested-scope-granted');
      if (REQUESTED_SCOPES.some(scope => !granted.includes(scope))) throw Error('oauth-requested-scope-not-granted');
      report.oauth.grantedScopes = granted;
      report.oauth.scopeConfirmation = 'token-response';
    } else report.oauth.scopeConfirmation = 'not-returned-by-token-endpoint';
    report.oauth.tokenExchange = 'bearer-received-in-memory';
    bearer = tokens.access_token;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(done => server.close(() => done()));
  }
}

function toolObjects(value) {
  const candidates = [value?.result?.structuredContent];
  for (const item of value?.result?.content ?? []) if (item?.type === 'text' && typeof item.text === 'string') {
    try { candidates.push(JSON.parse(item.text)); } catch { /* Do not save raw provider/tool text. */ }
  }
  return candidates.filter(item => item && typeof item === 'object' && !Array.isArray(item));
}

export function approvedWorkflowResult(value, expected) {
  const selected = toolObjects(value).find(item => item.status === 'approved_synthetic_example' && item.issueKey === expected.issueKey
    && typeof item.fixtureJson === 'string' && typeof item.harnessCode === 'string');
  if (!selected || value?.result?.isError || selected.localVerification?.kind !== 'reproshare-public-verification'
    || ['sourceHash', 'configurationHash', 'oracleHash'].some(key => Object.hasOwn(selected, key) || Object.hasOwn(selected.localVerification, key))) return { summary: { recognizedApprovedArtifact: false } };
  try {
    const receipt = validateCiPublicReceipt(selected.localVerification);
    const spec = parseVerificationSpec(selected.verificationSpec);
    if (receipt.testSpecHash !== hash(canonicalJson(spec)) || !selected.harnessCode.includes(receipt.evidenceHash)) return { summary: { recognizedApprovedArtifact: false } };
  } catch { return { summary: { recognizedApprovedArtifact: false } }; }
  const fixtureSha256 = hash(selected.fixtureJson); const runnerSha256 = hash(selected.harnessCode);
  const matches = fixtureSha256 === expected.fixtureSha256 && runnerSha256 === expected.runnerSha256 && selected.fixtureHash === fixtureSha256;
  return { summary: { recognizedApprovedArtifact: true, issueKey: expected.issueKey, fixtureBytes: Buffer.byteLength(selected.fixtureJson), fixtureSha256,
    runnerBytes: Buffer.byteLength(selected.harnessCode), runnerSha256, matchesExpectedApprovedBytes: matches,
    evidenceLevel: safeToken(selected.localVerification.evidenceLevel), privacyProjection: 'public-verification-only' },
    ...(matches ? { artifacts: { fixtureJson: selected.fixtureJson, harnessCode: selected.harnessCode,
      publicVerification: selected.localVerification, verificationSpec: selected.verificationSpec } } : {}) };
}

export function workflowDenialResult(value) {
  const objects = toolObjects(value);
  if (objects.some(item => typeof item.fixtureJson === 'string' || typeof item.harnessCode === 'string' || item.status === 'approved_synthetic_example')) return { verified: false, category: 'unexpected-artifact-returned' };
  const messages = new Map([
    ['No approved package is available under your current access.', 'current-access-unavailable'],
    ['This issue has no complete ReproShare publication receipt.', 'no-publication-receipt'],
    ['This older package requires a new privacy-reviewed publication before agent retrieval. Existing issues and files have not been changed.', 'legacy-publication-needs-review'],
  ]);
  const neutral = item => item && typeof item === 'object' && !Array.isArray(item) && item.status === 'not_available'
    && Object.keys(item).every(key => ['status', 'message'].includes(key)) && (item.message === undefined || messages.has(item.message));
  const allContentNeutral = Array.isArray(value?.result?.content) ? value.result.content.every(item => {
    if (item?.type !== 'text' || typeof item.text !== 'string') return false;
    try { return neutral(JSON.parse(item.text)); } catch { return false; }
  }) : true;
  if (!value?.result?.isError && objects.length && objects.every(neutral) && allContentNeutral) {
    const reason = messages.get(objects[0].message);
    return { verified: true, category: 'not-available-no-artifact', ...(reason ? { reason } : {}) };
  }
  // A generic RPC/tool500 is not sufficient evidence of permission denial.
  return { verified: false, category: value?.error || value?.result?.isError ? 'tool-error-inconclusive' : 'unrecognized-result-inconclusive' };
}

export function approvedTargetDenialResult(value) {
  const denial = workflowDenialResult(value);
  return { ...denial, verified: denial.verified && denial.reason === 'current-access-unavailable', noArtifactFieldsReturned: denial.verified };
}

/** No secret is accepted on stdin; only this explicit role-change signal. */
export function waitForTargetRevocation(stream, timeoutMs = 600_000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) return Promise.reject(Error('revocation-wait-time-limit'));
  return new Promise((done, failed) => {
    let input = Buffer.alloc(0); let finished = false;
    const settle = error => {
      if (finished) return; finished = true;
      clearTimeout(timer); stream.off('data', collect); stream.off('end', ended); stream.off('close', ended); stream.off('error', errored); stream.pause?.();
      if (error) failed(error); else done();
    };
    const collect = chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (input.length + bytes.length > 32) return settle(Error('revocation-check-signal-invalid'));
      input = Buffer.concat([input, bytes]);
      if (input.includes(10)) {
        const text = input.toString('utf8');
        settle(text === 'CHECK_REVOKED\n' || text === 'CHECK_REVOKED\r\n' ? undefined : Error('revocation-check-signal-invalid'));
      }
    };
    const ended = () => settle(Error('revocation-signal-stream-closed'));
    const errored = () => settle(Error('revocation-signal-stream-unavailable'));
    const timer = setTimeout(() => settle(Error('revocation-check-timeout')), timeoutMs);
    stream.on('data', collect); stream.once('end', ended); stream.once('close', ended); stream.once('error', errored); stream.resume?.();
    if (stream.readableEnded || stream.destroyed) ended();
  });
}

export function receiverIdentityMatches(profile, expectedHash) {
  if (!profile || typeof profile.account_id !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(profile.account_id)
    || typeof expectedHash !== 'string' || !HEX.test(expectedHash)) throw Error('receiver-identity-malformed');
  return equalState(expectedHash, hash(profile.account_id));
}

async function verifyActor() {
  const response = await request('actor-identity-memory-only', 'https://api.atlassian.com/me', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + bearer } });
  if (response.response?.status !== 200) { report.actor = { verified: false, method: 'read-me', result: 'identity-endpoint-unavailable' }; throw Error('receiver-actor-not-verified'); }
  let profile;
  try { profile = JSON.parse(response.bytes); } catch { throw Error('receiver-identity-malformed'); }
  const matched = receiverIdentityMatches(profile, options.actorSha256);
  profile = undefined;
  report.actor = { verified: matched, method: 'read-me-account-id-hash-compared-in-memory', matchesExpectedReceivingUser: matched,
    rawIdentityPersisted: false, reference: 'https://developer.atlassian.com/cloud/oauth/getting-started/faq/' };
  if (!matched) throw Error('wrong-receiving-user');
}

async function verifySiteGrant() {
  const response = await request('site-grant-memory-only', 'https://api.atlassian.com/oauth/token/accessible-resources', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + bearer } });
  if (response.response?.status !== 200) { report.siteGrant = { checked: false, result: 'grant-endpoint-unavailable', binding: 'exact-approved-issue-and-artifact-bytes-required' }; return; }
  let resources;
  try { resources = JSON.parse(response.bytes); } catch { throw Error('site-grant-malformed'); }
  if (!Array.isArray(resources)) throw Error('site-grant-malformed');
  const site = resources.find(item => item?.url === options.site && typeof item?.id === 'string' && item.id.length <= 128);
  report.siteGrant = { checked: true, matchesAllowlistedSite: Boolean(site), ...(site ? { cloudIdSha256: hash(site.id) } : {}),
    scope: 'grant availability only; MCP package bound by fresh issue key and expected artifact hashes' };
  if (!site) throw Error('allowlisted-site-not-granted');
}

async function preflight(input) {
  if (resolve(input.allowlist) !== ALLOWLIST_PATH || await realpath(input.allowlist) !== ALLOWLIST_PATH) throw Error('exact-allowlist-path-required');
  const stat = await lstat(input.allowlist);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024) throw Error('allowlist-file-rejected');
  const allowlist = JSON.parse(await readFile(input.allowlist, 'utf8'));
  input.policy = validateWorkflowProbePolicy(allowlist, input); input.site = allowlist.site;
  for (const path of [input.output, input.artifacts]) {
    const target = resolve(path);
    if (!target.startsWith(LIVE_ROOT + sep)) throw Error('fresh-live-output-directory-required');
    try { await lstat(target); throw Error('output-already-exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = await realpath(dirname(target));
    if (parent !== LIVE_ROOT && !parent.startsWith(LIVE_ROOT + sep)) throw Error('output-parent-rejected');
  }
}

export async function runWorkflowProbe(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/mcp-workflow-verify.mjs --allowlist artifacts/live/v4-current-workflow/project-allowlist.json --issue NEW_APPROVED_KEY --deny-issue NEW_SOURCE_KEY [--unapproved-issue NEW_CONTROL_KEY] --expected-fixture-sha256 SHA256 --expected-runner-sha256 SHA256 --expected-actor-sha256 SHA256 --out NEW_V4_REPORT.json --artifacts NEW_V4_PUBLIC_DIRECTORY --authorize --sdk-session --no-open [--pause-for-target-denial]\nUse --validate-only for local policy validation without any network or OAuth action.\nThe pause flag prints READY_FOR_TARGET_ACCESS_REVOCATION after the positive read, keeps credentials only in memory, and waits at most ten minutes for CHECK_REVOKED newline on stdin before rechecking the SAME approved issue. The UI owner changes only new destination project10205, then restores access after this process exits. Start with stdin available (tty:true).\nOnly fresh explicitly allowlisted issue keys are requested. The script never opens Chrome, executes an artifact, writes Jira, or saves credentials/OAuth state URLs.\n');
    return;
  }
  options = parseWorkflowProbeOptions(args); await preflight(options);
  if (options.validateOnly) { process.stdout.write('Fresh-project and exact-issue policy validated. No network request or OAuth registration performed.\n'); return; }
  REQUESTED_SCOPES = [...READ_SCOPES, 'offline_access'];
  report = { version: 1, kind: 'reproshare-current-receiving-user-external-mcp', observedAt: new Date().toISOString(), endpoint: ENDPOINT,
    scope: 'fresh-allowlisted-issues-only; read-only; no recipient execution in this process', allowlist: options.policy,
    requests: [], metadata: {}, result: 'not-completed', browserOwnership: 'external-receiving-user-window', credentialPersistence: 'process-memory-only' };
  try {
    let initialized = await rpc('initialize', 1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'reproshare-current-workflow-verifier', version: '1.0.0' } });
    await discover(initialized.entry.challenge?.resourceMetadataUrl);
    await authorize();
    await verifyActor();
    await verifySiteGrant();
    session = undefined;
    initialized = await rpc('authenticated-initialize', 1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'reproshare-current-workflow-verifier', version: '1.0.0' } });
    if (!initialized.value?.result?.protocolVersion) throw Error('initialize-not-accepted');
    protocol = initialized.value.result.protocolVersion;
    if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(protocol)) throw Error('unsupported-protocol-version');
    report.protocolVersion = safeToken(protocol);
    report.serverInfo = { name: safeToken(initialized.value.result.serverInfo?.name), version: safeToken(initialized.value.result.serverInfo?.version) };
    await rpc('initialized-notification', undefined, 'notifications/initialized');
    const listed = await rpc('tools-list', 2, 'tools/list', {});
    const tools = listed.value?.result?.tools;
    if (!Array.isArray(tools) || !tools.some(tool => tool?.name === 'get-approved-reproducer')) throw Error('approved-tool-not-discovered');
    report.discoveredToolNames = tools.slice(0, 50).map(tool => safeToken(tool?.name)).filter(Boolean);
    const approved = await rpc('tool-approved', 3, 'tools/call', { name: 'get-approved-reproducer', arguments: { issueKey: options.issueKey } });
    const selected = approvedWorkflowResult(approved.value, options);
    report.approvedResult = selected.summary;
    if (!selected.artifacts) throw Error('approved-retrieval-not-verified');
    const denied = await rpc('tool-source-denial', 4, 'tools/call', { name: 'get-approved-reproducer', arguments: { issueKey: options.denyIssueKey } });
    report.sourceDenial = { issueKey: options.denyIssueKey, ...workflowDenialResult(denied.value) };
    if (options.unapprovedIssueKey) {
      const control = await rpc('tool-unapproved-denial', 5, 'tools/call', { name: 'get-approved-reproducer', arguments: { issueKey: options.unapprovedIssueKey } });
      report.unapprovedDenial = { issueKey: options.unapprovedIssueKey, ...workflowDenialResult(control.value) };
    }
    // Only public, hash-matched artifact bytes are saved. Tokens remain in this
    // process; a separately reviewed recipient run happens after it exits.
    await mkdir(resolve(options.artifacts), { mode: 0o700 });
    await writeFile(resolve(options.artifacts, 'fixture.json'), selected.artifacts.fixtureJson, { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(options.artifacts, 'application-reproducer.mjs'), selected.artifacts.harnessCode, { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(options.artifacts, 'public-verification.json'), JSON.stringify(selected.artifacts.publicVerification, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (selected.artifacts.verificationSpec) await writeFile(resolve(options.artifacts, 'verification-spec.json'), JSON.stringify(selected.artifacts.verificationSpec, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    report.publicArtifactsSaved = { fixture: 'fixture.json', runner: 'application-reproducer.mjs', execution: 'not-executed-by-oauth-process', hashesMatchedBeforeSave: true };
    if (options.pauseForTargetDenial) {
      report.targetRevocation = { requested: true, verified: false, phase: 'waiting-for-explicit-role-change-signal', issueKey: options.issueKey,
        destinationProjectId: '10205', artifactBytesPreviouslyApproved: true, scope: 'same OAuth bearer and same previously approved issue; no membership mutation by script' };
      process.stdout.write('READY_FOR_TARGET_ACCESS_REVOCATION\n');
      await waitForTargetRevocation(process.stdin);
      report.targetRevocation.signalReceivedAt = new Date().toISOString();
      const revoked = await rpc('tool-approved-target-after-access-revoked', 6, 'tools/call', { name: 'get-approved-reproducer', arguments: { issueKey: options.issueKey } });
      const denial = approvedTargetDenialResult(revoked.value);
      report.targetRevocation = { ...report.targetRevocation, ...denial, phase: 'same-approved-target-rechecked',
        receiptAbsenceAloneIsNotPermissionProof: true };
    } else report.targetRevocation = { requested: false, verified: false, scope: 'source/unapproved controls alone do not establish current-user access enforcement on an approved target' };
    report.result = report.sourceDenial.verified && (!report.unapprovedDenial || report.unapprovedDenial.verified)
      && (!options.pauseForTargetDenial || report.targetRevocation.verified)
      ? 'receiving-user-retrieval-and-denials-verified' : 'receiving-user-retrieval-verified-denial-inconclusive';
  } catch (error) {
    report.result = 'verification-incomplete'; report.errorCode = /^[a-z][a-z0-9-]{0,70}$/.test(error.message) ? error.message : 'verification-unavailable';
  } finally { bearer = undefined; session = undefined; discoveredAuthorizationServer = undefined; discoveredResource = undefined; }
  await writeFile(resolve(options.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write('ReproShare receiving-user external MCP: ' + report.result + '. Sanitized report saved; credentials discarded.\n');
  if (report.result !== 'receiving-user-retrieval-and-denials-verified') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runWorkflowProbe(process.argv.slice(2)).catch(error => {
  const code = /^[a-z][a-z0-9-]{0,70}$/.test(error?.message ?? '') ? error.message : 'preflight-unavailable';
  process.stderr.write('ReproShare workflow MCP preflight failed [' + code + ']. No issue request authorised.\n'); process.exitCode = 1;
});
