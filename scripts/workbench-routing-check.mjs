import assert from 'node:assert/strict';

// The method ends where its source parses as one method. Its neighbour in the
// class changed between builds, so the parser decides instead of a landmark.
function methodSource(source, start) {
  for (let end = source.indexOf('}', start); end >= 0 && end - start < 200000; end = source.indexOf('}', end + 1)) {
    const candidate = source.slice(start, end + 1);
    try { new Function('return ({' + candidate + '})'); return candidate; } catch {}
  }
}

// Exercise the actual patched workbench method with synthetic service objects.
// This checks argument wiring without distributing the application's bundles.
export async function verifyWorkbenchRouting(source, version, prefix='chatgpt-codex/') {
  // From 3.22.9 a remote session runs the agent on the SSH host, so a
  // subscription model must take the same route as an ordinary one.
  const {isTunnelled} = await import('../src/remote-routing.mjs');
  const remoteRoute = isTunnelled(version) ? 'workspace' : 'dedicated';
  const name=source.includes('async _subscriptionNativeLocalAgent(')?'_subscriptionNativeLocalAgent':'runLocalAgentInExtensionHost';
  const start = source.indexOf('async '+name+'(');
  const body = start >= 0 ? methodSource(source, start) : undefined;
  assert.ok(body, 'Native workbench routing method found');
  const method = body.replace('async '+name+'(', 'async runLocalAgentInExtensionHost(');
  const identity = value => value;
  const injected=name=>{const match=source.match(new RegExp('function '+name+'\\(existing,[\\s\\S]*?\\n}'));return match?new Function('return ('+match[0]+')')():identity;};
  const trim=method.match(/([\w$]+)\([\w$]+\.requestedModel\?\.modelId\)/)[1];
  const binary=method.match(/defaultModel:([\w$]+)\.wrap/)[1];
  const setting=method.match(/([\w$]+)\(this.storageService,"useDedicatedLocalAgentRuntimeHost"\)/)[1];
  // From 3.31 a failure is wrapped in Cursor's own error type; the check sees it unwrapped.
  const wrap=method.match(/throw ([\w$]+)\([\w$]+,\{modelId:/)?.[1]??'__nativeErrorWrapper';
  // The roles under test are passed in; every other helper the method reaches
  // for (new ones arrive with each build) resolves to an inert stub.
  const names=['__ChatgptSelectedModelIds','__ClaudeSelectedModelIds','__useChatgptDedicatedRuntime','__isClaudeBridgeModel',trim,binary,setting,wrap];
  const stub=new Proxy(function(){},{get:(target,key)=>key==='localMode'?false:key==='then'||typeof key==='symbol'?undefined:stub,apply:()=>undefined});
  const factory=(...values)=>{
    const known=Object.fromEntries(names.map((name,i)=>[name,values[i]]));
    const scope=new Proxy(known,{has:()=>true,get:(target,key)=>key===Symbol.unscopables?undefined:key in target?target[key]:key in globalThis?globalThis[key]:stub});
    return new Function('__scope','with(__scope){return ({'+method+'}).runLocalAgentInExtensionHost}')(scope);
  };
  for (const [modelId, authority, nativeSetting, expected] of [
    [prefix+'test-model', 'ssh-remote+test-host', false, remoteRoute],
    [prefix+'test-model', undefined, false, 'workspace'],
    ['ordinary-model', 'ssh-remote+test-host', false, 'workspace'],
    ['ordinary-model', 'ssh-remote+test-host', true, 'dedicated']
  ]) {
    const route = factory(injected('__ChatgptSelectedModelIds'),injected('__ClaudeSelectedModelIds'),
      (model,remote)=>model.startsWith('chatgpt-codex/')&&Boolean(remote),model=>model.startsWith('claude-subscription/'),identity,{wrap:identity},()=>nativeSetting,identity);
    const calls = [];
    const provider = {waitForProviderRegistration:async () => calls.push('registered'),
      runLocalAgent:async (...args) => calls.push(['workspace', ...args])};
    const service = {
      getLocalAgentProviderConfig:async () => ({baseUrl:'http://127.0.0.1:43187/v1', apiKey:'synthetic-test-key', customHeaders:{}}),
      reactiveStorageService:{applicationUserPersistentStorage:{}},
      logService:{info() {}, warn() {}}, agentExecProviderService:provider,
      productService:{version:'synthetic', urlProtocol:'synthetic'},
      cursorAuthenticationService:{granularPrivacyModeRawEnum:() => 0},
      experimentService:{checkFeatureGate:() => false, checkFeatureGateIfEvaluated:() => undefined},
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
