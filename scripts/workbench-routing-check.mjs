import assert from 'node:assert/strict';

// Exercise the actual patched workbench method with synthetic service objects.
// This checks argument wiring without distributing the application's bundles.
export async function verifyWorkbenchRouting(source, version, prefix='chatgpt-codex/') {
  // From 3.22.9 a remote session runs the agent on the SSH host, so a
  // subscription model must take the same route as an ordinary one.
  const {tunnelledBuilds} = await import('../src/remote-routing.mjs');
  const remoteRoute = tunnelledBuilds.includes(version) ? 'workspace' : 'dedicated';
  const name=source.includes('async _subscriptionNativeLocalAgent(')?'_subscriptionNativeLocalAgent':'runLocalAgentInExtensionHost';
  const start = source.indexOf('async '+name+'(');
  const end = source.indexOf('}runLocalAgentInDedicatedExtensionHost(', start);
  assert.ok(start >= 0 && end > start, 'Native workbench routing method found');
  const method = source.slice(start, end + 1).replace('async '+name+'(', 'async runLocalAgentInExtensionHost(');
  const identity = value => value;
  const injected=name=>{const match=source.match(new RegExp('function '+name+'\\(existing,[\\s\\S]*?\\n}'));return match?new Function('return ('+match[0]+')')():identity;};
  const trim=method.match(/([\w$]+)\([\w$]+\.requestedModel\?\.modelId\)/)[1];
  const binary=method.match(/defaultModel:([\w$]+)\.wrap/)[1];
  const setting=method.match(/([\w$]+)\(this.storageService,"useDedicatedLocalAgentRuntimeHost"\)/)[1];
  const factory = new Function('__ChatgptSelectedModelIds','__ClaudeSelectedModelIds','__useChatgptDedicatedRuntime','__isClaudeBridgeModel',trim,binary,setting,
    'return ({' + method + '}).runLocalAgentInExtensionHost;');
  for (const [modelId, authority, nativeSetting, expected] of [
    [prefix+'test-model', 'ssh-remote+test-host', false, remoteRoute],
    [prefix+'test-model', undefined, false, 'workspace'],
    ['ordinary-model', 'ssh-remote+test-host', false, 'workspace'],
    ['ordinary-model', 'ssh-remote+test-host', true, 'dedicated']
  ]) {
    const route = factory(injected('__ChatgptSelectedModelIds'),injected('__ClaudeSelectedModelIds'),
      (model,remote)=>model.startsWith('chatgpt-codex/')&&Boolean(remote),model=>model.startsWith('claude-subscription/'),identity,{wrap:identity},()=>nativeSetting);
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
    const override={subagentType:'explore',selection:{case:'model',value:{modelId:'selected-explore-model'}},toBinary:()=>new Uint8Array([1,2,3])};
    await route.call(service, {signal}, bytes, bytes, model, {}, {}, {}, [], resources,
      {subscriptionActionChannel:'subscription-actions:test',subscriptionPlanPrepends:[[1,2]],conversationId:'synthetic-conversation', requestedModel:{...bytes, modelId},subagentModelOverrides:[override]});
    assert.equal(calls[0], 'registered');
    const [kind, request, callbacks, ...rest] = calls[1];
    assert.equal(kind, expected);
    if(source.includes('__ChatgptSelectedModelIds')||source.includes('__ClaudeSelectedModelIds'))assert.deepEqual(request.availableModelIds,modelId.startsWith(prefix)?['selected-explore-model']:[]);
    assert.deepEqual(request.runOptions.subagentModelOverrides,[override.toBinary()]);
    if(name==='_subscriptionNativeLocalAgent'){assert.equal(request.runOptions.subscriptionActionChannel,'subscription-actions:test');assert.deepEqual(request.runOptions.subscriptionPlanPrepends,[[1,2]]);}
    assert.equal(request.baseUrl, 'http://127.0.0.1:43187/v1');
    assert.equal(typeof callbacks.queryInteraction, 'function');
    assert.equal(typeof callbacks.handleCheckpoint, 'function');
    assert.deepEqual(rest, expected === 'dedicated' ? [resources, signal] : [signal]);
  }
}
