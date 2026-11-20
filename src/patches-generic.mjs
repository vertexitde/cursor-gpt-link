// Patch definitions driven by a build's derived symbol table.
//
// Up to 3.22.12 every build had its own patches-<version>.mjs, the previous one
// with the new names substituted in. From 3.24.12 a build is only its
// symbols-<version>.json, derived by scripts/derive-symbols.mjs and reviewed;
// the code that uses those symbols lives here once. The older files stay as
// they were reviewed.
import {patchConversationActionsWorkbench, patchConversationActionsRuntime} from './conversation-actions.mjs';
import {patchSubagentLifecycle} from './subagent-lifecycle.mjs';
import {patchMaxMode} from './max-mode.mjs';
import {patchSubagentSettingsWorkbench, patchSubagentSettingsRuntime} from './subagent-settings.mjs';
import {patchSubagentModel} from './subagent-model.mjs';
import {patchSubagentBubbles} from './subagent-bubbles.mjs';
import {buildAutostart} from './autostart.mjs';
import {usageSectionSrc} from './usage-section.mjs';
import {wrapRuntime} from './patches-runtime.mjs';
import {pickerSectionHelpersSrc, patchPickerSections} from './picker-sections.mjs';
import {usageLabelHelpersSrc} from './usage-label.mjs';
import {patchAgentHost} from './agent-host.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const prefix = 'chatgpt-codex/';

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Patch anchor not unique: ' + from.slice(0, 100));
  return source.replace(from, to);
}

// The model a request is for, spelled with this build's parameter names.
function requestedModel(runAnchor) {
  const params = runAnchor.match(/^async run\(([\w$,]+)\)/)?.[1].split(',');
  if (!params || params.length < 11) throw new Error('Unrecognised run signature: ' + runAnchor.slice(0, 60));
  return `${params[10]}?.requestedModel?.modelId??${params[3]}?.modelId`;
}

function providerModel(providerConfig) {
  const [first, second] = providerConfig.match(/\(([\w$]+),([\w$]+)\)/).slice(1);
  return `${second}?.requestedModel?.modelId??${first}?.modelId`;
}

