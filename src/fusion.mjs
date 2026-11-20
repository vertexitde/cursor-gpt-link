// Fusion: a cheap scout model works through the reading part of a task and a
// stronger builder model does everything else. It appears as "Fusion" in the
// ChatGPT Subscription and Claude Subscription sections, with a Scout and a
// Builder picker; either may be a ChatGPT or a Claude model.
//
// Every agent step goes to the scout first. When it only asks for read-only
// tools (reading, listing, searching), its answer goes back to Cursor as is.
// When it wants to change something, run anything else or answer the user,
// the answer is discarded and the builder takes the same step. The bridges
// already speak the same Responses API, so a step is forwarded to whichever
// local bridge serves the chosen model.
//
// With Context "Condensed", the builder does not get the raw output of the
// scout's reads from the current turn: the scout summarises them once and the
// builder gets that summary instead. This saves the most, and the builder can
// read a file again when it needs the exact text.
//
// This file is shared by cursor-gpt-link and cursor-claude-link; keep the two
// copies identical.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const fusionSlug = 'fusion';
export const prefixes = {chatgpt:'chatgpt-codex/', claude:'claude-subscription/'};
const sectionNames = {[prefixes.chatgpt]:'ChatGPT', [prefixes.claude]:'Claude'};

export const isFusionModel = model => typeof model === 'string' && Object.values(prefixes).some(prefix => model === prefix + fusionSlug);

// Tools that only look. Anything not listed here (edits, patches, the shell,
// subagents, to-dos, MCP tools) is the builder's.
const readOnly = new Set(['readfile', 'read_file', 'listdir', 'list_dir', 'grep', 'grep_search', 'glob', 'glob_file_search', 'file_search',
  'codebase_search', 'semanticsearch', 'semantic_search', 'websearch', 'web_search', 'webfetch', 'web_fetch', 'xsearch', 'readlints', 'read_lints',
  'fetchmcpresource', 'fetch_mcp_resource', 'searchconversations', 'search_conversations']);
export const isReadOnlyTool = name => typeof name === 'string' && readOnly.has(name.toLowerCase());

// The local bridges and their keys, from their own configuration files.
export function localBridges({home = os.homedir(), env = process.env} = {}) {
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; } };
  const out = {};
  const gpt = read(path.join(env.CURSOR_CHATGPT_BRIDGE_HOME || path.join(home, 'cursor-chatgpt-bridge'), 'config.json'));
  const claude = read(path.join(env.CURSOR_CLAUDE_LINK_HOME || path.join(home, 'cursor-claude-link'), 'config.json'));
  if (gpt?.port && gpt?.key) out[prefixes.chatgpt] = {base:'http://127.0.0.1:' + gpt.port, key:gpt.key};
  if (claude?.port && claude?.key) out[prefixes.claude] = {base:'http://127.0.0.1:' + claude.port, key:claude.key};
  return out;
}

const bridgeFor = (bridges, model) => Object.entries(bridges).find(([prefix]) => model.startsWith(prefix))?.[1];

// Scouts are the quick, cheap tiers; every model may build. Keeping the scout
// list short keeps the picker entry small, since each pair is a variant.
export const isScoutTier = name => /haiku|sonnet|luna|terra|mini|spark|flash/i.test(name);

// The newest version first: gpt-6.2-astra before gpt-6-astra.
const version = name => (name.match(/(\d+(?:[.-]\d+)*)/)?.[1] ?? '0').split(/[.-]/).map(Number);
const newest = names => [...names].sort((a, b) => {
  const x = version(a), y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
})[0];

// Picks sensible defaults: a small model scouts, the strongest one builds.
function defaultsFor(prefix, scouts, builders) {
  const pick = (list, pattern) => list.map(option => option.value).find(name => pattern.test(name));
  const scout = pick(scouts, /claude-subscription\/haiku$/) ?? pick(scouts, /haiku/) ?? pick(scouts, /luna|mini|spark/) ?? scouts[0]?.value;
  const names = builders.map(option => option.value);
  const builder = prefix === prefixes.claude
    ? pick(builders, /^claude-subscription\/opus$/) ?? newest(names.filter(name => /claude-subscription\/.*opus/.test(name))) ?? names[0]
    : newest(names.filter(name => /chatgpt-codex\/gpt-[\d.]+-astra/.test(name))) ?? names.find(name => name.startsWith(prefixes.chatgpt)) ?? names[0];
  return {scout, builder};
}

