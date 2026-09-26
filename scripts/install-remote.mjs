// Patch this link's runtime repairs into the copy of Cursor on an SSH host.
//
//   node scripts/install-remote.mjs <host> [--check] [--restore] [--dir <server dir>]
//
// The host is an entry from ~/.ssh/config or any ssh target. Nothing is written
// with --check. See src/remote-runtime.mjs for what happens on the host.
import {installRemote, restoreRemote} from '../src/remote-runtime.mjs';
import {link, marker, prefix, patchRuntime} from '../src/runtime-link.mjs';

const args = process.argv.slice(2);
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : undefined;
const host = args.find(a => !a.startsWith('--') && a !== dir);
if (!host) throw new Error('Usage: node scripts/install-remote.mjs <ssh host> [--check] [--restore]');

if (args.includes('--restore')) restoreRemote({host, link, dir});
else installRemote({host, link, marker, prefix, patchRuntime, dir, check:args.includes('--check')});
