import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {installFiles, restoreFiles} from '../src/installation.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-gpt-link-install-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(backupDir);
  const pending = ['one.js', 'two.js'].map((name, i) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, 'original ' + i);
    return {path:file, content:'patched ' + i};
  });
  const options = {backupDir, manifestPath:path.join(root, 'installed.json'), version:'test', commit:'test'};
  return {pending, options};
}

test('installation and restore preserve exact original bytes', t => {
  const {pending, options} = fixture(t);
  installFiles(pending, options);
  assert.equal(fs.readFileSync(pending[0].path, 'utf8'), 'patched 0');
  assert.throws(() => installFiles(pending, options), /already exists/);
  restoreFiles(options.manifestPath);
  pending.forEach((file, i) => assert.equal(fs.readFileSync(file.path, 'utf8'), 'original ' + i));
  assert.equal(fs.existsSync(options.manifestPath), false);
});

test('restore refuses an updated application without changing other files', t => {
  const {pending, options} = fixture(t);
  installFiles(pending, options);
  fs.writeFileSync(pending[1].path, 'updated application');
  assert.throws(() => restoreFiles(options.manifestPath), /File changed/);
  assert.equal(fs.readFileSync(pending[0].path, 'utf8'), 'patched 0');
});

test('restore refuses damaged backups before changing the application', t => {
  const {pending, options} = fixture(t);
  const manifest = installFiles(pending, options);
  fs.writeFileSync(manifest.files[1].backup, 'damaged');
  assert.throws(() => restoreFiles(options.manifestPath), /Backup is damaged/);
  assert.equal(fs.readFileSync(pending[0].path, 'utf8'), 'patched 0');
});

test('restore can resume after an interrupted restoration', t => {
  const {pending, options} = fixture(t);
  const manifest = installFiles(pending, options);
  fs.copyFileSync(manifest.files[0].backup, pending[0].path);
  restoreFiles(options.manifestPath);
  assert.equal(fs.readFileSync(pending[1].path, 'utf8'), 'original 1');
});