// The picker entry. models are the picker models of both sections as far as
// they are known; every scout and builder pair is one variant.
export function fusionPickerModel(prefix, models) {
  const options = models.filter(model => !isFusionModel(model.name) && Object.values(prefixes).some(p => model.name?.startsWith(p)))
    .map(model => ({value:model.name, displayName:model.clientDisplayName ?? model.name}));
  if (!options.length) return undefined;
  const scouts = options.filter(option => isScoutTier(option.value)).length ? options.filter(option => isScoutTier(option.value)) : options;
  const {scout, builder} = defaultsFor(prefix, scouts, options);
  const contexts = [{value:'full', displayName:'Full'}, {value:'condensed', displayName:'Condensed'}];
  const id = prefix + fusionSlug, name = 'Fusion';
  const summary = 'A small model reads and explores, a strong one edits, runs and answers. Context Condensed hands the builder a summary of the scout\'s reads instead of the raw output.';
  const tooltip = {primaryText:'', secondaryText:'', secondaryWarningText:false, icon:'', tertiaryText:'', tertiaryTextUrl:'',
    markdownContent:'**Fusion (' + sectionNames[prefix] + ')**  \n' + summary};
  const variants = [];
  for (const s of scouts) for (const b of options) for (const c of contexts) {
    const isDefault = s.value === scout && b.value === builder && c.value === 'full';
    variants.push({parameterValues:[{id:'fusion_scout', value:s.value}, {id:'fusion_builder', value:b.value}, {id:'fusion_context', value:c.value}],
      // The picker and the input box show only the name; Scout, Builder and
      // Context stay in their own submenus.
      displayName:name, displayNameOutsidePicker:name,
      variantStringRepresentation:id + '[' + s.value + ',' + b.value + ',' + c.value + ']',
      isMaxMode:false, isDefaultNonMaxConfig:isDefault, isDefaultMaxConfig:isDefault});
  }
  const enumParameter = (label, tip, values) => ({name:label, markdownTooltip:tip, parameterType:{enumParameter:{values:values.map(v => ({...v, modelPickerBadges:[]}))}}});
  return {name:id, serverModelName:id, clientDisplayName:name, inputboxShortModelName:name, defaultOn:true, supportsAgent:true,
    supportsImages:true, supportsThinking:true, supportsNonMaxMode:true, supportsMaxMode:false, supportsPlanMode:true, supportsAutoContext:true,
    contextTokenLimit:200000, contextTokenLimitForMaxMode:200000, autoContextMaxTokens:200000, namedModelSectionIndex:0,
    vendorName:prefix === prefixes.claude ? 'anthropic' : 'openai', vendor:prefix === prefixes.claude ? {id:1, displayName:'Anthropic'} : {id:2, displayName:'OpenAI'},
    modelPickerBadges:[], cloudAgentEffortModes:[], tagline:summary, tooltipData:tooltip,
    parameterDefinitions:[
      {id:'fusion_scout', ...enumParameter('Scout', 'The model that reads and explores: one of the quick, cheap tiers.', scouts)},
      {id:'fusion_builder', ...enumParameter('Builder', 'The model that edits, runs commands and answers.', options)},
      {id:'fusion_context', ...enumParameter('Context', 'Condensed gives the builder a summary of the scout\'s reads instead of the raw output.', contexts)}],
    variants, legacySlugs:[], idAliases:[]};
}

// Served from GET /v1/models. The window is the smaller one of what the two
// models usually have; Cursor summarises before it is reached.
export const fusionProviderModel = prefix => ({id:prefix + fusionSlug, object:'model', owned_by:'cursor-links', api_types:['openai_responses'],
  capabilities:{context_length:200000, supports_vision:true, supports_reasoning:true, supports_tool_use:true, supports_streaming:true,
    input_modalities:['text', 'image'], output_modalities:['text']}});

