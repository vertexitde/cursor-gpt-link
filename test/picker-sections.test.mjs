import test from 'node:test';
import assert from 'node:assert/strict';
import {withSubscriptionPickerSections, patchPickerSections} from '../src/picker-sections.mjs';

test('picker sections keep ChatGPT and Claude out of Cursor Models', () => {
  const grouped = withSubscriptionPickerSections({
    leading: [{name: 'auto'}],
    promoted: [{name: 'chatgpt-codex/gpt-6-astra'}, {name: 'composer-2.5'}],
    others: [{name: 'claude-subscription/opus'}, {name: 'grok-4.6'}]
  });
  assert.deepEqual(grouped.promoted.map(m => m.name), ['composer-2.5']);
  assert.deepEqual(grouped.others.map(m => m.name), ['grok-4.6']);
  assert.deepEqual(grouped.chatgpt.map(m => m.name), ['chatgpt-codex/gpt-6-astra']);
  assert.deepEqual(grouped.claude.map(m => m.name), ['claude-subscription/opus']);
});

test('picker section patch is idempotent', () => {
  const replaceOnce = (source, from, to) => {
    if (source.split(from).length !== 2) throw new Error(from);
    return source.replace(from, to);
  };
  const groupReturn = 'return c.mergeLeadingIntoPromotedSection===!0?{leading:[],promoted:[...re,...J],others:ce}:{leading:re,promoted:J,others:ce}';
  const promotedAnchor = 'WP(fmt,{models:B.promoted,title:c?.promotedSectionTitle';
  const source = patchPickerSections(groupReturn + promotedAnchor, replaceOnce, {
    groupReturn, promotedAnchor, modelsVar: 'B', jsx: 'WP', fmt: 'fmt', renderModel: 'x'
  });
  assert.match(source, /title:"ChatGPT Subscription"/);
  assert.match(source, /title:"Claude Subscription"/);
  const twice = patchPickerSections(source, replaceOnce, {
    groupReturn, promotedAnchor, modelsVar: 'B', jsx: 'WP', fmt: 'fmt', renderModel: 'x'
  });
  assert.equal(twice, source);
});
