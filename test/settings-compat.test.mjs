import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsParts} from '../src/settings-compat.mjs';

test('before 3.32 the cards keep the native card and rows', () => {
  assert.deepEqual(settingsParts('chatgpt', 'J', {card:'Card', zs:'Rows'}), {card:'Card', zs:'Rows', adapter:''});
});

test('from 3.32 the adapter draws the older card shape with the new parts', () => {
  const parts = settingsParts('chatgpt', 'J', {cardNs:'Section', rowNs:'Row'});
  assert.equal(parts.card, '__chatgptSettingsCard');
  assert.equal(parts.zs, '__chatgptSettingsRows');
  const h = (type, props, key) => ({type, props, key});
  const ns = name => new Proxy({}, {get:(_, part) => name + '.' + String(part)});
  const {card, rows} = new Function('J', 'Section', 'Row', parts.adapter + 'return {card:__chatgptSettingsCard, rows:__chatgptSettingsRows};')(h, ns('Section'), ns('Row'));
  const drawn = card({title:'ChatGPT Subscription', description:'Usage', children:'ROWS'});
  assert.equal(drawn.type, 'Section.Root');
  const [header, body] = drawn.props.children;
  assert.equal(header.type, 'Section.Header');
  assert.deepEqual(header.props.children.map(c => c && [c.type, c.props.children]), [['Section.Title', 'ChatGPT Subscription'], ['Section.Description', 'Usage']]);
  assert.equal(body, 'ROWS');
  assert.equal(card({title:'T', children:null}).props.children[0].props.children[1], null, 'no description, no description part');
  const group = rows.Root({accessibleLabel:'usage', children:['a']});
  assert.deepEqual([group.type, group.props.variant, group.props.accessibleLabel], ['Section.Group', 'tinted', 'usage']);
  const entry = rows.Entry({label:'Plan', children:'Pro', layout:'row'});
  assert.equal(entry.type, 'Row.Root');
  assert.equal(entry.props.layout, 'row');
  assert.deepEqual(entry.props.children.map(c => c.type), ['Row.Content', 'Row.Control']);
  assert.equal(entry.props.children[0].props.children.props.children, 'Plan');
  assert.equal(entry.props.children[1].props.children, 'Pro');
  assert.equal(rows.Preview, 'Section.Preview');
});
