#!/usr/bin/env node
// Bounded, read-only MCP transport probe. No credential-store or client-config
// access. Optional bearer input arrives only on stdin and is never persisted.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ENDPOINT = 'https://mcp.atlassian.com/forge/9084b288-4229-48c6-940f-556f165a3e20';
const PROTOCOL = '2025-06-18';
const EXPECTED_APPROVED = { fixtureSha256: 'b80db748094e19e87f23d32f60689f955fb5e3c0ce7c08d136cdc050de35402c', runnerSha256: '8d5c8ef96ff120532efd30c0547924f7f6023c61bee653f9aa0a682c845b7283' };
const ALLOWED_ORIGINS = new Set(['https://mcp.atlassian.com', 'https://auth.atlassian.com']);
const hash = value => createHash('sha256').update(value).digest('hex');
const READ_SCOPES = ['read:me', 'read:account', 'read:jira-work'];
const options = { authenticated: false, authorize: false, tokenStdin: false, registerRefreshGrant: false, sdkSession: false, issueKey: 'RPDEV-4', output: undefined,
  expectedFixtureSha256: undefined, expectedRunnerSha256: undefined };
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === '--token-stdin' && !options.authenticated) { options.authenticated = true; options.tokenStdin = true; }
  else if (arg === '--authorize' && !options.authenticated) { options.authorize = true; options.authenticated = true; }
  else if (arg === '--register-refresh-grant' && !options.registerRefreshGrant) options.registerRefreshGrant = true;
  else if (arg === '--sdk-session' && !options.sdkSession) options.sdkSession = true;
  else if (arg === '--out' && !options.output && process.argv[index + 1]) options.output = process.argv[++index];
  else if (arg === '--expected-fixture-sha256' && !options.expectedFixtureSha256 && /^[a-fA-F0-9]{64}$/.test(process.argv[index + 1] ?? '')) options.expectedFixtureSha256 = process.argv[++index].toLowerCase();
  else if (arg === '--expected-runner-sha256' && !options.expectedRunnerSha256 && /^[a-fA-F0-9]{64}$/.test(process.argv[index + 1] ?? '')) options.expectedRunnerSha256 = process.argv[++index].toLowerCase();
  else if (arg === '--issue' && process.argv[index + 1] === 'RPDEV-4') index++;
  else if (arg === '--help') {
    process.stdout.write('Usage: node scripts/mcp-verify.mjs --out NEW_PROBE.json [--authorize [--register-refresh-grant | --sdk-session] | --token-stdin] [--issue RPDEV-4] [--expected-fixture-sha256 HEX64] [--expected-runner-sha256 HEX64]\n--authorize registers a native public OAuth client, opens private browser consent, and keeps tokens in memory only.\n--register-refresh-grant adds DCR grant metadata only; no offline_access or refresh exchange is requested.\n--sdk-session adds SDK session metadata, offline_access and prompt=consent; refresh tokens are never used or persisted.\nExpected hashes default to the pinned approved RPDEV-4 artifacts; explicit SHA-256 options select different expected bytes without changing the issue or read-only scope.\nBase scopes: read:me read:account read:jira-work. Only Get approved reproducer for RPDEV-4 is called.\n');
    process.exit(0);
  } else throw Error('invalid-options');
}
if (!options.output) throw Error('output-path-required');
if (options.registerRefreshGrant && !options.authorize) throw Error('refresh-metadata-requires-authorize');
if (options.sdkSession && !options.authorize) throw Error('sdk-session-requires-authorize');
const REQUESTED_SCOPES = options.sdkSession ? [...READ_SCOPES, 'offline_access'] : READ_SCOPES;
const expectedApproved = { fixtureSha256: options.expectedFixtureSha256 ?? EXPECTED_APPROVED.fixtureSha256,
  runnerSha256: options.expectedRunnerSha256 ?? EXPECTED_APPROVED.runnerSha256 };

