import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Synthetic data only. Tests never use real authentication or call OpenAI.
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-gpt-link-test-'));
process.env.CURSOR_GPT_LINK_HOME = state;
process.env.CODEX_HOME = path.join(state, 'codex');
fs.mkdirSync(process.env.CODEX_HOME);
fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({key:'synthetic-test-key'}));
fs.writeFileSync(path.join(process.env.CODEX_HOME, 'auth.json'), JSON.stringify({tokens:{access_token:'synthetic-token', account_id:'synthetic-account'}}));
const {mergeCatalog, pickerModel, normalizeRequest, handle, readModels, mapUpstreamError, fetchUsage} = await import('../src/bridge.mjs');
const model = {slug:'test-model', display_name:'Test <model>', description:'Synthetic fixture',
  visibility:'list', context_window:1000, input_modalities:['text'], default_reasoning_level:'medium',
  supported_reasoning_levels:[{effort:'low'}, {effort:'medium'}, {effort:'high'}, {effort:'xhigh'}, {effort:'max'}],
  additional_speed_tiers:['fast']};

test.after(() => fs.rmSync(state, {recursive:true, force:true}));

test('partial refresh retains known models and explicit hiding removes them', () => {
  assert.deepEqual(mergeCatalog([model], []), [model]);
  assert.deepEqual(mergeCatalog([model], [{slug:model.slug, visibility:'hide'}]), []);
  const refreshed = mergeCatalog([model], [{...model, additional_speed_tiers:undefined}]);
  assert.deepEqual(refreshed[0].additional_speed_tiers, ['fast']);
});

test('all reasoning levels have independent normal and Fast variants', () => {
  const picker = pickerModel(model);
  assert.equal(picker.variants.length, 10);
  assert.equal(new Set(picker.variants.map(v => v.variantStringRepresentation)).size, 10);
  assert.equal(picker.variants.filter(v => v.isDefaultNonMaxConfig).length, 1);
  assert.equal(picker.variants.find(v => v.isDefaultNonMaxConfig).parameterValues[1].value, 'false');
  assert.ok(picker.variants.every(v => !v.displayName.includes('<model>')));
  const normal = pickerModel({...model, additional_speed_tiers:[]});
  assert.equal(normal.variants.length, 5);
  assert.equal(normal.parameterDefinitions.some(p => p.id === 'fast'), false);
});

test('OAuth model labels use the icon without a ChatGPT suffix and escape model HTML', () => {
  const picker = pickerModel(model);
  assert.equal(picker.clientDisplayName, model.display_name);
  assert.equal(picker.inputboxShortModelName, model.display_name);
  for (const variant of picker.variants) {
    assert.ok(variant.displayName.startsWith('<svg'));
    assert.ok(variant.displayName.includes('Test &lt;model&gt;'));
    assert.equal(variant.displayName.includes('ChatGPT'), false);
    assert.equal(variant.displayNameOutsidePicker.includes('ChatGPT'), false);
  }
});

test('quota errors stop Cursor retries and retain the bounded service message', () => {
  const usage = mapUpstreamError(429, {detail:"You've hit your usage limit. Try again later."});
  assert.equal(usage.status, 402);
  assert.equal(usage.error.code, 'insufficient_quota');
  assert.match(usage.error.message, /usage limit/);
  assert.equal(mapUpstreamError(429, {error:{message:'Too many requests'}}).status, 402);
  assert.equal(mapUpstreamError(400, {error:{message:'Bad request'}}).status, 400);
  assert.equal(mapUpstreamError(500, {error:{message:'a'.repeat(2000)}}).error.message.length, 1200);
  assert.equal(mapUpstreamError(500, {detail:{unexpected:'value'}}).error.message, 'ChatGPT request rejected');
});

