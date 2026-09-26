import test from 'node:test';
import assert from 'node:assert/strict';
import {usageWindows, usageLabel, usagePercent, usageLabelHelpersSrc, usageTrailingArgument} from '../src/usage-label.mjs';

// The two shapes both bridges actually return, taken from live responses.
const chatgpt = {planType:'prolite', allowed:true, primary:{usedPercent:23, windowSeconds:604800}, secondary:null};
const claude = {planType:'Max', windows:[
  {id:'session', label:'5-hour session', usedPercent:24},
  {id:'week', label:'Weekly (all models)', usedPercent:63},
  {id:'fable', label:'Weekly (Fable)', usedPercent:0}]};

test('the window closest to its limit is the one shown', () => {
  assert.equal(usageLabel(usageWindows(chatgpt)).text, '23% used');
  assert.equal(usageLabel(usageWindows(claude)).text, '63% used', 'the week is the tighter constraint here');
  assert.equal(usageLabel(usageWindows({windows:[{label:'5-hour session', usedPercent:80}, {label:'Weekly', usedPercent:12}]})).text,
    '80% used', 'the short window wins when it is the tighter one');
  assert.equal(usageLabel(usageWindows({windows:[{label:'5-hour session', usedPercent:5}, {label:'Weekly', usedPercent:100}]})).text,
    '100% used', 'a full week is reported even when the session is nearly untouched');
});

test('every window is named in the tooltip', () => {
  assert.equal(usageLabel(usageWindows(claude)).title,
    '5-hour session: 24% used · Weekly (all models): 63% used · Weekly (Fable): 0% used');
  assert.equal(usageLabel(usageWindows(chatgpt)).title, 'Weekly: 23% used');
  assert.equal(usageLabel(usageWindows({primary:{usedPercent:4, windowSeconds:18000}})).title, '5-hour: 4% used');
});

test('nothing to report stays invisible', () => {
  for (const data of [{}, {windows:[]}, {primary:null, secondary:null}, {windows:[{label:'x'}]}, undefined])
    assert.equal(usageLabel(usageWindows(data)), undefined);
});

test('a started window never rounds down to zero, a full one stays at 100', () => {
  assert.equal(usagePercent(0), 0);
  assert.equal(usagePercent(0.2), 1);
  assert.equal(usagePercent(23.4), 23);
  assert.equal(usagePercent(140), 100);
  assert.equal(usagePercent(-5), 0);
});

// The helpers are shipped as source and run inside Cursor, so run them the
// same way here: evaluate the generated text with a stub fetch and jsx.
function runtime(response) {
  const calls = [];
  const globals = {Date, AbortSignal:{timeout:() => undefined}, console,
    fetch:(url, options) => { calls.push({url, options}); return Promise.resolve(response()); }};
  const scope = {};
  const factory = new Function(...Object.keys(globals), 'globalThis',
    usageLabelHelpersSrc + '\nreturn {__subscriptionUsageTrailing,__subscriptionUsageRead};');
  return {calls, api:factory(...Object.values(globals), scope)};
}
const ok = body => ({ok:true, json:() => Promise.resolve(body)});
const jsx = (type, props) => ({type, props});

test('the section asks the bridge once and then shows what came back', async () => {
  const {calls, api} = runtime(() => ok(claude));
  assert.equal(api.__subscriptionUsageTrailing('claude', jsx, 'http://127.0.0.1:43188', 'key'), undefined,
    'nothing is rendered before an answer is in');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:43188/usage');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer key');
  await new Promise(resolve => setImmediate(resolve));
  const rendered = api.__subscriptionUsageTrailing('claude', jsx, 'http://127.0.0.1:43188', 'key');
  assert.equal(rendered.props.children, '63% used');
  assert.equal(rendered.props.title, usageLabel(usageWindows(claude)).title);
  assert.equal(rendered.props.className, 'ui-4b2ntj ui-2lah0s');
  assert.equal(calls.length, 1, 'a second render within the minute does not ask again');
});

test('a link that is not installed and a bridge that cannot answer stay silent', async () => {
  const absent = runtime(() => ok(claude));
  assert.equal(absent.api.__subscriptionUsageTrailing('claude', jsx, '', ''), undefined);
  assert.equal(absent.calls.length, 0, 'no bridge address, no request');

  const failing = runtime(() => ({ok:false, json:() => Promise.reject(new Error('nope'))}));
  assert.equal(failing.api.__subscriptionUsageTrailing('chatgpt', jsx, 'http://127.0.0.1:43187', 'key'), undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failing.api.__subscriptionUsageTrailing('chatgpt', jsx, 'http://127.0.0.1:43187', 'key'), undefined);
});

test('two links prepending the same helpers stay valid', async () => {
  // Every link ships this text, so the second copy must overwrite the first
  // instead of colliding with it. Declarations would be a syntax error here.
  const {execFileSync} = await import('node:child_process');
  const [fs, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-gpt-link-duplicate-'));
  const file = path.join(folder, 'both.mjs');
  fs.writeFileSync(file, usageLabelHelpersSrc + '\n' + usageLabelHelpersSrc +
    '\nexport const ready = typeof __subscriptionUsageTrailing === "function";');
  try {
    execFileSync(process.execPath, ['--check', file], {stdio:'pipe', windowsHide:true});
    const loaded = await import('file://' + file.replace(/\\/g, '/'));
    assert.equal(loaded.ready, true);
  } finally { fs.rmSync(folder, {recursive:true, force:true}); }
});

test('the injected expression reads the bridge constants defensively', () => {
  const argument = usageTrailingArgument('chatgpt', 'tL', '__chatgptBridgeBase', '__chatgptBridgeKey');
  assert.match(argument, /^__subscriptionUsageTrailing\("chatgpt",tL,/);
  // An uninstalled companion leaves its constants undeclared, and rendering
  // must not throw a ReferenceError over that.
  const evaluate = new Function('tL', 'return ' + argument.replace('__subscriptionUsageTrailing', '(function(name,jsx,base,key){return {name,base,key}})'));
  assert.deepEqual(evaluate(() => 'jsx'), {name:'chatgpt', base:'', key:''});
});
