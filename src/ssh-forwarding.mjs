// From Cursor 3.22.9 a remote session runs the agent on the SSH host, where the
// workspace actually is. The bridge listens on the client's loopback, so the
// host needs an ssh reverse forward to reach it. These helpers keep one managed
// block in ~/.ssh/config; the three links share the block and each owns the
// line for its own port.
//
// Everything here is a pure function over the configuration text, so the same
// code is exercised by the unit tests and by the installers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const blockStart = '# >>> cursor subscription links: bridge forwarding >>>';
export const blockEnd = '# <<< cursor subscription links: bridge forwarding <<<';
const ownersPrefix = '# owners: ';
const note = '# Managed automatically. Remove it with the links\' restore script.';

export function sshConfigPath(home = os.homedir()) {
  return path.join(home, '.ssh', 'config');
}

export function cursorStoragePath(env = process.env) {
  const base = env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming');
  return path.join(base, 'Cursor/User/globalStorage/storage.json');
}

// Cursor stores a remote authority as ssh-remote+<hex of {"hostName":…}>.
export function decodeRemoteAuthority(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let text = value;
  if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
    try { text = Buffer.from(value, 'hex').toString('utf8'); } catch { return undefined; }
  }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.hostName === 'string' && parsed.hostName.length > 0) return parsed.hostName.trim();
    } catch { return undefined; }
    return undefined;
  }
  return text.trim() || undefined;
}

// The hosts opened in Cursor, newest first is not knowable here, so return all.
export function cursorRemoteHosts(storageText) {
  const hosts = new Set();
  for (const match of String(storageText ?? '').matchAll(/ssh-remote(?:%2B|\+)([0-9A-Za-z._%+-]+)/g)) {
    const decoded = decodeRemoteAuthority(decodeURIComponent(match[1]));
    if (!decoded) continue;
    // "ssh root@host" and "user@host" both target the host entry.
    const host = decoded.replace(/^ssh\s+/i, '').split('@').pop().trim();
    if (host) hosts.add(host);
  }
  return [...hosts];
}

// Host aliases declared outside our block: those are the ones a forward can be
// attached to without inventing a new target.
export function declaredHosts(configText) {
  const hosts = new Set();
  for (const line of stripBlock(String(configText ?? '')).split('\n')) {
    const match = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (!match) continue;
    for (const pattern of match[1].split(/\s+/)) {
      if (!pattern || /[*?!]/.test(pattern)) continue;
      hosts.add(pattern);
    }
  }
  return [...hosts];
}

function stripBlock(text) {
  const start = text.indexOf(blockStart);
  if (start < 0) return text;
  const end = text.indexOf(blockEnd, start);
  if (end < 0) throw new Error('The managed ssh block in ~/.ssh/config has no end marker; fix it by hand.');
  return text.slice(0, start) + text.slice(end + blockEnd.length);
}

export function readBlock(configText) {
  const text = String(configText ?? '');
  const start = text.indexOf(blockStart);
  if (start < 0) return {owners:{}, hosts:[]};
  const end = text.indexOf(blockEnd, start);
  if (end < 0) throw new Error('The managed ssh block in ~/.ssh/config has no end marker; fix it by hand.');
  const body = text.slice(start + blockStart.length, end);
  const owners = {};
  const ownerLine = body.split('\n').find(line => line.startsWith(ownersPrefix));
  for (const entry of (ownerLine?.slice(ownersPrefix.length) ?? '').trim().split(/\s+/)) {
    const [name, port] = entry.split('=');
    if (name && /^\d+$/.test(port ?? '')) owners[name] = Number(port);
  }
  const hosts = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (match) for (const pattern of match[1].split(/\s+/)) if (pattern) hosts.push(pattern);
  }
  return {owners, hosts:[...new Set(hosts)]};
}

