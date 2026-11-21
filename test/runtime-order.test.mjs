import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {wrapRuntime} from '../src/patches-runtime.mjs';
import {bridgeModules} from '../patcher.mjs';

// The reasoning step of a runtime bundle, as Cursor ships it and after another
// link (here Kimi) has already put its branch behind it on an SSH host.
const original = 'function step(t,e,r){const n=function(a){return"none"===a?void 0:a}(r);if(void 0===a)return;return n}';
const kimiFirst = original.replace('}(r);', '}(r);if(typeof t==="string"&&t.startsWith("kimi/")){const selected=r?.find(p=>p.id==="reasoning")?.value;return}');

test('the ChatGPT runtime branch goes in whichever link came first', () => {
  for (const source of [original, kimiFirst]) {
    const patched = wrapRuntime(source);
    assert.equal(patched.split('t.startsWith("chatgpt-codex/")').length, 2);
    const fusion = patched.indexOf('/^(chatgpt-codex|claude-subscription)\\/fusion$/');
    assert.ok(fusion >= 0 && fusion < patched.indexOf('t.startsWith("chatgpt-codex/")'), 'Fusion stays ahead of the ChatGPT branch');
    assert.doesNotThrow(() => new Function(patched));
    assert.equal(wrapRuntime(patched), patched, 'a second run leaves it alone');
  }
  assert.ok(wrapRuntime(kimiFirst).includes('t.startsWith("kimi/")'), 'the other link keeps its branch');
});

test('the runtime copy Cursor starts gets every module the bridge imports', () => {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const modules = bridgeModules(src);
  assert.ok(modules.includes('fusion.mjs') && modules.includes('config.mjs'));
  for (const name of modules) {
    const source = fs.readFileSync(path.join(src, name), 'utf8');
    for (const [, dep] of source.matchAll(/^import\b[^'"]*['"]\.\/([\w.-]+\.mjs)['"]/gm)) assert.ok(modules.includes(dep), name + ' imports ' + dep);
  }
});
