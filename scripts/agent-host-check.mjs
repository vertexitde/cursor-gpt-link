import assert from 'node:assert/strict';
import {agentHostMarker} from '../src/agent-host.mjs';

// Run Cursor's own agent-host enablement with the experiment switched on: the
// patched window stays on the classic agent path, the unpatched one would not.
export function verifyAgentHost(source) {
  const at = source.indexOf(agentHostMarker);
  assert.ok(at >= 0, 'Agent host enablement patched');
  const start = source.lastIndexOf('class{constructor(', at);
  assert.ok(start >= 0, 'Agent host enablement class found');
  // The class ends where its source first parses as one expression.
  let text;
  for (let end = source.indexOf('}', at); end > 0 && end - start < 20000; end = source.indexOf('}', end + 1)) {
    try { new Function('return (' + source.slice(start, end + 1) + ')'); text = source.slice(start, end + 1); break; } catch {}
  }
  assert.ok(text, 'Agent host enablement class end found');
  // Module helpers (local mode flags, the Orbit setting) resolve to inert stubs.
  const stub = new Proxy(function () {}, {get:(target, key) => key === 'then' || typeof key === 'symbol' ? undefined : key === 'localMode' || key === 'orbitBuild' ? false : stub, apply:() => false});
  const scope = new Proxy({}, {has:() => true, get:(target, key) => key === Symbol.unscopables ? undefined : key in globalThis ? globalThis[key] : stub});
  const build = code => new Function('__scope', 'with(__scope){return (' + code + ')}')(scope);
  const args = [{checkFeatureGate:() => true}, {info() {}, error() {}}, {decision:{allowed:true}}, {isGlass:false}, {enablement:'disabled'}, {route:{kind:'none'}}];
  const patched = build(text), native = build(text.replace(agentHostMarker + '!1&&', ''));
  assert.equal(new native(...args).isCursorAgentHostEnabled(), true, 'the experiment would move the window to the agent host');
  assert.equal(new patched(...args).isCursorAgentHostEnabled(), false, 'the window keeps the classic agent path');
  console.log('Native agent host: experiment reproduced; the window keeps the classic agent path.');
}
