import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeCommandPattern, buildAutostart} from '../src/autostart.mjs';

test('bridge restart matches only the exact Node executable and installed bridge', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const bridge = 'C:\\Test User\\cursor-gpt-link\\runtime\\bridge.mjs';
  const matches = new RegExp(bridgeCommandPattern(node, bridge), 'i');
  assert.ok(matches.test(`"${node}" "${bridge}"`));
  assert.ok(matches.test(`"${node}" ${bridge}`));
  assert.equal(matches.test(`"${node}" "${bridge}.other"`), false);
  assert.equal(matches.test(`"${node}" "${bridge}" --unrelated`), false);
  assert.equal(matches.test(`"D:\\Other\\node.exe" "${bridge}"`), false);
  assert.equal(matches.test(`"${node}" "C:\\AnotherInstall\\runtime\\bridge.mjs"`), false);
});

test('autostart encodes unusual paths as data', () => {
  const code = buildAutostart({nodePath:'C:\\Node\\node.exe', bridgePath:"C:\\O'Brien\\runtime\\bridge.mjs", stateDir:"C:\\O'Brien"});
  const encoded = JSON.parse(code.match(/"-EncodedCommand",("[^"]+")/)[1]);
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(script.includes("O''Brien"));
  assert.ok(code.includes('windowsHide:true'));
  assert.ok(code.includes('CURSOR_GPT_LINK_HOME'));
});
