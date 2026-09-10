import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stateDir as dir, config, getCodexHome } from './config.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const prefix = 'chatgpt-codex/';
const codexHome = getCodexHome();
const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let refreshPromise;
let loginProcess;

export function mergeCatalog(previous,current) {
  const models=new Map(previous.map(m=>[m.slug,m]));
  for(const m of current){
    if(m.visibility==='hide'){models.delete(m.slug);continue;}
    if(m.visibility!=='list'||typeof m.slug!=='string'||!Array.isArray(m.supported_reasoning_levels))continue;
    models.set(m.slug,{slug:m.slug,display_name:m.display_name,description:m.description,
      default_reasoning_level:m.default_reasoning_level,supported_reasoning_levels:m.supported_reasoning_levels,
      visibility:m.visibility,context_window:m.context_window,input_modalities:m.input_modalities,
      additional_speed_tiers:m.additional_speed_tiers??models.get(m.slug)?.additional_speed_tiers??[],
      service_tiers:m.service_tiers??models.get(m.slug)?.service_tiers??[]});
  }
  return [...models.values()];
}
export function readModels() {
  const account = credentials().account_id;
  const accountHash = crypto.createHash('sha256').update(account).digest('hex');
  fs.mkdirSync(dir, {recursive:true});
  const saved=path.join(dir,'model-catalog-'+accountHash+'.json');let previous=[];
  try{previous=JSON.parse(fs.readFileSync(saved,'utf8'));if(!Array.isArray(previous))previous=[];}catch{}
  let current=[];
  try{
    const cached=JSON.parse(fs.readFileSync(path.join(codexHome,'models_cache.json'),'utf8')).models;
    if(!Array.isArray(cached))throw new Error('Invalid Codex model catalog. Open Codex to refresh it.');
    current=cached;
  }catch(error){if(!previous.length)throw error;}
  const models=mergeCatalog(previous,current);
  const encoded=JSON.stringify(models,null,2);
  if(JSON.stringify(previous)!==JSON.stringify(models)){
    fs.writeFileSync(saved+'.'+process.pid+'.tmp',encoded);fs.renameSync(saved+'.'+process.pid+'.tmp',saved);
  }
  return models;
}

