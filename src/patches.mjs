import {buildAutostart} from './autostart.mjs';
import {usageSectionSrc} from './usage-section.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {patchRemoteRouting} from './remote-routing.mjs';

// These anchors are specific to the supported Cursor build.
export function buildPatches({root,cfg,models,nodePath,bridgePath,stateDir}) {
const pending=[];
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw new Error('Patch anchor not unique: '+from.slice(0,100));return source.replace(from,to);}
const workbenchPath=path.join(root,'out/vs/workbench/workbench.desktop.main.js');
let wb=fs.readFileSync(workbenchPath,'utf8');
const base='http://127.0.0.1:'+cfg.port;
const prelude=`\n/* cursor-chatgpt-bridge 0.1.2: account credentials stay in local bridge */\nvar __chatgptBridgeModels=${JSON.stringify(models)};\nconst __chatgptBridgeBase=${JSON.stringify(base)},__chatgptBridgeKey=${JSON.stringify(cfg.key)};\nfunction __isChatgptBridgeModel(m){return typeof m==="string"&&m.startsWith("chatgpt-codex/")}\nfunction __withChatgptBridgeModels(models){return [...models.filter(m=>!__isChatgptBridgeModel(m.name)),...__chatgptBridgeModels]}\nasync function __refreshChatgptBridgeModels(){try{const r=await fetch(__chatgptBridgeBase+"/picker-models",{headers:{Authorization:"Bearer "+__chatgptBridgeKey},signal:AbortSignal.timeout(2500)});if(r.ok){const data=await r.json();if(Array.isArray(data.models))__chatgptBridgeModels=data.models}}catch{}}\n`;
wb=prelude+wb;
wb=replaceOnce(wb,'getAvailableDefaultModels(){return[...this._availableDefaultModels()]}',
 'getAvailableDefaultModels(){return __withChatgptBridgeModels([...this._availableDefaultModels()])}');
