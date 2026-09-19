import {patchConversationActionsWorkbench,patchConversationActionsRuntime} from './conversation-actions.mjs';
import {patchSubagentLifecycle} from './subagent-lifecycle.mjs';
import {patchMaxMode} from './max-mode.mjs';
import {patchSubagentSettingsWorkbench, patchSubagentSettingsRuntime} from './subagent-settings.mjs';
import {patchSubagentModel} from './subagent-model.mjs';
import {patchSubagentBubbles} from './subagent-bubbles.mjs';
import {buildAutostart} from './autostart.mjs';
import {usageSectionSrc} from './usage-section.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {patchRemoteRouting} from './remote-routing.mjs';
import {pickerSectionHelpersSrc, patchPickerSections} from './picker-sections.mjs';

function replaceOnce(source,from,to){
  if(source.split(from).length!==2)throw new Error('Patch anchor not unique: '+from.slice(0,100));
  return source.replace(from,to);
}

function wrapGetter(source){
  if(/getAvailableDefaultModels\(\)\{return __withChatgptBridgeModels\(/.test(source))return source;
  const getter=source.includes('return __withClaudeBridgeModels([...this._availableDefaultModels()])')
    ? 'getAvailableDefaultModels(){return __withClaudeBridgeModels([...this._availableDefaultModels()])}'
    : 'getAvailableDefaultModels(){return[...this._availableDefaultModels()]}';
  return replaceOnce(source,getter,getter.replace(/return\s*(.+)}/,'return __withChatgptBridgeModels($1)}'));
}

function wrapMap(source, {plain, claude, gpt}){
  if(source.includes(gpt)||source.includes('__withChatgptBridgeModels(__withClaudeBridgeModels(')||source.includes('__withClaudeBridgeModels(__withChatgptBridgeModels('))return source;
  if(source.includes(claude))return replaceOnce(source,claude,gpt.replace('__withChatgptBridgeModels(c)','__withChatgptBridgeModels(__withClaudeBridgeModels(c))').replace('__withChatgptBridgeModels(l)','__withChatgptBridgeModels(__withClaudeBridgeModels(l))'));
  return replaceOnce(source,plain,gpt);
}

function addUsage(source, {fn, jsx, original, claudeOnly, symbols}){
  if(!source.includes('function __chatgptUsageSection'))source=replaceOnce(source,fn,usageSectionSrc(symbols)+fn);
  if(source.includes(jsx+'(__chatgptUsageSection,{})'))return source;
  const children=source.includes(claudeOnly)?claudeOnly:original;
  return replaceOnce(source,children,children.slice(0,-1)+','+jsx+'(__chatgptUsageSection,{})]');
}

function wrapRuntime(runtime){
  if(runtime.includes('t.startsWith("chatgpt-codex/")'))return runtime;
  // Cursor 3.21.1 rotated the minified locals and the two runtime bundles no
  // longer agree on them, so read the parameter list variable off the anchor.
  const anchor=runtime.match(/\}\(([\w$]+)\);if\(typeof t==="string"&&t\.startsWith\("claude-subscription\/"\)/)
    ??runtime.match(/\}\(([\w$]+)\);if\(void 0===a\)return;if\(void 0!==i&&"openai_compatible"===[\w$]+\)/);
  if(!anchor)throw new Error('Reasoning effort anchor missing');
  const params=anchor[1];
  const gpt='}('+params+');if(typeof t==="string"&&t.startsWith("chatgpt-codex/")){const selected='+params+'?.find(p=>p.id==="reasoning")?.value;if(selected!==undefined){e.reasoning={...e.reasoning,effort:selected};delete e.reasoning_effort}const fast='+params+'?.find(p=>p.id==="fast")?.value;if(fast==="true")e.service_tier="priority";else delete e.service_tier;return}';
  return replaceOnce(runtime,anchor[0],gpt+anchor[0].slice(('}('+params+');').length));
}

