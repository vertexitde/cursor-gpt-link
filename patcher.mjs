import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildPatches} from './src/patches.mjs';
import {installFiles, restoreFiles, hash} from './src/installation.mjs';
import {stateDir, configPath} from './src/config.mjs';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const build = JSON.parse(fs.readFileSync(path.join(sourceDir, 'src/supported-build.json'), 'utf8'));
const manifestPath = path.join(stateDir, 'installed.json');
const args = process.argv.slice(2);
const command = args.shift() || 'help';
const options = {};
while (args.length) {
  const flag = args.shift();
  if (!['--cursor-root', '--codex-path', '--codex-home', '--port'].includes(flag) || !args.length || args[0].startsWith('--')) {
    throw new Error('Unknown or incomplete option: ' + flag);
  }
  options[flag.slice(2)] = args.shift();
}

function cursorRoot() {
  const candidates = options['cursor-root'] ? [options['cursor-root']] : [
    path.join(process.env.LOCALAPPDATA || '', 'Programs/cursor/resources/app'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Cursor/resources/app')
  ];
  const root = candidates.find(p => fs.existsSync(path.join(p, 'package.json')));
  if (!root) throw new Error('Cursor not found. Pass --cursor-root with the resources/app directory.');
  return path.resolve(root);
}

function validate(root) {
  if (process.platform !== build.platform || process.arch !== build.arch) {
    throw new Error('Only Windows x64 is supported by this release.');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
  if (pkg.version !== build.version || product.commit !== build.commit) {
    throw new Error('Unsupported Cursor build. Expected ' + build.version + ' (' + build.commit + ').');
  }
  for (const [relative, expected] of Object.entries(build.files)) {
    if (hash(fs.readFileSync(path.join(root, relative))) !== expected) {
      throw new Error('Original file does not match the supported build: ' + relative + '. Restore existing patches first.');
    }
  }
}

function codexPath() {
  if (options['codex-path']) {
    const selected = path.resolve(options['codex-path']);
    if (!fs.existsSync(selected) || !selected.endsWith('.exe')) throw new Error('--codex-path must point to codex.exe.');
    return selected;
  }
  const bundled = path.join(process.env.LOCALAPPDATA || '', 'Programs/OpenAI/Codex/bin/codex.exe');
  if (fs.existsSync(bundled)) return bundled;
  try {
    const found = execFileSync('where.exe', ['codex.exe'], {encoding:'utf8', windowsHide:true}).trim().split(/\r?\n/)[0];
    if (fs.existsSync(found)) return found;
  } catch {}
  throw new Error('Codex executable not found. Pass --codex-path with the path to codex.exe.');
}

function requireClosedCursor() {
  const list = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Cursor.exe', '/FO', 'CSV', '/NH'], {encoding:'utf8', windowsHide:true});
  if (/"Cursor\.exe"/i.test(list)) throw new Error('Close all Cursor windows and background processes before installing or restoring.');
}

async function availablePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('Loopback port is already in use. Stop the old bridge or choose --port.')));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function prepare(root, cfg) {
  const {pickerModels} = await import('./src/bridge.mjs');
  const models = pickerModels();
  if (!models.length) throw new Error('No models found. Sign in and open Codex once to refresh its model catalog.');
  return buildPatches({root, cfg, models, nodePath:process.execPath,
    bridgePath:path.join(stateDir, 'runtime/bridge.mjs'), stateDir});
}

async function main() {
  if (command === 'help' || command === '--help') {
    console.log(`Usage: node patcher.mjs <check|install|status|restore> [options]

  --cursor-root PATH   Cursor resources/app directory (detected by default)
  --codex-path PATH    Codex executable used for sign-in and token renewal
  --codex-home PATH    Existing Codex home containing auth.json and models_cache.json
  --port NUMBER        Loopback port (default 43187)

State and backups: ${stateDir}
Set CURSOR_GPT_LINK_HOME before running to override that directory.
check verifies the original build without changing Cursor files.
Close Cursor before install or restore. See README.md for requirements.`);
    return;
  }
  if (command === 'status') {
    if (!fs.existsSync(manifestPath)) { console.log('No installation recorded in ' + stateDir); return; }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const valid = manifest.files.every(f => fs.existsSync(f.path) && hash(fs.readFileSync(f.path)) === f.patchedHash);
    console.log('Cursor ' + manifest.version + ': ' + (valid ? 'patched files verified' : 'files changed; possibly updated or installation incomplete'));
    if (!valid) process.exitCode = 1;
    return;
  }
  if (command === 'restore') {
    requireClosedCursor();
    restoreFiles(manifestPath);
    console.log('Original Cursor files restored. Backups retained.');
    return;
  }
  if (!['check', 'install'].includes(command)) throw new Error('Unknown command: ' + command);
  const root = cursorRoot();
  validate(root);
  if (command === 'check') { console.log('Supported original Cursor ' + build.version + ' build verified.'); return; }
  requireClosedCursor();
  if (fs.existsSync(manifestPath)) throw new Error('Installation already recorded. Use status or restore first.');
  const port = Number(options.port || 43187);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer between 1024 and 65535.');
  await availablePort(port);
  const cfg = {port, key:crypto.randomBytes(32).toString('hex'), codex:codexPath(),
    codexHome:path.resolve(options['codex-home'] || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))};
  fs.mkdirSync(stateDir, {recursive:true});
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), {mode:0o600});
  // The bridge module is imported only after writing configuration.
  // config.mjs was loaded earlier, so update the shared object before importing it.
  const {config} = await import('./src/config.mjs');
  Object.assign(config, cfg);
  const pending = await prepare(root, cfg);
  const backupDir = path.join(stateDir, 'backups', build.version + '-' + Date.now());
  fs.mkdirSync(backupDir, {recursive:true});
  for (let n = 0; n < pending.length; n++) {
    const file = pending[n];
    if (!file.path.endsWith('.js')) continue;
    const candidate = path.join(backupDir, 'candidate-' + n + '.mjs');
    fs.writeFileSync(candidate, file.content);
    execFileSync(process.execPath, ['--check', candidate], {stdio:'pipe', windowsHide:true});
    fs.unlinkSync(candidate);
  }
  const runtime = path.join(stateDir, 'runtime');
  fs.mkdirSync(runtime, {recursive:true});
  for (const name of ['bridge.mjs', 'config.mjs', 'openai-icon.mjs']) fs.copyFileSync(path.join(sourceDir, 'src', name), path.join(runtime, name));
  installFiles(pending, {backupDir, manifestPath, version:build.version, commit:build.commit});
  console.log('Installed. Start Cursor and select a model with the OpenAI symbol.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