wb=replaceOnce(wb,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
wb=replaceOnce(wb,'const k=h(c);c=c.map(V=>lpn(V)),','const k=h(c);c=__withChatgptBridgeModels(c).map(V=>lpn(V)),');
wb=replaceOnce(wb,'async getLocalAgentProviderConfig(e,t){',
 'async getLocalAgentProviderConfig(e,t){if(__isChatgptBridgeModel(t?.requestedModel?.modelId??e?.modelId))return{baseUrl:__chatgptBridgeBase+"/v1",apiKey:__chatgptBridgeKey,customHeaders:{}};');
wb=replaceOnce(wb,'async run(e,t,n,i,r,s,o,a,c,l,u){const h=Bjf(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Qc.localMode});if(Qc.localMode){',
 'async run(e,t,n,i,r,s,o,a,c,l,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const h=Bjf(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Qc.localMode||__chatgptLocal});if(Qc.localMode||__chatgptLocal){');
wb+=`\nFe(class extends rt{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(e){try{const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("Could not start sign-in");e.get(ai).info("Complete ChatGPT sign-in in your browser, then reload the Cursor window.")}catch(error){e.get(ai).error("Cannot reach the ChatGPT connection. Restart Cursor.")}}});\n`;
wb=replaceOnce(wb,'function O_y(e){const t=Hfp(119)',
 usageSectionSrc({jsx:'M0t',useState:'Klr',useEffect:'avp',card:'Jb',zs:'zs',bar:'EA',barStyle:'tur'})+'function O_y(e){const t=Hfp(119)');
wb=replaceOnce(wb,'title:"Plan & Usage",children:[yn,an,Kt,xn]','title:"Plan & Usage",children:[yn,an,Kt,xn,M0t(__chatgptUsageSection,{})]');
wb=patchRemoteRouting(wb,'desktop');
pending.push({path:workbenchPath,content:wb});
const glassPath=path.join(root,'out/vs/workbench/workbench.glass.main.js');
let glass=prelude+fs.readFileSync(glassPath,'utf8');
glass=replaceOnce(glass,'getAvailableDefaultModels(){return[...this._availableDefaultModels()]}',
 'getAvailableDefaultModels(){return __withChatgptBridgeModels([...this._availableDefaultModels()])}');
glass=replaceOnce(glass,'async refreshDefaultModels(){','async refreshDefaultModels(){await __refreshChatgptBridgeModels();');
glass=replaceOnce(glass,'const y=d(l);l=l.map(U=>kzn(U)),','const y=d(l);l=__withChatgptBridgeModels(l).map(U=>kzn(U)),');
glass=replaceOnce(glass,'async getLocalAgentProviderConfig(t,e){',
 'async getLocalAgentProviderConfig(t,e){if(__isChatgptBridgeModel(e?.requestedModel?.modelId??t?.modelId))return{baseUrl:__chatgptBridgeBase+"/v1",apiKey:__chatgptBridgeKey,customHeaders:{}};');
glass=replaceOnce(glass,'async run(t,e,n,i,r,s,o,a,l,c,u){const d=fyS(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Cl.localMode});if(Cl.localMode){',
 'async run(t,e,n,i,r,s,o,a,l,c,u){const __chatgptLocal=__isChatgptBridgeModel(u?.requestedModel?.modelId??i?.modelId);const d=fyS(u,{isRunningInTest:u.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localMode:Cl.localMode||__chatgptLocal});if(Cl.localMode||__chatgptLocal){');
glass+=`\nDt(class extends Kt{constructor(){super({id:"cursor.chatgpt.login",title:{value:"ChatGPT: Sign in (subscription)",original:"ChatGPT: Sign in (subscription)"},f1:!0})}async run(){const r=await fetch(__chatgptBridgeBase+"/login",{method:"POST",headers:{Authorization:"Bearer "+__chatgptBridgeKey}});if(!r.ok)throw new Error("ChatGPT-Could not start sign-in")}});\n`;
glass=replaceOnce(glass,'function hH1(t){const e=sDg(119)',
 usageSectionSrc({jsx:'cH1',useState:'vgr',useEffect:'dfd',card:'Yf',zs:'Ks',bar:'Im',barStyle:'mTi'})+'function hH1(t){const e=sDg(119)');
glass=replaceOnce(glass,'title:"Plan & Usage",children:[ft,wt,gt,Tt]','title:"Plan & Usage",children:[ft,wt,gt,Tt,cH1(__chatgptUsageSection,{})]');
glass=patchRemoteRouting(glass,'glass');
pending.push({path:glassPath,content:glass});
// Preserve explicitly selected reasoning and Fast through Cursor's local provider normalizer.
for(const relative of ['extensions/cursor-agent-exec/dist/main.js','extensions/cursor-local-agent-runtime/dist/main.js']){
 const runtimePath=path.join(root,relative);let runtime=fs.readFileSync(runtimePath,'utf8');
 runtime=replaceOnce(runtime,'}(n);if(void 0===a)return;if(void 0!==i&&"openai_compatible"===r)',
  '}(n);if(typeof t==="string"&&t.startsWith("chatgpt-codex/")){const selected=n?.find(p=>p.id==="reasoning")?.value;if(selected!==undefined){e.reasoning={...e.reasoning,effort:selected};delete e.reasoning_effort}const fast=n?.find(p=>p.id==="fast")?.value;if(fast==="true")e.service_tier="priority";else delete e.service_tier;return}if(void 0===a)return;if(void 0!==i&&"openai_compatible"===r)');
 pending.push({path:runtimePath,content:runtime});
}
const mainPath=path.join(root,'out/main.js');
let main=fs.readFileSync(mainPath,'utf8');
main+=buildAutostart({nodePath,bridgePath,stateDir});
pending.push({path:mainPath,content:main});
const productPath=path.join(root,'product.json');
const product=JSON.parse(fs.readFileSync(productPath,'utf8'));
product.checksums['vs/workbench/workbench.desktop.main.js']=crypto.createHash('sha256').update(wb).digest('base64').replace(/=+$/,'');
pending.push({path:productPath,content:JSON.stringify(product,null,2)});

return pending;
}
