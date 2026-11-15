import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const publicFixtureJson = '{"synthetic":true,"reference":"PUBLIC-MCP-TEST"}\n';
const publicHarnessCode = '// Public transport-test bytes, not an application reproduction.\nexport const transportOnly = true;\n';
const fixtureSha256 = createHash('sha256').update(publicFixtureJson).digest('hex');
const runnerSha256 = createHash('sha256').update(publicHarnessCode).digest('hex');
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

// Native process tests replace only the network/browser/loopback boundary. No
// remote registration, browser launch, credential store or live tool is touched.
async function probe(mode: 'public' | 'oauth' | 'refresh-metadata' | 'sdk-session' | 'wrong-artifact' | 'wrong-runner' | 'default-pins' | 'extra-scope') {
  const directory = await mkdtemp(join(tmpdir(), 'reproshare-mcp-client-test-'));
  directories.push(directory);
  const bootstrap = join(directory, 'stub.mjs');
  const output = join(directory, 'probe.json');
  await writeFile(bootstrap, String.raw`
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const mode=${JSON.stringify(mode)};
const publicFixtureJson=${JSON.stringify(publicFixtureJson)};
const publicHarnessCode=${JSON.stringify(publicHarnessCode)};
const endpoint='https://mcp.atlassian.com/forge/9084b288-4229-48c6-940f-556f165a3e20';
const issuer='https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3';
const baseScopes=['read:me','read:account','read:jira-work'];
const scopes=mode==='sdk-session'?[...baseScopes,'offline_access']:baseScopes;
let handler;
let challenge;
let callbackUri;
http.createServer=(callback)=>{
  handler=callback;
  const server=new EventEmitter();
  server.listen=(port,host,done)=>{assert.equal(host,'127.0.0.1');assert.equal(port,0);done();};
  server.address=()=>({port:49152});
  server.closeAllConnections=()=>{};
  server.close=(done)=>done();
  return server;
};
childProcess.spawn=(command,args,options)=>{
  assert.equal(command,'/usr/bin/open');assert.equal(args.length,1);assert.equal(options.shell,false);assert.equal(options.stdio,'ignore');
  const url=new URL(args[0]);
  assert.equal(url.origin+url.pathname,'https://auth.atlassian.com/authorize');
  assert.equal(url.searchParams.get('resource'),endpoint);
  assert.deepEqual([...url.searchParams.keys()].sort(),['client_id','code_challenge','code_challenge_method',...(mode==='sdk-session'?['prompt']:[]),'redirect_uri','resource','response_type','scope','state']);
  assert.equal(url.searchParams.has('audience'),false);
  assert.equal(url.searchParams.get('prompt'),mode==='sdk-session'?'consent':null);
  assert.equal(url.searchParams.get('scope'),scopes.join(' '));
  assert.equal(url.searchParams.get('scope').includes('offline_access'),mode==='sdk-session');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  challenge=url.searchParams.get('code_challenge');callbackUri=url.searchParams.get('redirect_uri');
  const serverResponse=()=>({status:0,writeHead(status,headers){this.status=status;assert.equal(headers['Cache-Control'],'no-store');},end(text){assert.ok(!text.includes('SECRET'));}});
  queueMicrotask(()=>{
    const bad=serverResponse();
    handler({method:'GET',url:'/callback?code=SECRET-code&state=wrong-state',headers:{host:'127.0.0.1:49152'}},bad);
    assert.equal(bad.status,400);
    const good=serverResponse();
    const search=new URLSearchParams({code:'SECRET-code',state:url.searchParams.get('state'),iss:issuer});
    handler({method:'GET',url:'/callback?'+search,headers:{host:'127.0.0.1:49152'}},good);
    assert.equal(good.status,200);
  });
  return new EventEmitter();
};
syncBuiltinESMExports();
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
globalThis.fetch=async(url,options={})=>{
  assert.equal(options.redirect,'manual');
  if(url===endpoint){
    const rpc=JSON.parse(options.body);
    assert.ok(['initialize','notifications/initialized','tools/list','tools/call'].includes(rpc.method));
    if(!options.headers.Authorization)return json({error:'unauthorized'},401,{'www-authenticate':'Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource/forge/9084b288-4229-48c6-940f-556f165a3e20"'});
    assert.equal(options.headers.Authorization,'Bearer SECRET-access-token-123456789');
    if(rpc.method==='initialize')return json({jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'test-server',version:'1'}}},200,{'mcp-session-id':'SECRET-session'});
    assert.equal(options.headers['Mcp-Session-Id'],'SECRET-session');
    if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
    if(rpc.method==='tools/list')return json({jsonrpc:'2.0',id:rpc.id,result:{tools:[{name:'get-approved-reproducer',inputSchema:{type:'object'}}]}});
    assert.deepEqual(rpc.params,{name:'get-approved-reproducer',arguments:{issueKey:'RPDEV-4'}});
    const fixtureJson=mode==='wrong-artifact'?'{}':publicFixtureJson;
    const harnessCode=mode==='wrong-runner'?'// different public runner':publicHarnessCode;
    const data={status:'approved_synthetic_example',issueKey:'RPDEV-4',fixtureJson,harnessCode,fixtureHash:createHash('sha256').update(fixtureJson).digest('hex'),debug:'SECRET-raw-tool-output'};
    const response={jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify(data)}]}};
    // SSE deliberately stays open. Client must cancel after its matching result.
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('event: message\ndata: '+JSON.stringify(response)+'\n\n'));}}),{headers:{'content-type':'text/event-stream'}});
  }
  if(url.includes('/.well-known/oauth-protected-resource'))return json({resource:endpoint,authorization_servers:[issuer],scopes_supported:scopes});
  if(url=== 'https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3')return json({issuer,authorization_endpoint:'https://auth.atlassian.com/authorize',token_endpoint:'https://auth.atlassian.com/oauth/token',registration_endpoint:issuer+'/dcr/register',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],grant_types_supported:['authorization_code']});
  if(url===issuer+'/dcr/register'){
    const metadata=JSON.parse(options.body);assert.equal(metadata.token_endpoint_auth_method,'none');assert.equal(metadata.scope,scopes.join(' '));assert.equal(metadata.application_type,'native');
    assert.deepEqual(Object.keys(metadata).sort(),['application_type','client_name','grant_types','redirect_uris','response_types','scope','token_endpoint_auth_method']);
    assert.deepEqual(metadata.grant_types,['refresh-metadata','sdk-session'].includes(mode)?['authorization_code','refresh_token']:['authorization_code']);
    assert.equal(metadata.scope.includes('offline_access'),mode==='sdk-session');
    return json({client_id:'SECRET-client-id',redirect_uris:metadata.redirect_uris,scope:metadata.scope,token_endpoint_auth_method:'none',application_type:'native',grant_types:metadata.grant_types,client_secret:'SECRET-unused-client-secret'},201);
  }
  if(url==='https://auth.atlassian.com/oauth/token'){
    const parameters=new URLSearchParams(options.body);assert.equal(parameters.get('code'),'SECRET-code');assert.equal(parameters.get('resource'),endpoint);assert.equal(parameters.get('redirect_uri'),callbackUri);
    assert.equal(createHash('sha256').update(parameters.get('code_verifier')).digest('base64url'),challenge);
    assert.equal(parameters.get('grant_type'),'authorization_code');assert.equal(parameters.get('client_id'),'SECRET-client-id');
    return json({access_token:'SECRET-access-token-123456789',token_type:'Bearer',scope:scopes.join(' ')+(mode==='extra-scope'?' write:jira-work':''),refresh_token:'SECRET-unused-refresh'});
  }
  throw Error('unexpected-network-url');
};
`);
  const result = spawnSync(process.execPath, ['--import', bootstrap, 'scripts/mcp-verify.mjs', '--out', output,
    ...(mode === 'default-pins' ? [] : ['--expected-fixture-sha256', fixtureSha256, '--expected-runner-sha256', runnerSha256]),
    ...(mode === 'public' ? [] : ['--authorize']), ...(mode === 'refresh-metadata' ? ['--register-refresh-grant'] : []), ...(mode === 'sdk-session' ? ['--sdk-session'] : [])],
    { cwd: resolve('.'), encoding: 'utf8', timeout: 15_000 });
  const saved = await readFile(output, 'utf8');
  return { result, saved, report: JSON.parse(saved) };
}