const report = { version: 1, kind: 'reproshare-external-mcp-probe', observedAt: new Date().toISOString(), endpoint: ENDPOINT,
  authenticatedMode: options.authenticated, requests: [], metadata: {}, result: 'not-completed', scope: 'public-discovery-only' };
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
  if (!ALLOWED_ORIGINS.has(parsed.origin) || parsed.username || parsed.password || parsed.hash || parsed.search) throw Error('discovery-url-rejected');
  const entry = { label, url: publicUrl(url), method: init.method ?? 'GET' };
  report.requests.push(entry);
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    entry.status = response.status;
    entry.contentType = (response.headers.get('content-type') ?? '').split(';')[0];
    const auth = challenge(response.headers.get('www-authenticate'));
    if (auth) entry.challenge = auth;
    const location = publicUrl(response.headers.get('location'));
    if (location) entry.redirect = location;
    const bytes = await boundedBody(response, cap, rpcId);
    entry.responseBytes = bytes.length;
    if (!label.startsWith('oauth-')) entry.responseSha256 = hash(bytes);
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
  const requestedRegistrationGrantTypes = options.registerRefreshGrant || options.sdkSession ? ['authorization_code', 'refresh_token'] : ['authorization_code'];
  report.oauth = { requestedScopes: REQUESTED_SCOPES, scopeBasis: options.sdkSession ? 'documented-sdk-session-profile-not-proven-required' : 'explicit-read-only-candidate-not-proven-minimal',
    clientProfile: options.sdkSession ? 'sdk-session' : options.registerRefreshGrant ? 'restricted-native-refresh-registration' : 'restricted-native', pkce: 'S256', clientAuthentication: 'none',
    applicationType: 'native', requestedRegistrationGrantTypes, refreshExchange: 'never-used',
    tokenPersistence: 'process-memory-only', registration: 'not-started', callback: 'not-received' };
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  let resolveCallback;
  let rejectCallback;
  let browser;
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
    process.stdout.write(`OAuth requested scopes: ${REQUESTED_SCOPES.join(' ')}. Opening Atlassian consent privately.\n`);
    browser = spawn('/usr/bin/open', [authorization.toString()], { stdio: 'ignore', shell: false });
    browser.once('error', () => rejectCallback(Error('oauth-browser-open-failed')));
    browser.once('exit', status => { if (status !== 0) rejectCallback(Error('oauth-browser-open-failed')); });
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
function approvedSummary(value) {
  // The response body can contain the approved synthetic artifact; persist only
  // shape and content hashes, never the raw tool result or customer report.
  const candidates = [value?.result?.structuredContent];
  for (const item of value?.result?.content ?? []) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      try { candidates.push(JSON.parse(item.text)); } catch { /* no raw text saved */ }
    }
  }
  const selected = candidates.find(item => item && typeof item === 'object' && item.status === 'approved_synthetic_example'
    && item.issueKey === 'RPDEV-4' && typeof item.fixtureJson === 'string' && typeof item.harnessCode === 'string');
  if (!selected) return { recognizedApprovedArtifact: false };
  const fixtureSha256 = hash(selected.fixtureJson);
  const runnerSha256 = hash(selected.harnessCode);
  return { recognizedApprovedArtifact: true, fixtureBytes: Buffer.byteLength(selected.fixtureJson), fixtureSha256,
    runnerBytes: Buffer.byteLength(selected.harnessCode), runnerSha256,
    matchesPriorReceiptArtifacts: fixtureSha256 === expectedApproved.fixtureSha256 && runnerSha256 === expectedApproved.runnerSha256
      && selected.fixtureHash === fixtureSha256 };
}
async function main() {
  if (options.authenticated && !options.authorize) {
    if (process.stdin.isTTY) throw Error('token-pipe-required');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 16_384) throw Error('token-size-limit');
      chunks.push(chunk);
    }
    bearer = Buffer.concat(chunks).toString('utf8').trim();
    if (!/^[A-Za-z0-9._~-]{16,16384}$/.test(bearer)) throw Error('invalid-token-input');
  }
  let initialized = await rpc('initialize', 1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'reproshare-verification-probe', version: '1.0.0' } });
  await discover(initialized.entry.challenge?.resourceMetadataUrl);
  if (options.authorize) {
    await authorize();
    session = undefined;
    initialized = await rpc('authenticated-initialize', 1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'reproshare-verification-probe', version: '1.0.0' } });
  }
  if (initialized.response?.status === 401) { report.result = 'oauth-required'; return; }
  if (!initialized.value?.result?.protocolVersion) { report.result = initialized.entry.errorCode ? 'network-unavailable' : 'initialize-not-accepted'; return; }
  protocol = initialized.value.result.protocolVersion;
  if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(protocol)) { report.result = 'unsupported-protocol-version'; return; }
  report.protocolVersion = safeToken(protocol);
  report.serverInfo = { name: safeToken(initialized.value.result.serverInfo?.name), version: safeToken(initialized.value.result.serverInfo?.version) };
  if (!options.authenticated) { report.result = 'unauthenticated-initialize-accepted'; return; }
  report.scope = 'authenticated-read-only-approved-RPDEV-4-only';
  await rpc('initialized-notification', undefined, 'notifications/initialized');
  const listed = await rpc('tools-list', 2, 'tools/list', {});
  const tools = listed.value?.result?.tools;
  if (!Array.isArray(tools)) { report.result = 'tools-list-not-accepted'; return; }
  report.toolCount = tools.length;
  report.discoveredToolNames = tools.slice(0, 50).map(item => safeToken(item?.name)).filter(Boolean);
  const tool = tools.find(item => item?.name === 'get-approved-reproducer');
  if (!tool) { report.result = 'approved-reproducer-tool-not-discovered'; return; }
  report.approvedReproducerDiscovered = true;
  const called = await rpc('get-approved-reproducer-RPDEV-4', 3, 'tools/call', { name: tool.name, arguments: { issueKey: options.issueKey } });
  report.approvedResult = approvedSummary(called.value);
  report.result = called.value?.result && !called.value.result.isError && report.approvedResult.recognizedApprovedArtifact && report.approvedResult.matchesPriorReceiptArtifacts ? 'authenticated-read-only-retrieval-verified' : 'approved-retrieval-not-verified';
}
try { await main(); }
catch (error) { report.result = 'probe-error'; report.errorCode = /^[a-z][a-z0-9-]{0,60}$/.test(error.message) ? error.message : 'probe-unavailable'; }
finally { bearer = undefined; session = undefined; }
await writeFile(resolve(options.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(`ReproShare external MCP probe: ${report.result}. Sanitized artifact saved.\n`);
process.exitCode = report.result === 'authenticated-read-only-retrieval-verified' ? 0 : 2;
