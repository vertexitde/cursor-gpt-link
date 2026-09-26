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
import {wrapRuntime} from './patches-runtime.mjs';
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

export function buildPatches({root,cfg,models,nodePath,bridgePath,stateDir}) {
const pending=[];
const workbenchPath=path.join(root,'out/vs/workbench/workbench.desktop.main.js');
let wb=fs.readFileSync(workbenchPath,'utf8');
const base='http://127.0.0.1:'+cfg.port;
const prelude=`\n/* cursor-chatgpt-bridge 0.1.3: account credentials stay in local bridge */\nvar __chatgptBridgeModels=${JSON.stringify(models)};\nconst __chatgptBridgeBase=${JSON.stringify(base)},__chatgptBridgeKey=${JSON.stringify(cfg.key)};\nfunction __isChatgptBridgeModel(m){return typeof m==="string"&&m.startsWith("chatgpt-codex/")}\nfunction __withChatgptBridgeModels(models){return [...models.filter(m=>!__isChatgptBridgeModel(m.name)),...__chatgptBridgeModels]}\nasync function __refreshChatgptBridgeModels(){try{const r=await fetch(__chatgptBridgeBase+"/picker-models",{headers:{Authorization:"Bearer "+__chatgptBridgeKey},signal:AbortSignal.timeout(2500)});if(r.ok){const data=await r.json();if(Array.isArray(data.models))__chatgptBridgeModels=data.models}}catch{}}\n${pickerSectionHelpersSrc}\n`;
wb=prelude+wb;
wb=wrapGetter(wb);
wb=replaceOnce(wb,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
wb=wrapMap(wb,{plain:'const T=h(c);c=c.map(j=>gNt(j)),',claude:'const T=h(c);c=__withClaudeBridgeModels(c).map(j=>gNt(j)),',gpt:'const T=h(c);c=__withChatgptBridgeModels(c).map(j=>gNt(j)),'});
wb=patchPickerSections(wb,replaceOnce,{
  groupReturn:'return c.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...se,...ee],others:ae}:{leading:se,promoted:ee,others:ae}',
  promotedAnchor:'tL(Zmt,{models:B.promoted,title:c?.promotedSectionTitle',modelsVar:'B',jsx:'tL',fmt:'Zmt',renderModel:'x'});
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
  wb=replaceOnce(wb,'async run(e,t,n,i,r,s,o,a,c,l,u){const h=_Gd(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Rc.localMode});if(Rc.localMode){',
   'async run(e,t,n,i,r,s,o,a,c,l,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const h=_Gd(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Rc.localMode||__chatgptLocal});if(Rc.localMode||__chatgptLocal){');
}
wb+=`\nWe(class extends ct{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(e){try{const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("Could not start sign-in");e.get(ai).info("Complete ChatGPT sign-in in your browser, then reload the Cursor window.")}catch(error){e.get(ai).error("Cannot reach the ChatGPT connection. Restart Cursor.")}}});\n`;
wb=addUsage(wb,{fn:'function k7y(e){const t=pxp(119)',jsx:'v7y',
  original:'title:"Plan & Usage",children:[qt,Jt,Pt,on]',
  claudeOnly:'title:"Plan & Usage",children:[qt,Jt,Pt,on,v7y(__claudeUsageSection,{})]',
  symbols:{jsx:'v7y',useState:'Jhr',useEffect:'E8y',card:'Sv',zs:'ks',bar:'yR',barStyle:'opr'}});
wb=patchMaxMode(patchSubagentSettingsWorkbench(wb));
wb=patchSubagentBubbles(patchRemoteRouting(wb,'desktop','3.22.9'),'desktop','3.22.9');
wb=patchSubagentLifecycle(wb,'desktop','chatgpt-codex/','3.22.9');
wb=patchConversationActionsWorkbench(wb,'desktop','chatgpt-codex/');
pending.push({path:workbenchPath,content:wb});
const glassPath=path.join(root,'out/vs/workbench/workbench.glass.main.js');
let glass=prelude+fs.readFileSync(glassPath,'utf8');
glass=wrapGetter(glass);
glass=replaceOnce(glass,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
glass=wrapMap(glass,{plain:'const S=d(l);l=l.map(U=>oln(U)),',claude:'const S=d(l);l=__withClaudeBridgeModels(l).map(U=>oln(U)),',gpt:'const S=d(l);l=__withChatgptBridgeModels(l).map(U=>oln(U)),'});
glass=patchPickerSections(glass,replaceOnce,{
  groupReturn:'return l.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...ne,...X],others:ie}:{leading:ne,promoted:X,others:ie}',
  promotedAnchor:'bF(u8t,{models:N.promoted,title:l?.promotedSectionTitle',modelsVar:'N',jsx:'bF',fmt:'u8t',renderModel:'w'});
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
  glass=replaceOnce(glass,'async run(t,e,n,i,r,s,o,a,l,c,u){const d=Hkm(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:vl.localMode});if(vl.localMode){',
   'async run(t,e,n,i,r,s,o,a,l,c,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const d=Hkm(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:vl.localMode||__chatgptLocal});if(vl.localMode||__chatgptLocal){');
}
glass+=`\nLt(class extends en{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(){const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("ChatGPT-Could not start sign-in")}});\n`;
glass=addUsage(glass,{fn:'function jCk(t){const e=$Qg(119)',jsx:'FCk',
  original:'title:"Plan & Usage",children:[lt,dt,gt,vt]',
  claudeOnly:'title:"Plan & Usage",children:[lt,dt,gt,vt,FCk(__claudeUsageSection,{})]',
  symbols:{jsx:'FCk',useState:'fms',useEffect:'OCk',card:'rf',zs:'Hs',bar:'Rg',barStyle:'TIi'}});
glass=patchMaxMode(patchSubagentSettingsWorkbench(glass));
glass=patchSubagentBubbles(patchRemoteRouting(glass,'glass','3.22.9'),'glass','3.22.9');
glass=patchSubagentLifecycle(glass,'glass','chatgpt-codex/','3.22.9');
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