export function supportsFast(model) {
  return model.service_tiers?.some(t=>t.id==='priority') || model.additional_speed_tiers?.includes('fast') || false;
}
export function pickerModel(m) {
  const labels={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Very high',max:'Max',ultra:'Ultra'};
  const fastAvailable=supportsFast(m);
  const fastTooltip='Request priority processing. Fast can consume more of your ChatGPT allowance. Speed and usage depend on the model and your account. The service returned standard processing in our tests, so this switch does not guarantee faster responses. [Details](https://learn.chatgpt.com/docs/agent-configuration/speed)';
  return {
    name: prefix + m.slug, serverModelName: prefix + m.slug,
    clientDisplayName: m.display_name + ' (ChatGPT)',
    inputboxShortModelName: m.display_name + ' (ChatGPT)',
    defaultOn: true, supportsAgent: true, supportsImages: m.input_modalities?.includes('image') || false,
    supportsThinking: true, supportsNonMaxMode: true, supportsMaxMode: false,
    supportsPlanMode: true, supportsAutoContext: true, contextTokenLimit: m.context_window,
    autoContextMaxTokens: m.context_window, namedModelSectionIndex: 0,
    vendorName: 'openai', vendor:{id:2,displayName:'OpenAI'}, modelPickerBadges:[], cloudAgentEffortModes:[], tagline: 'ChatGPT subscription, local connection',
    tooltipData:{primaryText:'',secondaryText:'',secondaryWarningText:false,icon:'',tertiaryText:'',tertiaryTextUrl:'',markdownContent:m.description+'\n\nChatGPT subscription, '+m.context_window+' tokens of context'},
    parameterDefinitions: [{id: 'reasoning', name: 'Reasoning', parameterType: {enumParameter: {
      values: m.supported_reasoning_levels.map(v => ({value: v.effort, displayName: labels[v.effort]||v.effort, markdownTooltip: v.description,modelPickerBadges:[]}))
    }},isCycleableByHotkey:true},...(fastAvailable?[{
      id:'fast',name:'Fast',markdownTooltip:fastTooltip,
      parameterType:{booleanParameter:{values:[{value:'false'},{value:'true',displayName:'Fast',increasesModelCost:true}]}},
      isCycleableByHotkey:true
    }]:[])],
    variants: m.supported_reasoning_levels.flatMap(v => (fastAvailable?[false,true]:[false]).map(fast=>({
      parameterValues: [{id: 'reasoning', value: v.effort},...(fastAvailable?[{id:'fast',value:String(fast)}]:[])],
      displayName: escapeHtml(m.display_name) + ' (ChatGPT) <span style="color: var(--cursor-text-tertiary);">'+escapeHtml(labels[v.effort]||v.effort)+(fast?' Fast':'')+'</span>',
      displayNameOutsidePicker:m.display_name+' (ChatGPT) '+(labels[v.effort]||v.effort)+(fast?' Fast':''),
      variantStringRepresentation:prefix+m.slug+'[reasoning='+v.effort+(fastAvailable?',fast='+fast:'')+']',isMaxMode: false,
      tooltipData:{primaryText:'',secondaryText:'',secondaryWarningText:false,icon:'',tertiaryText:'',tertiaryTextUrl:'',markdownContent:m.description+'\n\nReasoning: '+(labels[v.effort]||v.effort)+(fast?'\n\n'+fastTooltip:'')},
      isDefaultNonMaxConfig: v.effort === m.default_reasoning_level && !fast}))),
    legacySlugs: [], idAliases: []
  };
}
export function pickerModels() { return readModels().map(pickerModel); }

export function credentials() {
  const a = JSON.parse(fs.readFileSync(path.join(codexHome, 'auth.json'), 'utf8'));
  if (!a.tokens?.access_token || !a.tokens?.account_id) throw new Error('Sign in with ChatGPT using codex login.');
  return a.tokens;
}

// Let Codex own token renewal; never print or copy account credentials.
function refreshAuth() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = new Promise((resolve, reject) => {
    const child = spawn(config.codex, ['app-server'], {windowsHide: true, stdio: ['pipe','pipe','ignore']});
    let buffer = '', settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('Could not refresh ChatGPT authentication. Run codex login.')), 30000);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', () => finish(new Error('Could not start Codex authentication.')));
    child.stdin.on('error', () => finish(new Error('Codex authentication connection closed.')));
    child.on('exit', () => { if (!settled) finish(new Error('Codex authentication exited early.')); });
    child.stdout.on('data', bytes => {
      buffer += bytes.toString();
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.id === 1) {
          if (value.error) return finish(new Error('Codex authentication is unavailable.'));
          send({method:'initialized'});
          send({id:2, method:'account/read', params:{refreshToken:true}});
        }
        if (value.id === 2) finish(value.error ? new Error('Please sign in again using codex login.') : undefined);
      }
    });
    send({id:1, method:'initialize', params:{clientInfo:{name:'cursor_chatgpt_bridge',version:'1.0.0'}}});
  }).finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

export function normalizeRequest(body, models = readModels()) {
  if (typeof body.model !== 'string' || !body.model.startsWith(prefix)) throw new Error('Only ChatGPT models from this connection are supported.');
  const model = models.find(m => prefix + m.slug === body.model);
  if (!model) throw new Error('Model is not available in the local Codex catalog.');
  const input = typeof body.input === 'string' ? [{role:'user',content:[{type:'input_text',text:body.input}]}] : body.input;
  if (!Array.isArray(input)) throw new Error('Invalid Responses request.');
  const instructions = [body.instructions || ''];
  const filtered = input.filter(item => {
    if (item.role !== 'system' && item.role !== 'developer') return true;
    instructions.push(typeof item.content === 'string' ? item.content : (item.content || []).map(c => c.text || '').join('\n'));
    return false;
  });
  const effort = body.reasoning?.effort || model.default_reasoning_level;
  if (!model.supported_reasoning_levels.some(v => v.effort === effort)) throw new Error('Reasoning level is not supported by this model.');
  const tier=body.service_tier;
  if(tier!==undefined&&tier!=='default'&&tier!=='priority')throw new Error('Unsupported speed mode.');
  if(tier==='priority'&&!supportsFast(model))throw new Error('Fast is unavailable for this model.');
  return {model:model.slug, instructions:instructions.join('\n\n').trim() || 'You are a helpful assistant.',
    input:filtered, tools:body.tools || [], tool_choice:body.tool_choice || 'auto',
    parallel_tool_calls:body.parallel_tool_calls ?? true,
    reasoning:{effort, ...(body.reasoning?.summary ? {summary:body.reasoning.summary} : {})},
    ...(body.text ? {text:body.text} : {}),
    ...(tier==='priority'?{service_tier:'priority'}:{}),
    include:['reasoning.encrypted_content'], stream:true, store:false};
}

