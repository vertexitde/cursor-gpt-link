import {verifySubscriptionUi} from './subscription-ui-check.mjs';
import {verifyConversationActionsWorkbench,verifyConversationActionsRuntime} from './conversation-actions-check.mjs';
import {verifySubagentLifecycle} from './subagent-lifecycle-check.mjs';
import {verifyMaxMode,verifyContextBudget} from './max-mode-check.mjs';
import {verifySubagentSettings} from './subagent-settings-check.mjs';
import {verifySubagentModels} from './subagent-model-check.mjs';
// Opt-in local verification against an original supported Cursor installation.
// Bundled application code is read locally and is never included in this repository.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildPatches} from '../src/patches.mjs';
import {supportedBuild} from '../src/supported-builds.mjs';
import {verifySubagentRegistration} from './subagent-registration-check.mjs';
import {verifyWorkbenchRouting} from './workbench-routing-check.mjs';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/verify-build.mjs PATH_TO_ORIGINAL_RESOURCES_APP');
const build = supportedBuild(root);
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
      if(['3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16','3.21.18','3.22.5','3.22.9'].includes(build.version))verifySubscriptionUi(file.content);
      if(['3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16','3.21.18','3.22.5','3.22.9'].includes(build.version))await verifyConversationActionsWorkbench(file.content,['chatgpt-codex/']);
      if(['3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16','3.21.18','3.22.5','3.22.9'].includes(build.version)){verifyMaxMode(file.content);await verifySubagentLifecycle(file.content,['chatgpt-codex/']);}
      await verifyWorkbenchRouting(file.content, build.version);
      if(['3.20.17','3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16','3.21.18','3.22.5','3.22.9'].includes(build.version))await verifySubagentRegistration(file.content);
      console.log('Native workbench SSH routing and workspace resources: passed');
    }
    if (!file.path.includes('cursor-agent-exec') && !file.path.includes('cursor-local-agent-runtime')) continue;
    if(['3.20.17','3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16','3.21.18','3.22.5','3.22.9'].includes(build.version))await verifySubagentModels(file.content);
    if(['3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16','3.21.18','3.22.5','3.22.9'].includes(build.version)){verifyConversationActionsRuntime(file.content);verifySubagentSettings(file.content);verifyContextBudget(file.content,{id:'chatgpt-codex/test',capabilities:{context_length:272000}});}
    // 3.21.1 rotated these minified locals; their positions are what matters.
    const header = file.content.match(/function\(e,t,[\w$]+,[\w$]+,[\w$]+,[\w$]+=!1,i\)\{const a=function\(e\)\{/);
    assert.ok(header, 'Normalizer function found');
    const start = header.index;
    const end = file.content.slice(start).search(/\}\([\w$]+,t,[\w$]+,[\w$]+,[\w$]+,null!=[\w$]+&&[\w$]+,a\)/) + start;
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