// Collects the finished output items of a Responses SSE stream.
export function outputItems(sse) {
  const items = [];
  let completed;
  for (const line of String(sse).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    let event; try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
    if (event.type === 'response.output_item.done' && event.item) items.push(event.item);
    if (event.type === 'response.completed' && Array.isArray(event.response?.output)) completed = event.response.output;
    if (event.type === 'response.failed' || event.type === 'error') return {failed:true, items:[]};
  }
  return {failed:false, items:completed?.length ? completed : items};
}

// True when the scout's step may stand: it asks only for read-only tools.
export function scoutMayAnswer(items) {
  const calls = items.filter(item => item?.type === 'function_call' || item?.type === 'custom_tool_call');
  return calls.length > 0 && calls.every(call => isReadOnlyTool(call.name));
}

// The reads of the current turn: read-only tool outputs after the last user
// message, keyed by call id.
function currentReads(input) {
  if (!Array.isArray(input)) return [];
  let lastUser = -1;
  input.forEach((item, index) => { if (item?.role === 'user' || item?.type === 'message' && item.role === 'user') lastUser = index; });
  const names = new Map(input.filter(item => item?.type === 'function_call').map(item => [item.call_id, item.name]));
  return input.map((item, index) => ({item, index})).filter(({item, index}) => index > lastUser && item?.type === 'function_call_output' && isReadOnlyTool(names.get(item.call_id)));
}

const outputText = output => typeof output === 'string' ? output : JSON.stringify(output ?? '');

// Replaces the long reads of the current turn with the scout's summary.
export function condenseInput(input, summary, {minimum = 2000} = {}) {
  const reads = currentReads(input).filter(({item}) => outputText(item.output).length >= minimum);
  if (!reads.length || !summary) return input;
  const condensed = new Set(reads.map(({index}) => index));
  const out = input.map((item, index) => condensed.has(index)
    ? {...item, output:'[Condensed by the Fusion scout; the summary follows the conversation. Read the file again if you need its exact text.]'}
    : item);
  out.push({type:'message', role:'user', content:[{type:'input_text', text:'Summary of what the scout read in this turn (Fusion):\n' + summary}]});
  return out;
}

async function post(bridge, body, signal, fetchImpl) {
  return fetchImpl(bridge.base + '/v1/responses', {method:'POST', signal,
    headers:{authorization:'Bearer ' + bridge.key, 'content-type':'application/json'}, body:JSON.stringify(body)});
}

const sendJson = (res, status, body) => { if (!res.headersSent) res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)); };

async function summarise(bridge, body, signal, fetchImpl) {
  const reads = currentReads(body.input).filter(({item}) => outputText(item.output).length >= 2000);
  if (!reads.length) return undefined;
  const material = reads.map(({item}) => outputText(item.output).slice(0, 60000)).join('\n\n---\n\n');
  const request = {model:body.model, stream:true, instructions:'You condense tool output for another engineer. Keep file paths, symbol names, signatures, line numbers and every detail relevant to the task. No preamble.',
    input:[{type:'message', role:'user', content:[{type:'input_text', text:'Condense these reads for the task at hand:\n\n' + material}]}]};
  const response = await post(bridge, request, signal, fetchImpl);
  if (!response.ok) return undefined;
  const {items} = outputItems(await response.text());
  return items.filter(item => item.type === 'message').flatMap(item => item.content ?? []).map(part => part.text ?? '').join('').trim() || undefined;
}

