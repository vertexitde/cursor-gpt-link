// Patch the agent runtime on an SSH host.
//
// Since Cursor 3.22.9 a remote session runs the agent on the host, using the
// server's own copy of Cursor under ~/.cursor-server. The workbench patch stays
// on the client, but the runtime-side repairs have to be on the host: reasoning
// effort and Fast forwarding, the subagent model repair that lets an omitted
// Task model inherit the parent, the Explore subagent settings and the receiver
// for queued follow-ups.
//
// The three links share one manifest on the host and each adds its own
// provider; the first one to touch a file keeps the untouched copy beside it.
// Files are replaced by rename, so a connected session keeps its open copy
// until it reconnects.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const manifestName = '.cursor-links-runtime.json';
export const backupSuffix = '.cursor-links-original';
const relatives = ['extensions/cursor-agent-exec/dist/main.js', 'extensions/cursor-local-agent-runtime/dist/main.js'];

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const quote = value => "'" + String(value).replace(/'/g, `'\\''`) + "'";

// A POSIX host and a Windows host answer the same questions through different
// shells. Both sides move file contents as base64, so nothing depends on the
// line endings or the code page in between.
function posixShell(run) {
  return {
    kind:'posix', run,
    join: (dir, relative) => path.posix.join(dir, relative),
    serverDirs: () => run('ls -d ~/.cursor-server/bin/*/*/ 2>/dev/null || true')
      .split('\n').map(line => line.trim().replace(/\/$/, '')).filter(Boolean),
    read: file => Buffer.from(run(`base64 -w0 ${quote(file)}`), 'base64').toString('utf8'),
    exists: file => run(`test -e ${quote(file)} && echo yes || echo no`).trim() === 'yes',
    sha256: file => run(`sha256sum ${quote(file)}`).trim().split(/\s+/)[0],
    copyIfMissing: (from, to) => run(`test -f ${quote(to)} || cp ${quote(from)} ${quote(to)}`),
    remove: file => run(`rm -f ${quote(file)}`),
    anyManifest: name => run(`ls ~/.cursor-server/bin/*/*/${name} 2>/dev/null | head -1`).trim().length > 0,
    write(file, content) {
      const temporary = file + '.cursor-links-tmp';
      run(`base64 -d > ${quote(temporary)} && mv ${quote(temporary)} ${quote(file)}`, Buffer.from(content, 'utf8').toString('base64'));
    }
  };
}

// The default shell on a Windows host is cmd, and quoting through it is a trap,
// so every command travels as an encoded PowerShell script instead.
function windowsShell(run) {
  const ps = (script, input) => run(`powershell -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`, input);
  const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
  return {
    kind:'windows', run:ps,
    join: (dir, relative) => dir.replace(/[\\/]$/, '') + '\\' + relative.replace(/\//g, '\\'),
    serverDirs: () => ps(`$ErrorActionPreference='SilentlyContinue'
Get-ChildItem -Path "$env:USERPROFILE\\.cursor-server\\bin\\*\\*" -Directory | ForEach-Object { $_.FullName }`)
      .split('\n').map(line => line.trim()).filter(Boolean),
    read: file => Buffer.from(ps(`[Convert]::ToBase64String([IO.File]::ReadAllBytes(${literal(file)}))`).replace(/\s+/g, ''), 'base64').toString('utf8'),
    exists: file => ps(`if (Test-Path -LiteralPath ${literal(file)}) { 'yes' } else { 'no' }`).trim() === 'yes',
    sha256: file => ps(`(Get-FileHash -Algorithm SHA256 -LiteralPath ${literal(file)}).Hash.ToLower()`).trim(),
    copyIfMissing: (from, to) => ps(`if (-not (Test-Path -LiteralPath ${literal(to)})) { Copy-Item -LiteralPath ${literal(from)} -Destination ${literal(to)} }`),
    remove: file => ps(`Remove-Item -LiteralPath ${literal(file)} -Force -ErrorAction SilentlyContinue`),
    anyManifest: name => ps(`$ErrorActionPreference='SilentlyContinue'
(Get-ChildItem -Path "$env:USERPROFILE\\.cursor-server\\bin\\*\\*\\${name}" | Measure-Object).Count`).trim() !== '0',
    write(file, content) {
      const temporary = file + '.cursor-links-tmp';
      ps(`$in = [Console]::In.ReadToEnd()
[IO.File]::WriteAllBytes(${literal(temporary)}, [Convert]::FromBase64String($in))
Move-Item -LiteralPath ${literal(temporary)} -Destination ${literal(file)} -Force`, Buffer.from(content, 'utf8').toString('base64'));
    }
  };
}

function connect(host, {timeout = 10, quiet = false} = {}) {
  const run = (command, input) => execFileSync('ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=' + timeout, host, command],
    {input, encoding:'utf8', maxBuffer:256 * 1024 * 1024, windowsHide:true,
      // A probe talks to hosts that may not even be POSIX; their shell's
      // complaints are not the user's problem.
      stdio:['pipe', 'pipe', quiet ? 'ignore' : 'inherit']});
  try { if (run('uname -s').trim()) return posixShell(run); } catch { /* not POSIX */ }
  const windows = windowsShell(run);
  // A Windows host answers this; an unreachable one does not answer at all.
  try { windows.run('$PSVersionTable.PSVersion.Major'); }
  catch { throw new Error('not reachable, or the shell is neither POSIX nor PowerShell'); }
  return windows;
}

export function localCommit(appRoot = process.env.CURSOR_APP_ROOT ||
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local'), 'Programs/cursor/resources/app')) {
  return JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8')).commit;
}

// The host must run the build this client is patched for: the runtime anchors
// are read out of the bundle, but only this build has been reviewed.
export function serverDirectory(ssh, commit, override) {
  const dirs = ssh.serverDirs();
  const basename = dir => dir.replace(/[\\/]$/, '').split(/[\\/]/).pop();
  const matching = override ? [override] : dirs.filter(dir => basename(dir) === commit);
  return {dirs, dir:matching[0]};
}

function checkedPatch(source, patchRuntime) {
  const patched = patchRuntime(source);
  // Syntax check here, where node is at hand, before anything is written.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-links-'));
  const candidate = path.join(folder, 'candidate.mjs');
  fs.writeFileSync(candidate, patched);
  try { execFileSync(process.execPath, ['--check', candidate], {stdio:'pipe', windowsHide:true}); }
  finally { fs.rmSync(folder, {recursive:true, force:true}); }
  return patched;
}

export function installRemote({host, link, marker, patchRuntime, prefix, dir, check = false, log = console.log}) {
  const ssh = connect(host);
  const commit = localCommit();
  const {dirs, dir:serverDir} = serverDirectory(ssh, commit, dir);
  log(`host ${host}: ${dirs.length} server directories, ${serverDir ? 1 : 0} for the local build ${commit.slice(0, 7)}`);
  if (!serverDir) {
    for (const entry of dirs) log('  ' + entry);
    throw new Error('No server directory for this Cursor build. Open a remote window once, or pass --dir.');
  }
  const manifestPath = ssh.join(serverDir, manifestName);
  const manifest = ssh.exists(manifestPath) ? JSON.parse(ssh.read(manifestPath)) : {host, commit, links:[], files:[]};
  if (manifest.links.includes(link)) { log(`${link} is already installed on ${host}.`); return {changed:false, host}; }

  const pending = [];
  for (const relative of relatives) {
    const file = ssh.join(serverDir, relative);
    let current;
    try { current = ssh.read(file); }
    catch { log('absent on the host, skipped: ' + relative); continue; }
    if (current.includes(marker)) { log('already carries this provider, skipped: ' + relative); continue; }
    const patched = checkedPatch(current, patchRuntime);
    pending.push({path:file, relative, patched, currentHash:sha(current), patchedHash:sha(patched)});
    log(`prepared ${relative}: ${current.length} -> ${patched.length} bytes`);
  }
  if (!pending.length) { log('Nothing to do on ' + host + '.'); return {changed:false, host}; }
  if (check) { log(`${pending.length} file(s) would be patched on ${host}. Nothing was written.`); return {changed:false, host, wouldPatch:pending.length}; }

  for (const entry of pending) {
    const backup = entry.path + backupSuffix;
    // Only the first link stores the untouched copy; later ones build on it.
    ssh.copyIfMissing(entry.path, backup);
    ssh.write(entry.path, entry.patched);
    if (ssh.sha256(entry.path) !== entry.patchedHash) throw new Error('The host holds different content after writing: ' + entry.path);
    const known = manifest.files.find(f => f.path === entry.path);
    if (known) known.patchedHash = entry.patchedHash;
    else manifest.files.push({path:entry.path, backup, originalHash:entry.currentHash, patchedHash:entry.patchedHash});
    log('patched ' + entry.relative);
  }
  manifest.links.push(link);
  manifest.commit = commit;
  manifest.installedAt = new Date().toISOString();
  ssh.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  log(`Runtime patch installed on ${host} for ${prefix}. Reconnect the remote window to load it.`);
  return {changed:true, host};
}

export function restoreRemote({host, link, dir, log = console.log}) {
  const ssh = connect(host);
  const {dir:serverDir} = serverDirectory(ssh, localCommit(), dir);
  if (!serverDir) { log(`No server directory for this build on ${host}.`); return {changed:false, host}; }
  const manifestPath = ssh.join(serverDir, manifestName);
  if (!ssh.exists(manifestPath)) { log(`Nothing installed on ${host}.`); return {changed:false, host}; }
  const manifest = JSON.parse(ssh.read(manifestPath));
  if (!manifest.links.includes(link)) { log(`${link} is not installed on ${host}.`); return {changed:false, host}; }
  if (manifest.links.length > 1) throw new Error('Remove the other links first: ' + manifest.links.filter(l => l !== link).join(', '));
  for (const entry of manifest.files) {
    if (sha(ssh.read(entry.path)) !== entry.patchedHash) throw new Error('File changed since the patch, restore stopped: ' + entry.path);
    ssh.write(entry.path, ssh.read(entry.backup));
    ssh.remove(entry.backup);
    log('restored ' + entry.path);
  }
  ssh.remove(manifestPath);
  log(`Runtime patch removed from ${host}. Reconnect the remote window.`);
  return {changed:true, host};
}

// After a local install, carry the patch to hosts that already have it. A host
// that was never patched is left alone: installing on a machine by itself is
// the user's call, not a side effect of patching this client.
export function syncKnownHosts({hosts, link, marker, patchRuntime, prefix, log = console.log}) {
  const results = [];
  for (const host of hosts) {
    let known = false, serverDir;
    try {
      // Quiet probe: unreachable hosts, hosts without Cursor and hosts whose
      // shell is not POSIX all end up here and are simply passed over.
      const probe = connect(host, {timeout:5, quiet:true});
      ({dir:serverDir} = serverDirectory(probe, localCommit()));
      // Known means: some build on this host carries our manifest.
      known = probe.anyManifest(manifestName);
    } catch { continue; }
    if (!known) continue;
    if (!serverDir) { log(`remote runtime: ${host} has no server for this build yet, skipped`); results.push({host, changed:false}); continue; }
    try { results.push(installRemote({host, link, marker, patchRuntime, prefix, log})); }
    catch (error) { log(`remote runtime: ${host} failed, ${error.message}`); results.push({host, changed:false, error:error.message}); }
  }
  return results;
}
