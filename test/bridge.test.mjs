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
const {mergeCatalog, pickerModel, normalizeRequest, handle, readModels} = await import('../src/bridge.mjs');
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
    assert.equal((await fetch(base + '/picker-models', {headers:{Authorization:'Bearer synthetic-test-key', Origin:'https://example.org'}})).status, 403);
    assert.equal((await fetch(base + '/picker-models', {headers:{Authorization:'Bearer synthetic-test-key'}})).status, 200);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
