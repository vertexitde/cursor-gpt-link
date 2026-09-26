// Patch this link's runtime repairs into the copy of Cursor on an SSH host.
//
//   node scripts/install-remote.mjs <host> [--check] [--restore] [--dir <server dir>]
//   node scripts/install-remote.mjs --all  [--check]
//
// The host is an entry from ~/.ssh/config or any ssh target. Nothing is written
// with --check. --all walks the hosts in the managed ssh block and takes every
// one that already runs a server for this Cursor build; a host you have not
// connected to since the update has nothing to patch yet. See
// src/remote-runtime.mjs for what happens on the host.
import fs from 'node:fs';
import {installRemote, restoreRemote} from '../src/remote-runtime.mjs';
import {readBlock, sshConfigPath} from '../src/ssh-forwarding.mjs';
import {link, marker, prefix, patchRuntime} from '../src/runtime-link.mjs';

const args = process.argv.slice(2);
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : undefined;
const check = args.includes('--check');
const named = args.find(a => !a.startsWith('--') && a !== dir);

if (args.includes('--all')) {
  const hosts = readBlock(fs.readFileSync(sshConfigPath(), 'utf8')).hosts;
  console.log(`${hosts.length} host(s) in the managed ssh block`);
  const done = [], skipped = [];
  for (const host of hosts) {
    try { done.push({host, ...installRemote({host, link, marker, prefix, patchRuntime, check})}); }
    catch (error) { skipped.push(`${host}: ${error.message}`); }
  }
  for (const entry of skipped) console.log('skipped ' + entry);
  console.log(`\npatched ${done.filter(r => r.changed).length}, unchanged ${done.filter(r => !r.changed).length}, skipped ${skipped.length}`);
} else if (!named) {
  throw new Error('Usage: node scripts/install-remote.mjs <ssh host> [--check] [--restore] | --all');
} else if (args.includes('--restore')) {
  restoreRemote({host:named, link, dir});
} else {
  installRemote({host:named, link, marker, prefix, patchRuntime, dir, check});
}