function wrapGetter(source) {
  if (/getAvailableDefaultModels\(\)\{return __withChatgptBridgeModels\(/.test(source)) return source;
  const getter = source.includes('return __withClaudeBridgeModels([...this._availableDefaultModels()])')
    ? 'getAvailableDefaultModels(){return __withClaudeBridgeModels([...this._availableDefaultModels()])}'
    : 'getAvailableDefaultModels(){return[...this._availableDefaultModels()]}';
  return replaceOnce(source, getter, getter.replace(/return\s*(.+)}/, 'return __withChatgptBridgeModels($1)}'));
}

function wrapMap(source, s) {
  const map = wrapper => `${s.mapPrefix}${s.mapVar}=${wrapper(s.mapVar)}.map(${s.mapper}),`;
  const plain = `${s.mapPrefix}${s.mapVar}=${s.mapVar}.map(${s.mapper}),`;
  const claude = map(v => `__withClaudeBridgeModels(${v})`);
  const gpt = map(v => `__withChatgptBridgeModels(${v})`);
  if (source.includes(gpt) || source.includes('__withChatgptBridgeModels(__withClaudeBridgeModels(') || source.includes('__withClaudeBridgeModels(__withChatgptBridgeModels(')) return source;
  if (source.includes(claude)) return replaceOnce(source, claude, map(v => `__withChatgptBridgeModels(__withClaudeBridgeModels(${v}))`));
  return replaceOnce(source, plain, gpt);
}

// Let subscription models take the local agent runtime. Up to 3.22 the run
// options also carried the local mode; from 3.24 only the branch reads it.
function gateRun(source, s) {
  const model = requestedModel(s.runAnchor);
  const chatgptLocal = `const __chatgptLocal=__isChatgptBridgeModel(${model});`;
  const claudeLocal = `const __claudeLocal=__isClaudeBridgeModel(${model});`;
  if (source.includes(chatgptLocal)) {
    if (source.includes(`__isClaudeBridgeModel(${model})`)) return source;
    return replaceOnce(source, chatgptLocal, `const __chatgptLocal=__isChatgptBridgeModel(${model})||(typeof __isClaudeBridgeModel==="function"&&__isClaudeBridgeModel(${model}));`);
  }
  if (source.includes(claudeLocal)) {
    source = replaceOnce(source, claudeLocal, claudeLocal + chatgptLocal);
    return source.replaceAll('||__claudeLocal', '||__claudeLocal||__chatgptLocal');
  }
  const gated = s.runAnchor
    .replace('{const ', '{' + chatgptLocal + 'const ')
    .replace(`localMode:${s.localMode}.localMode})`, `localMode:${s.localMode}.localMode||__chatgptLocal})`)
    .replace(`${s.localMode}.localMode){`, `${s.localMode}.localMode||__chatgptLocal){`);
  return replaceOnce(source, s.runAnchor, gated);
}

function loginAction(s, desktop) {
  const head = `${s.registerAction}(class extends ${s.actionBase}{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}`;
  return desktop
    ? `\n${head}async run(e){try{const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("Could not start sign-in");e.get(${s.notificationService}).info("Complete ChatGPT sign-in in your browser, then reload the Cursor window.")}catch(error){e.get(${s.notificationService}).error("Cannot reach the ChatGPT connection. Restart Cursor.")}}});\n`
    : `\n${head}async run(){const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("ChatGPT-Could not start sign-in")}});\n`;
}

function addUsage(source, s) {
  const symbols = {jsx:s.usageJsx, useState:s.usageUseState, useEffect:s.usageUseEffect, card:s.card, zs:s.zs, bar:s.bar, barStyle:s.barStyle};
  if (!source.includes('function __chatgptUsageSection')) source = replaceOnce(source, s.usageFn, usageSectionSrc(symbols) + s.usageFn);
  if (source.includes(s.usageJsx + '(__chatgptUsageSection,{})')) return source;
  const claudeOnly = s.usageChildren.slice(0, -1) + ',' + s.usageJsx + '(__claudeUsageSection,{})]';
  const children = source.includes(claudeOnly) ? claudeOnly : s.usageChildren;
  return replaceOnce(source, children, children.slice(0, -1) + ',' + s.usageJsx + '(__chatgptUsageSection,{})]');
}

export function patchWorkbench(source, surface, s, prelude) {
  const desktop = surface === 'desktop';
  if (!desktop && surface !== 'glass') throw new Error('Unknown workbench surface: ' + surface);
  source = prelude + source;
  source = wrapGetter(source);
  source = replaceOnce(source, 'async refreshDefaultModels(){', 'async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
  source = wrapMap(source, s);
  source = patchPickerSections(source, replaceOnce, s);
  source = replaceOnce(source, s.providerConfig,
    s.providerConfig + `if(__isChatgptBridgeModel(${providerModel(s.providerConfig)}))return{baseUrl:__chatgptBridgeBase+"/v1",apiKey:__chatgptBridgeKey,customHeaders:{}};`);
  source = gateRun(source, s);
  source += loginAction(s, desktop);
  source = addUsage(source, s);
  source = patchMaxMode(patchSubagentSettingsWorkbench(source));
  // Remote sessions run on the SSH host from 3.22.9 on, so nothing is rerouted.
  source = patchSubagentBubbles(source, surface, s);
  source = patchSubagentLifecycle(source, surface, prefix, s);
  return patchAgentHost(patchConversationActionsWorkbench(source, surface, prefix));
}

export function buildPatches({root, cfg, models, nodePath, bridgePath, stateDir, symbols}) {
  if (!symbols?.desktop || !symbols?.glass) throw new Error('A symbol table for both workbench surfaces is required.');
  const pending = [];
  const base = 'http://127.0.0.1:' + cfg.port;
  const prelude = `\n/* cursor-chatgpt-bridge 0.1.3: account credentials stay in local bridge */\nvar __chatgptBridgeModels=${JSON.stringify(models)};\nconst __chatgptBridgeBase=${JSON.stringify(base)},__chatgptBridgeKey=${JSON.stringify(cfg.key)};\nfunction __isChatgptBridgeModel(m){return typeof m==="string"&&m.startsWith("chatgpt-codex/")}\nfunction __withChatgptBridgeModels(models){return [...models.filter(m=>!__isChatgptBridgeModel(m.name)),...__chatgptBridgeModels]}\nasync function __refreshChatgptBridgeModels(){try{const r=await fetch(__chatgptBridgeBase+"/picker-models",{headers:{Authorization:"Bearer "+__chatgptBridgeKey},signal:AbortSignal.timeout(2500)});if(r.ok){const data=await r.json();if(Array.isArray(data.models))__chatgptBridgeModels=data.models}}catch{}}\n${pickerSectionHelpersSrc}\n${usageLabelHelpersSrc}\n`;
  let desktopContent;
  for (const surface of ['desktop', 'glass']) {
    const file = path.join(root, `out/vs/workbench/workbench.${surface}.main.js`);
    const content = patchWorkbench(fs.readFileSync(file, 'utf8'), surface, symbols[surface], prelude);
    if (surface === 'desktop') desktopContent = content;
    pending.push({path:file, content});
  }
  for (const relative of ['extensions/cursor-agent-exec/dist/main.js', 'extensions/cursor-local-agent-runtime/dist/main.js']) {
    const file = path.join(root, relative);
    pending.push({path:file, content:patchConversationActionsRuntime(patchSubagentSettingsRuntime(patchSubagentModel(wrapRuntime(fs.readFileSync(file, 'utf8')))), prefix)});
  }
  const mainPath = path.join(root, 'out/main.js');
  pending.push({path:mainPath, content:fs.readFileSync(mainPath, 'utf8') + buildAutostart({nodePath, bridgePath, stateDir})});
  const productPath = path.join(root, 'product.json');
  const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  product.checksums['vs/workbench/workbench.desktop.main.js'] = crypto.createHash('sha256').update(desktopContent).digest('base64').replace(/=+$/, '');
  pending.push({path:productPath, content:JSON.stringify(product, null, 2)});
  return pending;
}
