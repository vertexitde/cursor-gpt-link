import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const stateDir = path.resolve(process.env.CURSOR_GPT_LINK_HOME ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'cursor-gpt-link'));
export const configPath = path.join(stateDir, 'config.json');
export const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
export function getCodexHome() {
  return path.resolve(config.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}
