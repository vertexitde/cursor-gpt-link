import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteRoutingPrelude, remoteAnchors, patchRemoteRouting} from '../src/remote-routing.mjs';

const isBridgeModel = model => typeof model === 'string' && model.startsWith('chatgpt-codex/');
const chooseDedicated = new Function('__isChatgptBridgeModel', remoteRoutingPrelude + '\nreturn __useChatgptDedicatedRuntime;')(isBridgeModel);

test('SSH ChatGPT inference stays local; ordinary and local sessions retain their routing', () => {
  assert.equal(chooseDedicated('chatgpt-codex/test-model', 'ssh-remote+test-host'), true);
  assert.equal(chooseDedicated('chatgpt-codex/test-model', undefined), false);
  assert.equal(chooseDedicated('chatgpt-codex/test-model', ''), false);
  assert.equal(chooseDedicated('ordinary-model', 'ssh-remote+test-host'), false);
  assert.equal(chooseDedicated(undefined, 'ssh-remote+test-host'), false);
});

for (const surface of ['desktop', 'glass']) {
  test(surface + ': dedicated routing passes workspace resources and cancellation unchanged', async () => {
    const anchors = remoteAnchors[surface];
    const desktop = surface === 'desktop';
    const branch = desktop
      ? 'await this.runLocalAgentInDedicatedExtensionHost(f,v,c,e.signal):await this.agentExecProviderService.runLocalAgent(f,v,e.signal)'
      : 'await this.runLocalAgentInDedicatedExtensionHost(g,v,l,t.signal):await this.agentExecProviderService.runLocalAgent(g,v,t.signal)';
    const fixture = anchors.activation + '\nasync function route(model,request,callbacks,resources,signal){' +
      (desktop ? 'const g=model,f=request,v=callbacks,c=resources,e={signal};' : 'const p=model,g=request,v=callbacks,l=resources,t={signal};') +
      anchors.selector + branch + ';}';
    const source = patchRemoteRouting(fixture, surface);
    const route = new Function('__isChatgptBridgeModel', '__chatgptBridgeBase', 'Gh', 'qp',
      source + '\nreturn route;')(isBridgeModel, 'http://127.0.0.1:43187', () => false, () => false);
    const request = {baseUrl:'http://127.0.0.1:43187/v1'};
    const resources = {remoteWorkspace:'synthetic-ssh-workspace'};
    const callbacks = {approval:'synthetic-native-callback'};
    const signal = new AbortController().signal;
    const calls = [];
    const receiver = {environmentService:{remoteAuthority:'ssh-remote+test-host'}, storageService:{},
      runLocalAgentInDedicatedExtensionHost:async (...args) => calls.push(['dedicated', ...args]),
      agentExecProviderService:{runLocalAgent:async (...args) => calls.push(['workspace', ...args])}};
    await route.call(receiver, 'chatgpt-codex/test-model', request, callbacks, resources, signal);
    assert.deepEqual(calls[0], ['dedicated', request, callbacks, resources, signal]);
    await route.call(receiver, 'ordinary-model', request, callbacks, resources, signal);
    assert.deepEqual(calls[1], ['workspace', request, callbacks, signal]);
    receiver.environmentService.remoteAuthority = undefined;
    await route.call(receiver, 'chatgpt-codex/test-model', request, callbacks, resources, signal);
    assert.deepEqual(calls[2], ['workspace', request, callbacks, signal]);
  });

  test(surface + ': dedicated extension is available without enabling global local mode', () => {
    const anchors = remoteAnchors[surface];
    const source = patchRemoteRouting(anchors.activation + '\nconst selection=' + anchors.selector + '1:0;', surface);
    const start = source.indexOf(anchors.enabled);
    assert.ok(start >= 0);
    const enabled = new Function('__chatgptBridgeBase', anchors.enabled + '\nreturn ' + (surface === 'desktop' ? 'edp' : 'mIg') + ';')('http://127.0.0.1:43187');
    assert.equal(enabled(undefined), true);
  });
}

test('unknown or repeated remote anchors fail before producing a patch', () => {
  assert.throws(() => patchRemoteRouting('', 'desktop'), /not unique/);
  assert.throws(() => patchRemoteRouting(remoteAnchors.desktop.selector.repeat(2), 'desktop'), /not unique/);
});