export function buildPatches({root,cfg,models,nodePath,bridgePath,stateDir}) {
const pending=[];
const workbenchPath=path.join(root,'out/vs/workbench/workbench.desktop.main.js');
let wb=fs.readFileSync(workbenchPath,'utf8');
const base='http://127.0.0.1:'+cfg.port;
const prelude=`\n/* cursor-chatgpt-bridge 0.1.3: account credentials stay in local bridge */\nvar __chatgptBridgeModels=${JSON.stringify(models)};\nconst __chatgptBridgeBase=${JSON.stringify(base)},__chatgptBridgeKey=${JSON.stringify(cfg.key)};\nfunction __isChatgptBridgeModel(m){return typeof m==="string"&&m.startsWith("chatgpt-codex/")}\nfunction __withChatgptBridgeModels(models){return [...models.filter(m=>!__isChatgptBridgeModel(m.name)),...__chatgptBridgeModels]}\nasync function __refreshChatgptBridgeModels(){try{const r=await fetch(__chatgptBridgeBase+"/picker-models",{headers:{Authorization:"Bearer "+__chatgptBridgeKey},signal:AbortSignal.timeout(2500)});if(r.ok){const data=await r.json();if(Array.isArray(data.models))__chatgptBridgeModels=data.models}}catch{}}\n${pickerSectionHelpersSrc}\n`;
wb=prelude+wb;
wb=wrapGetter(wb);
wb=replaceOnce(wb,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
wb=wrapMap(wb,{plain:'const C=h(c);c=c.map(V=>DLt(V)),',claude:'const C=h(c);c=__withClaudeBridgeModels(c).map(V=>DLt(V)),',gpt:'const C=h(c);c=__withChatgptBridgeModels(c).map(V=>DLt(V)),'});
wb=patchPickerSections(wb,replaceOnce,{
  groupReturn:'return c.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...ie,...ee],others:le}:{leading:ie,promoted:ee,others:le}',
  promotedAnchor:'jP(smt,{models:B.promoted,title:c?.promotedSectionTitle',modelsVar:'B',jsx:'jP',fmt:'smt',renderModel:'x'});
wb=replaceOnce(wb,'async getLocalAgentProviderConfig(e,t){',
 'async getLocalAgentProviderConfig(e,t){if(__isChatgptBridgeModel(t?.requestedModel?.modelId??e?.modelId))return{baseUrl:__chatgptBridgeBase+"/v1",apiKey:__chatgptBridgeKey,customHeaders:{}};');
if(wb.includes('const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);')){
  if(!wb.includes('__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId)')){
    wb=replaceOnce(wb,'const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);',
      'const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId)||(typeof __isClaudeBridgeModel==="function"&&__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId));');
  }
}else if(wb.includes('const __claudeLocal=__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId);')){
  wb=replaceOnce(wb,'const __claudeLocal=__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId);',
    'const __claudeLocal=__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId);const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);');
  wb=wb.replaceAll('||__claudeLocal','||__claudeLocal||__chatgptLocal');
}else{
  wb=replaceOnce(wb,'async run(e,t,n,i,r,s,o,a,c,l,u){const h=a6d(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:zc.localMode});if(zc.localMode){',
   'async run(e,t,n,i,r,s,o,a,c,l,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const h=a6d(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:zc.localMode||__chatgptLocal});if(zc.localMode||__chatgptLocal){');
}
wb+=`\n$e(class extends ct{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(e){try{const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("Could not start sign-in");e.get(si).info("Complete ChatGPT sign-in in your browser, then reload the Cursor window.")}catch(error){e.get(si).error("Cannot reach the ChatGPT connection. Restart Cursor.")}}});\n`;
wb=addUsage(wb,{fn:'function ZIy(e){const t=Obp(119)',jsx:'GIy',
  original:'title:"Plan & Usage",children:[sn,qt,dn,bn]',
  claudeOnly:'title:"Plan & Usage",children:[sn,qt,dn,bn,GIy(__claudeUsageSection,{})]',
  symbols:{jsx:'GIy',useState:'Zur',useEffect:'eIy',card:'ob',zs:'ks',bar:'kA',barStyle:'rdr'}});
wb=patchMaxMode(patchSubagentSettingsWorkbench(wb));
wb=patchSubagentBubbles(patchRemoteRouting(wb,'desktop','3.21.13'),'desktop','3.21.13');
wb=patchSubagentLifecycle(wb,'desktop','chatgpt-codex/','3.21.13');
wb=patchConversationActionsWorkbench(wb,'desktop','chatgpt-codex/');
pending.push({path:workbenchPath,content:wb});
const glassPath=path.join(root,'out/vs/workbench/workbench.glass.main.js');
let glass=prelude+fs.readFileSync(glassPath,'utf8');
glass=wrapGetter(glass);
glass=replaceOnce(glass,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
glass=wrapMap(glass,{plain:'const S=d(l);l=l.map(U=>Von(U)),',claude:'const S=d(l);l=__withClaudeBridgeModels(l).map(U=>Von(U)),',gpt:'const S=d(l);l=__withChatgptBridgeModels(l).map(U=>Von(U)),'});
glass=patchPickerSections(glass,replaceOnce,{
  groupReturn:'return l.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...ne,...X],others:ie}:{leading:ne,promoted:X,others:ie}',
  promotedAnchor:'Y5(e9t,{models:N.promoted,title:l?.promotedSectionTitle',modelsVar:'N',jsx:'Y5',fmt:'e9t',renderModel:'w'});
glass=replaceOnce(glass,'async getLocalAgentProviderConfig(t,e){',
 'async getLocalAgentProviderConfig(t,e){if(__isChatgptBridgeModel(e?.requestedModel?.modelId??t?.modelId))return{baseUrl:__chatgptBridgeBase+"/v1",apiKey:__chatgptBridgeKey,customHeaders:{}};');
if(glass.includes('const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);')){
  if(!glass.includes('__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId)')){
    glass=replaceOnce(glass,'const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);',
      'const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId)||(typeof __isClaudeBridgeModel==="function"&&__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId));');
  }
}else if(glass.includes('const __claudeLocal=__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId);')){
  glass=replaceOnce(glass,'const __claudeLocal=__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId);',
    'const __claudeLocal=__isClaudeBridgeModel(u?.requestedModel?.modelId??i?.modelId);const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);');
  glass=glass.replaceAll('||__claudeLocal','||__claudeLocal||__chatgptLocal');
}else{
  glass=replaceOnce(glass,'async run(t,e,n,i,r,s,o,a,l,c,u){const d=wum(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Rl.localMode});if(Rl.localMode){',
   'async run(t,e,n,i,r,s,o,a,l,c,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const d=wum(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Rl.localMode||__chatgptLocal});if(Rl.localMode||__chatgptLocal){');
}
glass+=`\nLt(class extends Qt{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(){const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("ChatGPT-Could not start sign-in")}});\n`;
glass=addUsage(glass,{fn:'function Rik(t){const e=fBg(119)',jsx:'xik',
  original:'title:"Plan & Usage",children:[pt,bt,gt,St]',
  claudeOnly:'title:"Plan & Usage",children:[pt,bt,gt,St,xik(__claudeUsageSection,{})]',
  symbols:{jsx:'xik',useState:'gds',useEffect:'Eik',card:'Pf',zs:'Os',bar:'Om',barStyle:'EEi'}});
glass=patchMaxMode(patchSubagentSettingsWorkbench(glass));
glass=patchSubagentBubbles(patchRemoteRouting(glass,'glass','3.21.13'),'glass','3.21.13');
glass=patchSubagentLifecycle(glass,'glass','chatgpt-codex/','3.21.13');
glass=patchConversationActionsWorkbench(glass,'glass','chatgpt-codex/');
pending.push({path:glassPath,content:glass});
for(const relative of ['extensions/cursor-agent-exec/dist/main.js','extensions/cursor-local-agent-runtime/dist/main.js']){
 pending.push({path:path.join(root,relative),content:patchConversationActionsRuntime(patchSubagentSettingsRuntime(patchSubagentModel(wrapRuntime(fs.readFileSync(path.join(root,relative),'utf8')))),'chatgpt-codex/')});
}
const mainPath=path.join(root,'out/main.js');
pending.push({path:mainPath,content:fs.readFileSync(mainPath,'utf8')+buildAutostart({nodePath,bridgePath,stateDir})});
const productPath=path.join(root,'product.json');
const product=JSON.parse(fs.readFileSync(productPath,'utf8'));
product.checksums['vs/workbench/workbench.desktop.main.js']=crypto.createHash('sha256').update(wb).digest('base64').replace(/=+$/,'');
pending.push({path:productPath,content:JSON.stringify(product,null,2)});
return pending;
}
