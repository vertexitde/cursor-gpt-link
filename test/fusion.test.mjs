import test from 'node:test';
import assert from 'node:assert/strict';
import {isFusionModel, isReadOnlyTool, scoutMayAnswer, outputItems, fusionPickerModel, fusionProviderModel, condenseInput,
  handleFusion, forwardForeign, fusionNote, withoutEncryptedReasoning, fusionRuntimeBranch, patchFusionRuntime, prefixes} from '../src/fusion.mjs';

const sse = items => items.map(item => 'event: response.output_item.done\ndata: ' + JSON.stringify({type:'response.output_item.done', item})).join('\n\n') + '\n\n';
const call = (name, args = '{}') => ({type:'function_call', name, call_id:'c_' + name, arguments:args});
const message = text => ({type:'message', role:'assistant', content:[{type:'output_text', text}]});

test('Fusion ids and read-only tools', () => {
  assert.ok(isFusionModel('chatgpt-codex/fusion') && isFusionModel('claude-subscription/fusion'));
  assert.ok(!isFusionModel('chatgpt-codex/gpt-6-astra') && !isFusionModel('kimi/fusion'));
  for (const name of ['ReadFile', 'ListDir', 'Grep', 'Glob', 'read_file', 'codebase_search', 'WebSearch']) assert.ok(isReadOnlyTool(name), name);
  for (const name of ['ApplyPatch', 'Write', 'StrReplace', 'Shell', 'run_terminal_cmd', 'Task', 'TodoWrite', 'mcp__x__y']) assert.ok(!isReadOnlyTool(name), name);
});

test('the scout keeps a step only when it asks for read-only tools', () => {
  assert.ok(scoutMayAnswer([call('ReadFile'), call('Grep')]));
  assert.ok(!scoutMayAnswer([call('ReadFile'), call('ApplyPatch')]), 'any write goes to the builder');
  assert.ok(!scoutMayAnswer([message('Done.')]), 'answers to the user go to the builder');
  assert.ok(!scoutMayAnswer([]));
  assert.deepEqual(outputItems(sse([call('ReadFile'), message('x')])).items.map(i => i.type), ['function_call', 'message']);
  assert.equal(outputItems('data: {"type":"response.failed"}\n').failed, true);
});

const pickers = [
  {name:'chatgpt-codex/gpt-6.2-astra', clientDisplayName:'GPT-6.2-Astra'}, {name:'chatgpt-codex/gpt-6-luna', clientDisplayName:'GPT-6-Luna'},
  {name:'claude-subscription/opus', clientDisplayName:'Claude Opus 5.5'}, {name:'claude-subscription/haiku', clientDisplayName:'Claude Haiku 5.5'},
  {name:'claude-subscription/fusion', clientDisplayName:'Fusion'}, {name:'kimi/k3', clientDisplayName:'K3'}];

test('the picker entry offers the cheap tiers as Scout and every ChatGPT and Claude model as Builder', () => {
  const fusion = fusionPickerModel(prefixes.chatgpt, [{name:'chatgpt-codex/gpt-6-astra', clientDisplayName:'GPT-6-Astra'}, ...pickers]);
  assert.equal(fusion.name, 'chatgpt-codex/fusion');
  const [scout, builder, context] = fusion.parameterDefinitions;
  assert.deepEqual(scout.parameterType.enumParameter.values.map(v => v.value), ['chatgpt-codex/gpt-6-luna', 'claude-subscription/haiku']);
  assert.deepEqual(builder.parameterType.enumParameter.values.map(v => v.value), ['chatgpt-codex/gpt-6-astra', 'chatgpt-codex/gpt-6.2-astra', 'chatgpt-codex/gpt-6-luna', 'claude-subscription/opus', 'claude-subscription/haiku']);
  assert.deepEqual(context.parameterType.enumParameter.values.map(v => v.value), ['full', 'condensed']);
  assert.equal(fusion.variants.length, 2 * 5 * 2);
  const chosen = fusion.variants.filter(v => v.isDefaultNonMaxConfig);
  assert.equal(chosen.length, 1);
  assert.deepEqual(chosen[0].parameterValues.map(p => p.value), ['claude-subscription/haiku', 'chatgpt-codex/gpt-6.2-astra', 'full'], 'Haiku scouts, Astra builds');
  const claude = fusionPickerModel(prefixes.claude, pickers).variants.find(v => v.isDefaultNonMaxConfig);
  assert.deepEqual(claude.parameterValues.map(p => p.value), ['claude-subscription/haiku', 'claude-subscription/opus', 'full'], 'Haiku scouts, Opus builds');
  assert.equal(fusionPickerModel(prefixes.chatgpt, [{name:'kimi/k3'}]), undefined);
  assert.equal(fusionProviderModel(prefixes.claude).id, 'claude-subscription/fusion');
});