describe('bounded external MCP client', () => {
  it('records public discovery and OAuth required without credentials or mutation', async () => {
    const { result, saved, report } = await probe('public');
    expect(result.status, result.stderr).toBe(2);
    expect(report.result).toBe('oauth-required');
    expect(report.requests.map((request: { method: string }) => request.method)).toEqual(['POST', 'GET', 'GET']);
    expect(saved).not.toContain('SECRET');
  });
  it('uses PKCE, rejects wrong state, performs only the approved read, checks explicit artifact hashes and suppresses secrets', async () => {
    const { result, saved, report } = await probe('oauth');
    expect(result.status, result.stderr).toBe(0);
    expect(report.result).toBe('authenticated-read-only-retrieval-verified');
    expect(report.approvedResult.matchesPriorReceiptArtifacts).toBe(true);
    expect(report.oauth.callback).toBe('state-validated');
    expect(report.oauth.grantedScopes).toEqual(['read:me', 'read:account', 'read:jira-work']);
    expect(report.oauth.applicationType).toBe('native');
    expect(report.oauth.requestedRegistrationGrantTypes).toEqual(['authorization_code']);
    expect(saved + result.stdout + result.stderr).not.toContain('SECRET');
    expect(report.requests.filter((entry: { label: string }) => entry.label.startsWith('oauth-')).every((entry: object) => !Object.hasOwn(entry, 'responseSha256'))).toBe(true);
  });
  it('can register both SDK-compatible grants while retaining only read scopes and one authorization-code exchange', async () => {
    const { result, saved, report } = await probe('refresh-metadata');
    expect(result.status, result.stderr).toBe(0);
    expect(report.result).toBe('authenticated-read-only-retrieval-verified');
    expect(report.oauth.requestedRegistrationGrantTypes).toEqual(['authorization_code', 'refresh_token']);
    expect(report.oauth.applicationType).toBe('native');
    expect(report.oauth.requestedScopes).toEqual(['read:me', 'read:account', 'read:jira-work']);
    expect(report.oauth.refreshExchange).toBe('never-used');
    expect(report.requests.filter((request: { label: string }) => request.label === 'oauth-code-exchange')).toHaveLength(1);
    expect(saved + result.stdout + result.stderr).not.toContain('SECRET');
    expect(saved).not.toContain('offline_access');
  });
  it('supports the opt-in SDK session with only offline_access added, consent prompt, no audience and no refresh exchange/storage', async () => {
    const { result, saved, report } = await probe('sdk-session');
    expect(result.status, result.stderr).toBe(0);
    expect(report.result).toBe('authenticated-read-only-retrieval-verified');
    expect(report.oauth.clientProfile).toBe('sdk-session');
    expect(report.oauth.requestedRegistrationGrantTypes).toEqual(['authorization_code', 'refresh_token']);
    expect(report.oauth.requestedScopes).toEqual(['read:me', 'read:account', 'read:jira-work', 'offline_access']);
    expect(report.oauth.grantedScopes).toEqual(report.oauth.requestedScopes);
    expect(report.oauth.refreshExchange).toBe('never-used');
    expect(report.oauth.tokenPersistence).toBe('process-memory-only');
    expect(report.requests.filter((request: { label: string }) => request.label === 'oauth-code-exchange')).toHaveLength(1);
    expect(saved + result.stdout + result.stderr).not.toContain('SECRET');
    expect(result.stdout).toContain('read:me read:account read:jira-work offline_access');
  });
  it('rejects a successful response containing the wrong approved artifact', async () => {
    const { result, report } = await probe('wrong-artifact');
    expect(result.status, result.stderr).toBe(2);
    expect(report.result).toBe('approved-retrieval-not-verified');
    expect(report.approvedResult.matchesPriorReceiptArtifacts).toBe(false);
  });
  it('rejects a changed runner even when the fixture and its claimed hash match', async () => {
    const { result, report } = await probe('wrong-runner');
    expect(result.status, result.stderr).toBe(2);
    expect(report.result).toBe('approved-retrieval-not-verified');
    expect(report.approvedResult.fixtureSha256).toBe(fixtureSha256);
    expect(report.approvedResult.matchesPriorReceiptArtifacts).toBe(false);
  });
  it('retains the pinned production expectations when no hash overrides are supplied', async () => {
    const { result, report } = await probe('default-pins');
    expect(result.status, result.stderr).toBe(2);
    expect(report.result).toBe('approved-retrieval-not-verified');
    expect(report.approvedResult.recognizedApprovedArtifact).toBe(true);
    expect(report.approvedResult.matchesPriorReceiptArtifacts).toBe(false);
  });
  it.each(['--expected-fixture-sha256', '--expected-runner-sha256'])('rejects a malformed %s before any network request', async flag => {
    const directory = await mkdtemp(join(tmpdir(), 'reproshare-mcp-invalid-hash-'));
    directories.push(directory);
    const bootstrap = join(directory, 'no-network.mjs');
    await writeFile(bootstrap, 'globalThis.fetch = () => { throw Error("UNEXPECTED-NETWORK"); };\n');
    const result = spawnSync(process.execPath, ['--import', bootstrap, 'scripts/mcp-verify.mjs', '--out', join(directory, 'probe.json'), flag, 'g'.repeat(64)],
      { cwd: resolve('.'), encoding: 'utf8', timeout: 15_000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid-options');
    expect(result.stdout + result.stderr).not.toContain('UNEXPECTED-NETWORK');
  });
  it('stops before authenticated tool calls if the token grants an unrequested scope', async () => {
    const { report, saved } = await probe('extra-scope');
    expect(report.errorCode).toBe('oauth-unrequested-scope-granted');
    expect(report.requests.some((entry: { label: string }) => entry.label === 'tools-list')).toBe(false);
    expect(saved).not.toContain('SECRET');
  });
});
