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
import {verifyAgentHost} from './agent-host-check.mjs';
import {atLeast} from '../src/versions.mjs';

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
    // From 3.32 the picker and the Max-mode solver are in the shared UI module.
    const ui = pending.find(f => f.path.endsWith('workbench.anysphere-ui.js'));
    if (file === ui) {
      verifyMaxMode(file.content);
      assert.ok(file.content.includes('"chatgpt-subscription-models"') && file.content.includes('__withSubscriptionPickerSections('), 'Picker sections in the UI module');
      console.log('UI module: picker sections and Max mode passed');
      continue;
    }
    if (file.path.includes('workbench.')) {
      if(atLeast(build.version,'3.20.23'))verifySubscriptionUi(file.content);
      if(atLeast(build.version,'3.20.21'))await verifyConversationActionsWorkbench(file.content,['chatgpt-codex/']);
      if(atLeast(build.version,'3.20.21')){if(!ui)verifyMaxMode(file.content);await verifySubagentLifecycle(file.content,['chatgpt-codex/']);}
      await verifyWorkbenchRouting(file.content, build.version);
      if(atLeast(build.version,'3.24.12'))verifyAgentHost(file.content);
      if(atLeast(build.version,'3.20.17'))await verifySubagentRegistration(file.content);
      console.log('Native workbench SSH routing and workspace resources: passed');
    }
    if (!file.path.includes('cursor-agent-exec') && !file.path.includes('cursor-local-agent-runtime')) continue;
    if(atLeast(build.version,'3.20.17'))await verifySubagentModels(file.content);
    if(atLeast(build.version,'3.20.21')){verifyConversationActionsRuntime(file.content);verifySubagentSettings(file.content);verifyContextBudget(file.content,{id:'chatgpt-codex/test',capabilities:{context_length:272000}});}
    // 3.21.1 rotated these minified locals; their positions are what matters.
    const header = file.content.match(/function\(e,t,[\w$]+,[\w$]+,[\w$]+,[\w$]+=!1,i\)\{const a=function\(e\)\{/);
    assert.ok(header, 'Normalizer function found');
    const start = header.index;
    // The flag argument is null!=o&&o up to 3.22 and o??!1 from 3.24.
    const end = file.content.slice(start).search(/\}\([\w$]+,t,[\w$]+,[\w$]+,[\w$]+,(?:null!=([\w$]+)&&\1|[\w$]+\?\?!1),a\)/) + start;
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