test('condensing replaces the long reads of the current turn with the summary', () => {
  const big = 'x'.repeat(5000);
  const input = [
    {type:'message', role:'user', content:'old'}, {type:'function_call', name:'ReadFile', call_id:'old'}, {type:'function_call_output', call_id:'old', output:big},
    {type:'message', role:'user', content:'task'},
    {type:'function_call', name:'ReadFile', call_id:'r1'}, {type:'function_call_output', call_id:'r1', output:big},
    {type:'function_call', name:'ReadFile', call_id:'r2'}, {type:'function_call_output', call_id:'r2', output:'short'},
    {type:'function_call', name:'Shell', call_id:'s1'}, {type:'function_call_output', call_id:'s1', output:big}];
  const out = condenseInput(input, 'The summary.');
  assert.equal(out[2].output, big, 'earlier turns stay');
  assert.match(out[5].output, /Condensed by the Fusion scout/);
  assert.equal(out[7].output, 'short', 'short reads stay');
  assert.equal(out[9].output, big, 'non-read output stays');
  assert.match(out.at(-1).content[0].text, /The summary\./);
  assert.equal(condenseInput(input, undefined), input, 'no summary, no change');
});

class FakeResponse {
  constructor(status, text) { this.status = status; this.ok = status < 400; this.text_ = text; this.headers = new Map([['content-type', 'text/event-stream']]); this.body = [Buffer.from(text)]; }
  async text() { return this.text_; }
}
function fakeRes() {
  const res = {status:0, body:'', headersSent:false, writableEnded:false,
    writeHead(status) { this.status = status; this.headersSent = true; return this; }, write(chunk) { this.body += chunk; return true; },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; }, on() {}, destroy() {}};
  return res;
}
const bridges = {[prefixes.chatgpt]:{base:'http://gpt', key:'g'}, [prefixes.claude]:{base:'http://claude', key:'c'}};
const fusionBody = (context = 'full') => ({model:'chatgpt-codex/fusion', stream:true, reasoning:{effort:'high'},
  fusion:{scout:'claude-subscription/haiku', builder:'chatgpt-codex/gpt-6.2-astra', context},
  input:[{type:'message', role:'user', content:'task'}, {type:'function_call', name:'ReadFile', call_id:'r1'}, {type:'function_call_output', call_id:'r1', output:'y'.repeat(3000)}]});

test('a read-only scout step goes straight back to Cursor', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({url, body:JSON.parse(init.body), auth:init.headers.authorization}); return new FakeResponse(200, sse([call('Grep')])); };
  const res = fakeRes();
  await handleFusion(fusionBody(), res, {bridges, fetchImpl, log:() => {}});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'http://claude/v1/responses');
  assert.equal(sent[0].auth, 'Bearer c');
  assert.equal(sent[0].body.model, 'claude-subscription/haiku');
  assert.equal(sent[0].body.fusion, undefined, 'Fusion fields stay in this bridge');
  assert.equal(sent[0].body.reasoning, undefined, 'each model uses its own default effort');
  assert.match(res.body, /"name":"Grep"/);
});

test('a step that writes or answers is taken by the builder', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({url, body:JSON.parse(init.body)});
    return url.startsWith('http://claude') ? new FakeResponse(200, sse([call('ApplyPatch')])) : new FakeResponse(200, sse([message('built')]));
  };
  const res = fakeRes();
  await handleFusion(fusionBody(), res, {bridges, fetchImpl, log:() => {}});
  assert.deepEqual(sent.map(s => s.url), ['http://claude/v1/responses', 'http://gpt/v1/responses']);
  assert.equal(sent[1].body.model, 'chatgpt-codex/gpt-6.2-astra');
  assert.equal(sent[1].body.input[2].output.length, 3000, 'Full keeps the raw reads');
  assert.match(res.body, /built/);
});

test('Condensed hands the builder the scout summary instead of the raw reads', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); sent.push({url, body});
    if (url.startsWith('http://gpt')) return new FakeResponse(200, sse([message('built')]));
    return body.instructions ? new FakeResponse(200, sse([message('Summary: file y.')])) : new FakeResponse(200, sse([message('done')]));
  };
  await handleFusion(fusionBody('condensed'), fakeRes(), {bridges, fetchImpl, log:() => {}});
  assert.equal(sent.length, 3, 'scout step, summary, builder step');
  const builderInput = sent[2].body.input;
  assert.match(builderInput[2].output, /Condensed by the Fusion scout/);
  assert.match(builderInput.at(-1).content[0].text, /Summary: file y\./);
});

test('missing choices and bridges are reported', async () => {
  const res = fakeRes();
  await handleFusion({model:'chatgpt-codex/fusion', input:[]}, res, {bridges, fetchImpl:async () => { throw new Error('offline'); }, log:() => {}});
  assert.equal(res.status, 400);
  const other = fakeRes();
  await handleFusion(fusionBody(), other, {bridges:{[prefixes.chatgpt]:bridges[prefixes.chatgpt]}, log:() => {}});
  assert.equal(other.status, 502);
  assert.match(other.body, /claude-subscription\/haiku/);
});