test('usage retrieval maps subscription windows without exposing account credentials', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return Response.json({plan_type:'test-plan', rate_limit:{allowed:true, limit_reached:false,
      primary_window:{used_percent:37, limit_window_seconds:18000, reset_after_seconds:300, reset_at:1900000000}, secondary_window:null}});
  };
  try {
    const usage = await fetchUsage();
    assert.equal(usage.planType, 'test-plan');
    assert.equal(usage.primary.usedPercent, 37);
    assert.equal(usage.primary.windowSeconds, 18000);
    assert.equal(usage.secondary, null);
    assert.equal(JSON.stringify(usage).includes('synthetic-token'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('normalization preserves tools and reasoning, translates Fast and gathers instructions', () => {
  const tool = {type:'function', name:'add', parameters:{type:'object'}};
  const request = normalizeRequest({model:'chatgpt-codex/test-model', input:[
    {role:'system', content:'System instruction'}, {role:'user', content:'Hello'}],
    tools:[tool], reasoning:{effort:'max'}, service_tier:'priority', max_output_tokens:100}, [model]);
  assert.equal(request.model, 'test-model');
  assert.equal(request.instructions, 'System instruction');
  assert.deepEqual(request.tools, [tool]);
  assert.equal(request.input.length, 1);
  assert.equal(request.reasoning.effort, 'max');
  assert.equal(request.service_tier, 'priority');
  assert.equal(request.max_output_tokens, undefined);
  assert.equal(request.stream, true);
  assert.equal(request.store, false);
  const ordinary = normalizeRequest({model:'chatgpt-codex/test-model', input:'Hello'}, [model]);
  assert.equal(ordinary.service_tier, undefined);
  assert.equal(ordinary.reasoning.effort, 'medium');
});

test('unsupported model, reasoning and speed are rejected', () => {
  const base = {model:'chatgpt-codex/test-model', input:'Hello'};
  assert.throws(() => normalizeRequest({...base, model:'other'}, [model]), /Only ChatGPT/);
  assert.throws(() => normalizeRequest({...base, reasoning:{effort:'ultra'}}, [model]), /Reasoning/);
  assert.throws(() => normalizeRequest({...base, service_tier:'fast'}, [model]), /speed/);
  assert.throws(() => normalizeRequest({...base, service_tier:'priority'}, [{...model, additional_speed_tiers:[]}]), /unavailable/);
});

test('catalog persistence is partitioned by account', () => {
  const catalog = path.join(process.env.CODEX_HOME, 'models_cache.json');
  fs.writeFileSync(catalog, JSON.stringify({models:[model]}));
  assert.equal(readModels().length, 1);
  fs.writeFileSync(catalog, JSON.stringify({models:[]}));
  assert.equal(readModels().length, 1);
  fs.writeFileSync(path.join(process.env.CODEX_HOME, 'auth.json'), JSON.stringify({tokens:{access_token:'synthetic-token', account_id:'other-synthetic-account'}}));
  assert.equal(readModels().length, 0);
});

test('loopback endpoints require the local key and reject browser origins', async () => {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/picker-models')).status, 401);
    assert.equal((await fetch(base + '/usage')).status, 401);
    assert.equal((await fetch(base + '/picker-models', {headers:{Authorization:'Bearer synthetic-test-key', Origin:'https://example.org'}})).status, 403);
    assert.equal((await fetch(base + '/picker-models', {headers:{Authorization:'Bearer synthetic-test-key'}})).status, 200);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


import {png,pdf} from '../scripts/attachment-fixtures.mjs';
test('image and PDF inputs retain their original bytes and conversation positions',()=>{
 const visual={...model,input_modalities:['text','image']};
 const input=[{role:'user',content:[{type:'input_text',text:'Read the attachments'},
   {type:'input_image',image_url:'data:image/png;base64,'+png().toString('base64')},
   {type:'input_file',filename:'sample.pdf',file_data:'data:application/pdf;base64,'+pdf().toString('base64')}]},
   {type:'function_call',call_id:'test-attachment-call',name:'test_tool',arguments:'{}'},
   {type:'function_call_output',call_id:'test-attachment-call',output:'Finished'}];
 const snapshot=structuredClone(input);
 const request=normalizeRequest({model:'chatgpt-codex/'+model.slug,input},[visual]);
 assert.deepEqual(request.input,snapshot);assert.deepEqual(input,snapshot);
 assert.equal(pickerModel(visual).supportsImages,true);
 assert.equal(pickerModel(model).supportsImages,false);
});
