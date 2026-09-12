import assert from 'node:assert/strict';

// Exercise the actual patched workbench method with synthetic service objects.
// This checks argument wiring without distributing the application's bundles.
export async function verifyWorkbenchRouting(source) {
  const start = source.indexOf('async runLocalAgentInExtensionHost(');
  const end = source.indexOf('}runLocalAgentInDedicatedExtensionHost(', start);
  assert.ok(start >= 0 && end > start, 'Native workbench routing method found');
  const method = source.slice(start, end + 1);
  const identity = value => value;
  const factory = new Function('cfe', 'hRe', 'fi', 'fr', 'Gh', 'qp', 'hVf', 'jyS', 'cRe', 'XyS', 'ofe', 'br', 'Gp', 's1S', '__useChatgptDedicatedRuntime',
    'return ({' + method + '}).runLocalAgentInExtensionHost;');
  for (const [modelId, authority, nativeSetting, expected] of [
    ['chatgpt-codex/test-model', 'ssh-remote+test-host', false, 'dedicated'],
    ['chatgpt-codex/test-model', undefined, false, 'workspace'],
    ['ordinary-model', 'ssh-remote+test-host', false, 'workspace'],
    ['ordinary-model', 'ssh-remote+test-host', true, 'dedicated']
  ]) {
    const route = factory(identity, identity, {wrap:identity}, {wrap:identity}, () => nativeSetting, () => nativeSetting,
      identity, identity, identity, identity, identity, {wrap:identity}, () => nativeSetting, identity, (model, remote) => model.startsWith('chatgpt-codex/') && Boolean(remote));
    const calls = [];
    const provider = {waitForProviderRegistration:async () => calls.push('registered'),
      runLocalAgent:async (...args) => calls.push(['workspace', ...args])};
    const service = {
      getLocalAgentProviderConfig:async () => ({baseUrl:'http://127.0.0.1:43187/v1', apiKey:'synthetic-test-key', customHeaders:{}}),
      reactiveStorageService:{applicationUserPersistentStorage:{}},
      logService:{info() {}, warn() {}}, agentExecProviderService:provider,
      productService:{version:'synthetic', urlProtocol:'synthetic'},
      cursorAuthenticationService:{granularPrivacyModeRawEnum:() => 0},
      experimentService:{checkFeatureGate:() => false},
      workspaceContextService:{getWorkspace:() => ({folders:[]})},
      environmentService:{remoteAuthority:authority}, storageService:{},
      runLocalAgentInDedicatedExtensionHost:async (...args) => calls.push(['dedicated', ...args])
    };
    const bytes = {toBinary:() => new Uint8Array()};
    const model = {...bytes, modelId};
    const signal = new AbortController().signal;
    const resources = {workspaceAuthority:authority, marker:'existing-exec-resources'};
    await route.call(service, {signal}, bytes, bytes, model, {}, {}, {}, [], resources,
      {conversationId:'synthetic-conversation', requestedModel:{...bytes, modelId}});
    assert.equal(calls[0], 'registered');
    const [kind, request, callbacks, ...rest] = calls[1];
    assert.equal(kind, expected);
    assert.equal(request.baseUrl, 'http://127.0.0.1:43187/v1');
    assert.equal(typeof callbacks.queryInteraction, 'function');
    assert.equal(typeof callbacks.handleCheckpoint, 'function');
    assert.deepEqual(rest, expected === 'dedicated' ? [resources, signal] : [signal]);
  }
}
