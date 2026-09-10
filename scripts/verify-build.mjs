// Opt-in local verification against an original supported Cursor installation.
// Bundled application code is read locally and is never included in this repository.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildPatches} from '../src/patches.mjs';
import {verifyWorkbenchRouting} from './workbench-routing-check.mjs';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/verify-build.mjs PATH_TO_ORIGINAL_RESOURCES_APP');
const build = JSON.parse(fs.readFileSync(new URL('../src/supported-build.json', import.meta.url), 'utf8'));
for (const [relative, expected] of Object.entries(build.files)) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'), expected, relative);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-gpt-link-build-'));
try {
  const pending = buildPatches({root, cfg:{port:43187, key:'synthetic-test-key'}, models:[],
    nodePath:process.execPath, bridgePath:path.join(temp, 'bridge.mjs'), stateDir:temp});
  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];
    if (!file.path.endsWith('.js')) continue;
    const candidate = path.join(temp, i + '.mjs');
    fs.writeFileSync(candidate, file.content);
    execFileSync(process.execPath, ['--check', candidate], {stdio:'pipe', windowsHide:true});
    console.log('Syntax and unique anchors: ' + path.relative(root, file.path));
    if (file.path.includes('workbench.')) {
      await verifyWorkbenchRouting(file.content);
      console.log('Native workbench SSH routing and workspace resources: passed');
    }
    if (!file.path.includes('cursor-agent-exec') && !file.path.includes('cursor-local-agent-runtime')) continue;
    const start = file.content.indexOf('function(e,t,n,r,o,s=!1,i){const a=function(e){');
    assert.ok(start >= 0, 'Normalizer function found');
    const end = file.content.indexOf(file.path.includes('cursor-agent-exec') ? '}(c,t,n,r,o,null!=s&&s,a)' : '}(u,t,n,r,o,null!=s&&s,a)', start);
    assert.ok(end > start, 'Normalizer function end found');
    const normalize = new Function('return (' + file.content.slice(start, end + 1) + ')')();
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
      for (const fast of ['false', 'true']) {
        const request = {reasoning_effort:'old', service_tier:'priority'};
        normalize(request, 'chatgpt-codex/test-model', [{id:'reasoning', value:effort}, {id:'fast', value:fast}], 'openai_compatible');
        assert.equal(request.reasoning.effort, effort);
        assert.equal(request.reasoning_effort, undefined);
        assert.equal(request.service_tier, fast === 'true' ? 'priority' : undefined);
      }
    }
    const other = {};
    normalize(other, 'other-model', [], 'openai_compatible');
    assert.deepEqual(other, {});
    console.log('Reasoning and Fast forwarding: passed');
  }
  const product = JSON.parse(pending.find(f => f.path.endsWith('product.json')).content);
  const desktop = pending.find(f => f.path.endsWith('workbench.desktop.main.js'));
  assert.equal(product.checksums['vs/workbench/workbench.desktop.main.js'],
    crypto.createHash('sha256').update(desktop.content).digest('base64').replace(/=+$/, ''));
  console.log('Workbench checksum: passed');
} finally {
  fs.rmSync(temp, {recursive:true, force:true});
}