test('the runtime branch turns the picker parameters into the fusion field', () => {
  const run = new Function('t', 'r', 'e', fusionRuntimeBranch('r') + 'return e;');
  const params = [{id:'fusion_scout', value:'claude-subscription/haiku'}, {id:'fusion_builder', value:'chatgpt-codex/gpt-6.2-astra'}, {id:'fusion_context', value:'condensed'}];
  assert.deepEqual(run('chatgpt-codex/fusion', params, {}).fusion, {scout:'claude-subscription/haiku', builder:'chatgpt-codex/gpt-6.2-astra', context:'condensed'});
  assert.equal(run('chatgpt-codex/gpt-6-astra', params, {}).fusion, undefined);
  const source = 'x}(r);if(typeof t==="string"&&t.startsWith("chatgpt-codex/")){}';
  const patched = patchFusionRuntime(source, 'r');
  assert.ok(patched.includes('}(r);if(typeof t==="string"&&/^(chatgpt-codex|claude-subscription)'));
  assert.equal(patchFusionRuntime(patched, 'r'), patched, 'the second link leaves it alone');
});

test('without a choice from the runtime (an unpatched SSH host) the default pair is used', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/picker-models?own=1')) return {ok:true, json:async () => ({models:url.startsWith('http://gpt') ? pickers.slice(0, 2) : pickers.slice(2, 4)})};
    sent.push({url, body:JSON.parse(init.body)});
    return new FakeResponse(200, sse([call('ReadFile')]));
  };
  const res = fakeRes();
  await handleFusion({model:'chatgpt-codex/fusion', stream:true, input:[]}, res, {bridges, fetchImpl, log:() => {}});
  assert.equal(sent[0].body.model, 'claude-subscription/haiku');
  assert.match(res.body, /ReadFile/);
});

test('a scout subagent that reaches the other bridge is forwarded there', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({url, body:JSON.parse(init.body)}); return new FakeResponse(200, sse([message('done')])); };
  const res = fakeRes();
  assert.equal(await forwardForeign({model:'claude-subscription/haiku', input:[]}, res, prefixes.chatgpt, {bridges, fetchImpl, log:() => {}}), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.model, 'claude-subscription/haiku');
  assert.match(res.body, /done/);
  assert.equal(await forwardForeign({model:'chatgpt-codex/gpt-6-astra'}, fakeRes(), prefixes.chatgpt, {bridges, fetchImpl, log:() => {}}), false);
  assert.equal(await forwardForeign({model:'kimi/k3'}, fakeRes(), prefixes.chatgpt, {bridges, fetchImpl, log:() => {}}), false);
});

test('scout and builder are told they run as Fusion and not to ask about the split', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { const body = JSON.parse(init.body); sent.push(body); return new FakeResponse(200, sse([body.model.startsWith('claude') ? call('ApplyPatch') : message('ok')])); };
  await handleFusion({model:'chatgpt-codex/fusion', stream:true, instructions:'cursor prompt', input:[], fusion:{scout:'claude-subscription/haiku', builder:'chatgpt-codex/gpt-6.2-astra'}}, fakeRes(), {bridges, fetchImpl, log:() => {}});
  assert.equal(sent.length, 2);
  for (const body of sent) { assert.ok(body.instructions.startsWith(fusionNote)); assert.ok(body.instructions.endsWith('cursor prompt')); }
});

test('each model only sees its own encrypted reasoning', async () => {
  const sent = [];
  const scoutReasoning = {type:'reasoning', id:'rs_scout', summary:[], encrypted_content:'LUNA'};
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    return new FakeResponse(200, body.model === 'chatgpt-codex/gpt-6-luna' ? sse([scoutReasoning, call('ReadFile')]) : sse([message('ok')]));
  };
  const res = fakeRes();
  const input = [{type:'message', role:'user', content:[{type:'input_text', text:'go'}]},
    {type:'reasoning', id:'rs_builder', summary:[], encrypted_content:'ASTRA'}, {type:'reasoning', id:'rs_old_scout', summary:[]}];
  await handleFusion({model:'chatgpt-codex/fusion', stream:true, input, fusion:{scout:'chatgpt-codex/gpt-6-luna', builder:'chatgpt-codex/gpt-6-astra'}}, res, {bridges, fetchImpl, log:() => {}});
  assert.ok(!sent[0].input.some(item => item.type === 'reasoning'), 'the scout gets no reasoning');
  assert.ok(res.body.includes('rs_scout') && !res.body.includes('LUNA'), 'the scout reasoning reaches Cursor without its encrypted content');
  sent.length = 0;
  const res2 = fakeRes();
  const fetch2 = async (url, init) => { const body = JSON.parse(init.body); sent.push(body); return new FakeResponse(200, body.model.endsWith('luna') ? sse([call('ApplyPatch')]) : sse([message('ok')])); };
  await handleFusion({model:'chatgpt-codex/fusion', stream:true, input, fusion:{scout:'chatgpt-codex/gpt-6-luna', builder:'chatgpt-codex/gpt-6-astra'}}, res2, {bridges, fetchImpl:fetch2, log:() => {}});
  assert.deepEqual(sent[1].input.filter(item => item.type === 'reasoning').map(item => item.id), ['rs_builder'], 'the builder keeps only its own');
  assert.equal(withoutEncryptedReasoning('event: x\ndata: {"type":"response.output_text.delta"}'), 'event: x\ndata: {"type":"response.output_text.delta"}');
});
