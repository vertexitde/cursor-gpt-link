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
  const gpt='}(n);if(typeof t==="string"&&t.startsWith("chatgpt-codex/")){const selected=n?.find(p=>p.id==="reasoning")?.value;if(selected!==undefined){e.reasoning={...e.reasoning,effort:selected};delete e.reasoning_effort}const fast=n?.find(p=>p.id==="fast")?.value;if(fast==="true")e.service_tier="priority";else delete e.service_tier;return}';
  const anchor=runtime.includes('t.startsWith("claude-subscription/")')
    ? '}(n);if(typeof t==="string"&&t.startsWith("claude-subscription/")'
    : '}(n);if(void 0===a)return;if(void 0!==i&&"openai_compatible"===r)';
  return replaceOnce(runtime,anchor,gpt+anchor.slice(5));
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
wb=wrapMap(wb,{plain:'const k=h(c);c=c.map(V=>lpn(V)),',claude:'const k=h(c);c=__withClaudeBridgeModels(c).map(V=>lpn(V)),',gpt:'const k=h(c);c=__withChatgptBridgeModels(c).map(V=>lpn(V)),'});
wb=patchPickerSections(wb,replaceOnce,{
  groupReturn:'return c.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...re,...J],others:ce}:{leading:re,promoted:J,others:ce}',
  promotedAnchor:'HP(fmt,{models:B.promoted,title:c?.promotedSectionTitle',modelsVar:'B',jsx:'HP',fmt:'fmt',renderModel:'x'});
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
  wb=replaceOnce(wb,'async run(e,t,n,i,r,s,o,a,c,l,u){const h=Wjf(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Qc.localMode});if(Qc.localMode){',
   'async run(e,t,n,i,r,s,o,a,c,l,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const h=Wjf(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Qc.localMode||__chatgptLocal});if(Qc.localMode||__chatgptLocal){');
}
wb+=`\nFe(class extends rt{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(e){try{const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("Could not start sign-in");e.get(ai).info("Complete ChatGPT sign-in in your browser, then reload the Cursor window.")}catch(error){e.get(ai).error("Cannot reach the ChatGPT connection. Restart Cursor.")}}});\n`;
wb=addUsage(wb,{fn:'function W_y(e){const t=Vfp(119)',jsx:'SDm',
  original:'title:"Plan & Usage",children:[yn,an,Kt,xn]',
  claudeOnly:'title:"Plan & Usage",children:[yn,an,Kt,xn,SDm(__claudeUsageSection,{})]',
  symbols:{jsx:'SDm',useState:'OOm',useEffect:'FOm',card:'Jb',zs:'zs',bar:'xA',barStyle:'nur'}});
wb=patchRemoteRouting(wb,'desktop','3.20.11');
pending.push({path:workbenchPath,content:wb});
const glassPath=path.join(root,'out/vs/workbench/workbench.glass.main.js');
let glass=prelude+fs.readFileSync(glassPath,'utf8');
glass=wrapGetter(glass);
glass=replaceOnce(glass,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
glass=wrapMap(glass,{plain:'const y=d(l);l=l.map(U=>kzn(U)),',claude:'const y=d(l);l=__withClaudeBridgeModels(l).map(U=>kzn(U)),',gpt:'const y=d(l);l=__withChatgptBridgeModels(l).map(U=>kzn(U)),'});
glass=patchPickerSections(glass,replaceOnce,{
  groupReturn:'return l.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...te,...Q],others:ie}:{leading:te,promoted:Q,others:ie}',
  promotedAnchor:'pF(d8t,{models:N.promoted,title:l?.promotedSectionTitle',modelsVar:'N',jsx:'pF',fmt:'d8t',renderModel:'k'});
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
  glass=replaceOnce(glass,'async run(t,e,n,i,r,s,o,a,l,c,u){const d=EyS(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Cl.localMode});if(Cl.localMode){',
   'async run(t,e,n,i,r,s,o,a,l,c,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const d=EyS(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Cl.localMode||__chatgptLocal});if(Cl.localMode||__chatgptLocal){');
}
glass+=`\nDt(class extends Kt{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(){const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("ChatGPT-Could not start sign-in")}});\n`;
glass=addUsage(glass,{fn:'function kH1(t){const e=hDg(119)',jsx:'cVb',
  original:'title:"Plan & Usage",children:[ft,wt,gt,Ct]',
  claudeOnly:'title:"Plan & Usage",children:[ft,wt,gt,Ct,cVb(__claudeUsageSection,{})]',
  symbols:{jsx:'cVb',useState:'fgr',useEffect:'ffd',card:'Yf',zs:'Ks',bar:'Am',barStyle:'mTi'}});
glass=patchRemoteRouting(glass,'glass','3.20.11');
pending.push({path:glassPath,content:glass});
for(const relative of ['extensions/cursor-agent-exec/dist/main.js','extensions/cursor-local-agent-runtime/dist/main.js']){
 pending.push({path:path.join(root,relative),content:wrapRuntime(fs.readFileSync(path.join(root,relative),'utf8'))});
}
const mainPath=path.join(root,'out/main.js');
pending.push({path:mainPath,content:fs.readFileSync(mainPath,'utf8')+buildAutostart({nodePath,bridgePath,stateDir})});
const productPath=path.join(root,'product.json');
const product=JSON.parse(fs.readFileSync(productPath,'utf8'));
product.checksums['vs/workbench/workbench.desktop.main.js']=crypto.createHash('sha256').update(wb).digest('base64').replace(/=+$/,'');
pending.push({path:productPath,content:JSON.stringify(product,null,2)});
return pending;
}