export function renderBlock({owners, hosts}) {
  const ports = [...new Set(Object.values(owners))].sort((a, b) => a - b);
  if (!ports.length || !hosts.length) return '';
  const names = Object.entries(owners).sort(([a], [b]) => a.localeCompare(b)).map(([name, port]) => `${name}=${port}`);
  const lines = [blockStart, note, ownersPrefix + names.join(' ')];
  for (const host of hosts) {
    lines.push(`Host ${host}`);
    for (const port of ports) lines.push(`    RemoteForward 127.0.0.1:${port} 127.0.0.1:${port}`);
  }
  lines.push(blockEnd);
  return lines.join('\n');
}

function writeBlock(configText, block) {
  const text = String(configText ?? '');
  const start = text.indexOf(blockStart);
  if (start < 0) {
    if (!block) return text;
    const separator = text.length === 0 || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    return text + separator + block + '\n';
  }
  const end = text.indexOf(blockEnd, start);
  if (end < 0) throw new Error('The managed ssh block in ~/.ssh/config has no end marker; fix it by hand.');
  const before = text.slice(0, start), after = text.slice(end + blockEnd.length).replace(/^\n/, '');
  if (!block) return (before.replace(/\n+$/, '\n') + after).replace(/^\n+/, '');
  return before + block + '\n' + after;
}

// Add this link's port for the given hosts. Hosts already in the block stay.
export function addForwarding(configText, {owner, port, hosts}) {
  const current = readBlock(configText);
  const owners = {...current.owners, [owner]:port};
  const merged = [...new Set([...current.hosts, ...hosts])].sort();
  const block = renderBlock({owners, hosts:merged});
  return {text:writeBlock(configText, block), owners, hosts:merged};
}

// Drop this link's port. The block disappears once no link is left.
export function removeForwarding(configText, {owner}) {
  const current = readBlock(configText);
  if (!(owner in current.owners)) return {text:String(configText ?? ''), owners:current.owners, hosts:current.hosts};
  const owners = {...current.owners};
  delete owners[owner];
  const hosts = Object.keys(owners).length ? current.hosts : [];
  return {text:writeBlock(configText, renderBlock({owners, hosts})), owners, hosts};
}

// Which hosts to configure: the ones opened in Cursor that the user has also
// declared in ~/.ssh/config. Anything else would need a new Host entry, and
// guessing one could redirect traffic the user did not mean to touch.
export function resolveHosts({configText, storageText, requested}) {
  const declared = declaredHosts(configText);
  if (requested?.length) {
    const unknown = requested.filter(host => !declared.includes(host));
    return {hosts:requested, declared, unknown};
  }
  const used = cursorRemoteHosts(storageText);
  return {hosts:declared.filter(host => used.includes(host)).sort(), declared, unknown:[]};
}

export function applyToDisk({owner, port, hosts, configPath = sshConfigPath(), storagePath = cursorStoragePath(), remove = false}) {
  const existed = fs.existsSync(configPath);
  const configText = existed ? fs.readFileSync(configPath, 'utf8') : '';
  const storageText = fs.existsSync(storagePath) ? fs.readFileSync(storagePath, 'utf8') : '';
  const resolved = remove ? {hosts:[], declared:[], unknown:[]} : resolveHosts({configText, storageText, requested:hosts});
  if (!remove && resolved.hosts.length === 0) return {changed:false, hosts:[], reason:'no matching host in ~/.ssh/config'};
  const result = remove ? removeForwarding(configText, {owner}) : addForwarding(configText, {owner, port, hosts:resolved.hosts});
  if (result.text === configText) return {changed:false, hosts:result.hosts, reason:'already up to date'};
  // One copy of the file as it was before any link ever touched it. Our own
  // edits stay inside the marked block and are reversible, so a copy per change
  // would only litter ~/.ssh.
  const pristine = configPath + '.before-cursor-links';
  if (existed && !fs.existsSync(pristine)) fs.copyFileSync(configPath, pristine);
  if (!existed) fs.mkdirSync(path.dirname(configPath), {recursive:true});
  fs.writeFileSync(configPath, result.text);
  return {changed:true, hosts:result.hosts, unknown:resolved.unknown, configPath};
}