function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function authorized(req) { return Boolean(config.key) && req.headers.authorization === 'Bearer ' + config.key; }
async function readBody(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 24 * 1024 * 1024) throw new Error('Request body is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function handle(req, res) {
  try {
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && origin !== 'vscode-file://vscode-app') return json(res,403,{error:{message:'Origin not allowed'}});
    if (origin) {res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.writeHead(204); return res.end();
    }
    if (req.url === '/health' && req.method === 'GET') return json(res,200,{ok:true});
    if (!authorized(req)) return json(res,401,{error:{message:'Local bridge authentication required'}});
    if (req.method === 'POST' && req.url === '/login') {
      if (!loginProcess) {
        loginProcess=spawn(config.codex,['login'],{windowsHide:true,stdio:'ignore'});
        await new Promise((resolve,reject)=>{loginProcess.once('spawn',resolve);loginProcess.once('error',reject);});
        loginProcess.on('error',()=>{loginProcess=undefined;});
        loginProcess.on('exit',()=>{loginProcess=undefined;});
      }
      return json(res,202,{message:'ChatGPT sign-in has been started. If no browser opens, run codex login in a terminal.'});
    }
    if (req.method === 'GET' && req.url === '/picker-models') return json(res,200,{models:pickerModels()});
    if (req.method === 'GET' && req.url === '/v1/models') return json(res,200,{object:'list',data:readModels().map(m=>({id:prefix+m.slug,object:'model',owned_by:'openai',context_window:m.context_window}))});
    if (req.method !== 'POST' || req.url !== '/v1/responses') return json(res,404,{error:{message:'Route not supported'}});
    const request = normalizeRequest(await readBody(req));
    const abort = new AbortController();
    const timeout = setTimeout(()=>abort.abort(), 30 * 60 * 1000);
    res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    try {
      let upstream;
      for (let attempt=0;attempt<2;attempt++) {
        const auth = credentials();
        upstream = await fetch(endpoint,{method:'POST',redirect:'error',signal:abort.signal,
          headers:{Authorization:'Bearer '+auth.access_token,'ChatGPT-Account-Id':auth.account_id,
            'Content-Type':'application/json',originator:'codex_cli_rs'},body:JSON.stringify(request)});
        if (upstream.status !== 401 || attempt === 1) break;
        await upstream.body.cancel(); await refreshAuth();
      }
      if (!upstream.ok) {
        // Upstream error bodies can contain request metadata; return only a bounded message.
        let detail='';try {const e=await upstream.json();detail=e.error?.message||e.detail||'';}catch{}
        return json(res,upstream.status,{error:{message:typeof detail==='string'?detail.slice(0,1200):'ChatGPT request rejected'}});
      }
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await new Promise((resolve,reject)=>{const drain=()=>{res.off('close',close);resolve();};const close=()=>{res.off('drain',drain);reject(new Error('Client disconnected'));};res.once('drain',drain);res.once('close',close);});
      }
      res.end();
    } finally {clearTimeout(timeout);}
  } catch(error) {
    if (res.headersSent) res.destroy();
    else json(res,400,{error:{message:error.message?.includes('auth.json')?'Run codex login.':error.message || 'Bridge error'}});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server=http.createServer(handle);
  server.on('error',e=>{process.stderr.write('Local bridge failed: '+e.code+'\n');process.exit(1);});
  server.listen(config.port,'127.0.0.1',()=>process.stdout.write('ChatGPT bridge ready on loopback\n'));
}
