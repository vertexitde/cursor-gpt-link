import test from 'node:test';
import assert from 'node:assert/strict';
import {addForwarding, removeForwarding, readBlock, declaredHosts, cursorRemoteHosts,
  decodeRemoteAuthority, resolveHosts, blockStart, blockEnd} from '../src/ssh-forwarding.mjs';

const config = `Host vertex-internal
    HostName 10.0.0.2
    User eric

Host moonlightv-web-user
    HostName host.example
    User web
`;

test('decodes the hex authority Cursor stores', () => {
  const hex = Buffer.from(JSON.stringify({hostName:'moonlightv-web-user'})).toString('hex');
  assert.equal(decodeRemoteAuthority(hex), 'moonlightv-web-user');
  assert.equal(decodeRemoteAuthority(Buffer.from('{"hostName":"srv","user":"root"}').toString('hex')), 'srv');
  assert.equal(decodeRemoteAuthority('plain-host'), 'plain-host');
  assert.equal(decodeRemoteAuthority(''), undefined);
});

test('reads the hosts opened in Cursor, including user@host targets', () => {
  const hex = value => Buffer.from(JSON.stringify(value)).toString('hex');
  const storage = JSON.stringify({a:`vscode-remote://ssh-remote%2B${hex({hostName:'moonlightv-web-user'})}/srv/app`,
    b:`ssh-remote+${hex({hostName:'root@1.2.3.4'})}`, c:`ssh-remote+${hex({hostName:'ssh root@5.6.7.8'})}`});
  assert.deepEqual(cursorRemoteHosts(storage).sort(), ['1.2.3.4', '5.6.7.8', 'moonlightv-web-user']);
});

test('lists declared host aliases and ignores patterns', () => {
  assert.deepEqual(declaredHosts(config + '\nHost *\n    ServerAliveInterval 30\n'),
    ['vertex-internal', 'moonlightv-web-user']);
});

test('adds a forward for one link and keeps the rest of the file', () => {
  const {text, hosts} = addForwarding(config, {owner:'cursor-gpt-link', port:43187, hosts:['vertex-internal']});
  assert.deepEqual(hosts, ['vertex-internal']);
  assert.ok(text.startsWith(config.trimEnd()), 'existing configuration is preserved');
  assert.ok(text.includes('RemoteForward 127.0.0.1:43187 127.0.0.1:43187'));
  assert.equal(text.split('Host vertex-internal').length - 1, 2, 'a second Host block is appended, the first is untouched');
  assert.equal(readBlock(text).owners['cursor-gpt-link'], 43187);
});

test('three links share one block and a removal keeps the others', () => {
  let text = config;
  for (const [owner, port] of [['cursor-gpt-link', 43187], ['cursor-claude-link', 43188], ['cursor-mercury-link', 43189]])
    ({text} = addForwarding(text, {owner, port, hosts:['vertex-internal', 'moonlightv-web-user']}));
  assert.equal(text.split(blockStart).length - 1, 1, 'exactly one managed block');
  assert.equal(text.split('RemoteForward').length - 1, 6, 'three ports for two hosts');
  ({text} = removeForwarding(text, {owner:'cursor-claude-link'}));
  assert.ok(!text.includes('43188'));
  assert.ok(text.includes('43187') && text.includes('43189'));
  for (const owner of ['cursor-gpt-link', 'cursor-mercury-link']) ({text} = removeForwarding(text, {owner}));
  assert.ok(!text.includes(blockStart) && !text.includes(blockEnd), 'the block disappears with the last link');
  assert.equal(text.trimEnd(), config.trimEnd(), 'the file is left as it was');
});

test('adding twice changes nothing', () => {
  const once = addForwarding(config, {owner:'cursor-gpt-link', port:43187, hosts:['vertex-internal']}).text;
  const twice = addForwarding(once, {owner:'cursor-gpt-link', port:43187, hosts:['vertex-internal']}).text;
  assert.equal(twice, once);
});

test('removing a link that never wrote anything leaves the file alone', () => {
  assert.equal(removeForwarding(config, {owner:'cursor-gpt-link'}).text, config);
});

test('only hosts that are both declared and used by Cursor are configured', () => {
  const hex = value => Buffer.from(JSON.stringify(value)).toString('hex');
  const storage = JSON.stringify({a:`ssh-remote+${hex({hostName:'moonlightv-web-user'})}`, b:`ssh-remote+${hex({hostName:'build-box'})}`});
  // build-box was opened in Cursor but is not in the file; vertex-internal is
  // in the file but was never opened. Neither gets a forward.
  assert.deepEqual(resolveHosts({configText:config, storageText:storage}).hosts, ['moonlightv-web-user']);
  assert.deepEqual(resolveHosts({configText:config, storageText:'{}'}).hosts, []);
});

test('an explicit host list wins and reports unknown entries', () => {
  const resolved = resolveHosts({configText:config, storageText:'{}', requested:['vertex-internal', 'not-in-config']});
  assert.deepEqual(resolved.hosts, ['vertex-internal', 'not-in-config']);
  assert.deepEqual(resolved.unknown, ['not-in-config']);
});

test('a block without its end marker is refused instead of rewritten', () => {
  assert.throws(() => readBlock(config + '\n' + blockStart + '\nHost x\n'), /no end marker/);
});