// The default Scout and Builder of a section, from the models both bridges list.
async function defaultPair(prefix, bridges, fetchImpl) {
  const models = [];
  for (const bridge of Object.values(bridges)) {
    try {
      const response = await fetchImpl(bridge.base + '/picker-models?own=1', {headers:{authorization:'Bearer ' + bridge.key}, signal:AbortSignal.timeout(5000)});
      if (response.ok) models.push(...((await response.json()).models ?? []));
    } catch {}
  }
  const chosen = fusionPickerModel(prefix, models)?.variants.find(variant => variant.isDefaultNonMaxConfig);
  const value = id => chosen?.parameterValues.find(p => p.id === id)?.value;
  return {scout:value('fusion_scout'), builder:value('fusion_builder')};
}

// Handles one POST /v1/responses for a Fusion model. body is parsed already.
export async function handleFusion(body, res, {bridges = localBridges(), fetchImpl = fetch, log = () => {}} = {}) {
  const prefix = Object.values(prefixes).find(p => body.model === p + fusionSlug);
  const options = body.fusion ?? {};
  let scout = options.scout, builder = options.builder;
  // A runtime without the Fusion patch (an SSH host that was not patched yet)
  // sends no choice; the section's default pair stands in.
  if (!scout || !builder) ({scout = scout, builder = builder} = await defaultPair(prefix, bridges, fetchImpl));
  if (!scout || !builder) return sendJson(res, 400, {error:{message:'Choose a Scout and a Builder for Fusion in the model picker.'}});
  const scoutBridge = bridgeFor(bridges, scout), builderBridge = bridgeFor(bridges, builder);
  if (!scoutBridge || !builderBridge) return sendJson(res, 502, {error:{message:'Fusion needs the bridge for ' + (!scoutBridge ? scout : builder) + ', which is not installed or not running.'}});
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  const base = {...body};
  delete base.fusion; delete base.reasoning; delete base.reasoning_effort; delete base.service_tier;
  try {
    const scouted = await post(scoutBridge, {...base, model:scout}, abort.signal, fetchImpl);
    if (scouted.ok) {
      const text = await scouted.text();
      const {failed, items} = outputItems(text);
      if (!failed && scoutMayAnswer(items)) {
        log('fusion: scout ' + scout + ' answered with ' + items.filter(i => i.type === 'function_call').map(i => i.name).join(', '));
        res.writeHead(200, {'content-type':'text/event-stream', 'cache-control':'no-store'});
        return res.end(text);
      }
    }
    let input = base.input;
    if (options.context === 'condensed') {
      const summary = await summarise(scoutBridge, {...base, model:scout}, abort.signal, fetchImpl).catch(() => undefined);
      input = condenseInput(base.input, summary);
    }
    log('fusion: builder ' + builder + ' takes the step');
    const built = await post(builderBridge, {...base, model:builder, input}, abort.signal, fetchImpl);
    res.writeHead(built.status, {'content-type':built.headers.get('content-type') ?? 'text/event-stream', 'cache-control':'no-store'});
    for await (const chunk of built.body) res.write(chunk);
    res.end();
  } catch (error) {
    if (abort.signal.aborted) return res.destroy();
    sendJson(res, 502, {error:{message:'Fusion: ' + (error?.message ?? error)}});
  }
}

// The runtime turns the picker's Scout, Builder and Context into request
// fields; this is the branch the runtime patches add.
export const fusionRuntimeBranch = params =>
  `if(typeof t==="string"&&/^(chatgpt-codex|claude-subscription)\\/fusion$/.test(t)){const f=${params}?.filter(p=>typeof p.id==="string"&&p.id.startsWith("fusion_"));if(f?.length)e.fusion=Object.fromEntries(f.map(p=>[p.id.slice(7),p.value]))}`;

// Puts the branch right after the reasoning parameter is read, ahead of the
// provider branches, which also match ".../fusion". Each link inserts its own
// branch at the front, so the Fusion branch is moved back in front every time.
export function patchFusionRuntime(source, params) {
  const branch = fusionRuntimeBranch(params), head = '}(' + params + ');';
  source = source.split(branch).join('');
  const anchor = head + 'if(typeof t==="string"&&t.startsWith("';
  if (source.split(anchor).length !== 2) throw new Error('Fusion runtime anchor is not unique');
  return source.replace(anchor, () => head + branch + anchor.slice(head.length));
}
