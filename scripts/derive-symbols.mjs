// Derive the minified workbench symbols these patches anchor to from ORIGINAL
// Cursor bundles, locating each one by the role it plays rather than by name.
// Names are recycled between builds, so the output is reviewed and committed as
// part of a build's patch definitions; the installer never derives on the fly.
//
//   node scripts/derive-symbols.mjs <resources/app>
//   node scripts/derive-symbols.mjs --desktop <file> --glass <file> [--out <file>]
//
// The shared half of this file is kept in step with cursor-mercury-link's
// scripts/derive-symbols.mjs; the rest covers the Plan & Usage card, the login
// command and the notification service, which only this link and
// cursor-claude-link patch.
import fs from 'node:fs';
import path from 'node:path';

// The index of the bracket that closes the one at `open`, skipping strings,
// template literals and regular nesting; -1 if the source ends first.
function closingBracket(source, open) {
  const pairs = {'[':']', '(':')', '{':'}'}, stack = [];
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ']' || c === ')' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

function deriveSharedSurface(source) {
  const problems = [];
  const out = {};
  const unique = (label, pattern) => {
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) { problems.push(`${label}: ${matches.length} matches`); return null; }
    return matches[0];
  };
  const within = (label, text, pattern) => {
    const match = text.match(pattern);
    if (!match) problems.push(`${label}: not found`);
    return match;
  };
  const mostFrequent = (pattern, key) => {
    const counts = new Map();
    for (const m of source.matchAll(pattern)) counts.set(key(m), (counts.get(key(m)) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  if (source.includes('__chatgptBridgeBase') || source.includes('__claudeBridgeBase') || source.includes('__mercuryBridgeBase'))
    problems.push('bundle is already patched; derive symbols from original files');

  // Model picker sections
  const group = unique('groupReturn', /return ([\w$]+)\.mergeLeadingIntoPromotedSection===!0\?\{leading:\[\],promoted:\[\.\.\.([\w$]+),\.\.\.([\w$]+)\],others:([\w$]+)\}:\{leading:\2,promoted:\3,others:\4\}/g);
  if (group) out.groupReturn = group[0];
  // Up to 3.22 the promoted section is one expression inside the returned
  // fragment. From 3.24 the picker went through the React compiler: the
  // section becomes a memoized variable and the fragment's children list is
  // rebuilt only when one of its memo slots changes.
  const inline = [...source.matchAll(/([\w$]+)\(([\w$]+),\{models:([\w$]+)\.promoted,title:([\w$]+)\?\.promotedSectionTitle/g)];
  const compiled = [...source.matchAll(/([\w$]+)=([\w$]+)\(([\w$]+),\{models:([\w$]+)\.promoted,title:([\w$]+),titleTrailing:([\w$]+),renderModel:([\w$]+)\},"promoted-models"\)/g)];
  if (inline.length === 1 && compiled.length === 0) {
    const promoted = inline[0];
    Object.assign(out, {promotedAnchor: promoted[0], jsx: promoted[1], fmt: promoted[2], modelsVar: promoted[3]});
    const render = within('renderModel', source.slice(promoted.index, promoted.index + 600), /renderModel:([\w$]+)\},"promoted-models"/);
    if (render) out.renderModel = render[1];
  } else if (compiled.length === 1 && inline.length === 0) {
    const promoted = compiled[0];
    Object.assign(out, {promotedRender: promoted[0], promotedVar: promoted[1], jsx: promoted[2], fmt: promoted[3], modelsVar: promoted[4], renderModel: promoted[7]});
    // The memoized fragment that lists the sections, right after the promoted one.
    const escaped = promoted[1].replace(/\$/g, '\\$');
    const tail = within('sectionsReturn', source.slice(promoted.index, promoted.index + 6000),
      new RegExp(`return ((?:[\\w$]+\\[\\d+\\]!==[\\w$]+\\|\\|)*[\\w$]+\\[\\d+\\]!==[\\w$]+)\\?\\(([\\w$]+)=([\\w$]+)\\(([\\w$]+),\\{children:\\[([\\w$]+),${escaped},([\\w$]+),([\\w$]+)\\]\\}\\)`));
    if (tail) out.sectionsReturn = tail[0];
  } else if (!inline.length && !compiled.length && /\{id:"promoted",items:[\w$]+\.promoted,title:[\w$]+\?\.promotedSectionTitle\},\{id:"pinned-others",/.test(source)) {
    // From 3.31 the picker lists its sections as {id, items, title} entries
    // that one renderer draws; the patch adds entries and needs only the jsx
    // function of a renderer for a section's trailing label.
    const lists = [...source.matchAll(/\{id:"promoted",items:([\w$]+)\.promoted,title:[\w$]+\?\.promotedSectionTitle\},\{id:"pinned-others",/g)];
    const renderers = [...source.matchAll(/([\w$]+)\([\w$]+\.Section,\{(?:title:([\w$]+)\.title|group:([\w$]+)),trailing:([\w$]+)\.id==="promoted"\?/g)];
    out.sectionLists = lists.length;
    out.sectionRenderers = renderers.length;
    if (lists.length !== 2) problems.push(`sectionLists: ${lists.length} matches`);
    if (renderers.length !== 2) problems.push(`sectionRenderers: ${renderers.length} matches`);
    if (renderers[0]) out.jsx = renderers[0][1];
  } else problems.push(`promotedAnchor: ${inline.length} inline and ${compiled.length} compiled matches`);

  // Default model list mapping that is persisted afterwards
  const map = unique('modelMap', /const ([\w$]+)=([\w$]+)\(([\w$]+)\);\3=\3\.map\(([\w$]+)=>([\w$]+)\(\4\)\),[\w$]+\(\(\)=>\{this\.persistAvailableDefaultMod/g);
  if (map) Object.assign(out, {mapPrefix: `const ${map[1]}=${map[2]}(${map[3]});`, mapVar: map[3], mapper: `${map[4]}=>${map[5]}(${map[4]})`});

  // Local agent run gate
  // Up to 3.22 the local mode is also passed into the run options; from 3.24
  // only the branch checks it. The anchor keeps whichever form the build has.
  const run = unique('run', /async run\(([\w$,]+)\)\{const ([\w$]+)=([\w$]+)\(([\w$]+),\{isRunningInTest:\4\.isRunningInTest\?\?this\.environmentService\.enableSmokeTestDriver===!0(?:,localMode:([\w$]+)\.localMode)?\}\);if\((?:[\w$]+\.releaseAfterSend\([\w$]+\.conversationId\),)?([\w$]+)\.localMode\)\{/g);
  if (run) {
    if (run[5] !== undefined && run[5] !== run[6]) problems.push('run: the options and the branch read different local-mode flags');
    Object.assign(out, {runAnchor: run[0], runLocalVar: run[2], runFn: run[3], localMode: run[6]});
  }

  // Dedicated runtime host selector and the requested model in scope there
  const host = unique('dedicatedHost', /([\w$]+)\(this\.storageService,"useDedicatedLocalAgentRuntimeHost"\)\?await this\.runLocalAgentInDedicatedExtensionHost/g);
  if (host) {
    out.host = host[1];
    const intent = [...source.slice(Math.max(0, host.index - 3000), host.index).matchAll(/modelIntent:([\w$]+)/g)].pop();
    if (intent) out.hostModelVar = intent[1]; else problems.push('hostModelVar: not found');
  }
  const activation = unique('activation', /function ([\w$]+)\(([\w$]+)\)\{return ([\w$]+)\.localMode&&\2\?\.get\(([\w$]+),-1\)==="true"\}/g);
  if (activation) out.activation = activation[0];

  // Settings > Models > API keys: the Google card and its building blocks
  const google = unique('googleCard', /\{apiName:"Google",description:/g);
  if (google) {
    const fnStart = source.lastIndexOf('function ', google.index);
    const fn = source.slice(fnStart, google.index + 400);
    const name = fn.match(/^function ([\w$]+)\(/);
    if (name) out.googleCard = name[1]; else problems.push('googleCard name: not found');
    const services = within('settings services', fn, /=([\w$]+)\([\w$]+,[\w$]+\),([\w$]+)=([\w$]+)\(([\w$]+)\),([\w$]+)=\1\([\w$]+,([\w$]+)\),([\w$]+)=([\w$]+)\(\2\)/);
    if (services) Object.assign(out, {settingsService: services[1], useService: services[3], openerId: services[6], keyReader: services[8]});
    const description = within('description', fn, /([\w$]+)\(([\w$]+),\{children:\["You can put in"," ",([\w$]+)\(([\w$]+),\{onClick:\(\)=>\{[\w$]+\.open\("https:\/\/aistudio\.google\.com/);
    if (description) Object.assign(out, {jsxs: description[1], descriptionWrapper: description[2], keyJsx: description[3], link: description[4]});
    const generic = within('generic key card', fn, /([\w$]+)\(([\w$]+),\{apiName:"Google"/);
    if (generic) {
      out.genericKeyCard = generic[2];
      const cardFnAt = source.indexOf(`function ${generic[2]}(`);
      const cardFn = cardFnAt >= 0 ? source.slice(cardFnAt, cardFnAt + 6000) : '';
      // From 3.32 a settings card is built from parts: the card namespace
      // (Root, Header, Title, Description, Group, Preview) and the row
      // namespace (Root, Content, Title, Description, Control). The patches
      // then draw their cards through a small adapter with the older shape.
      const group = cardFn.match(/[\w$]+\(([\w$]+)\.Group,\{accessibleLabel:[\w$]+,variant:"tinted"/);
      if (group) {
        const control = within('api key control', cardFn, /\(([\w$]+)\.Control,\{children:[\w$]+\(([\w$]+),\{ariaLabel:/);
        if (control) Object.assign(out, {cardNs: group[1], rowNs: control[1], keyInput: control[2]});
      } else {
        const entry = within('api key entry', cardFn, /([\w$]+)\.Entry,\{label:"API Key",layout:"row",children:[\w$]+\(([\w$]+),\{ariaLabel:/);
        if (entry) Object.assign(out, {zs: entry[1], keyInput: entry[2]});
        const card = within('key card shell', cardFn, /[\w$]+\(([\w$]+),\{description:[\w$]+,title:[\w$]+,children:\[[\w$]+,[\w$]+\]\}\)/);
        if (card) out.card = card[1];
      }
    }
    if (out.keyReader) {
      const readerAt = source.indexOf(`function ${out.keyReader}(`);
      const reader = readerAt >= 0 ? source.slice(readerAt, readerAt + 500) : '';
      const state = within('useState', reader, /const\[[\w$]+,[\w$]+\]=([\w$]+)\([\w$]+\)/);
      if (state) out.useState = state[1];
      const effect = within('useEffect', reader, /,([\w$]+)\([\w$]+,[\w$]+\),[\w$]+\}/);
      if (effect) out.useEffect = effect[1];
    }
    const composition = unique('googleCardComposition', new RegExp(`([\\w$]+)=([\\w$]+)\\(${(out.googleCard || '\\u0000').replace(/\$/g, '\\$')},\\{settingsWorkspace:([\\w$]+)\\}\\)`, 'g'));
    if (composition) out.googleCardComposition = composition[0];
  }
  const secrets = unique('secretStorageService', /([\w$]+)=[\w$]+\("secretStorageService"\)/g);
  if (secrets) out.secretStorage = secrets[1];

  // Subagent task bubble and lifecycle
  const wait = unique('waitForParentTaskBubble', /async _waitForParentTaskBubbleIfPossible\(([\w$]+)\)\{const ([\w$]+)=([\w$]+)\(\1\.parentConversationId\)/g);
  if (wait) out.trim = wait[3];
  out.taskV2 = mostFrequent(/([\w$]+)\.TASK_V2\b/g, m => m[1]);
  out.toolFormer = mostFrequent(/([\w$]+)\.TOOL_FORMER\b/g, m => m[1]);
  const params = unique('taskV2Params', /case:"taskV2Params",value:new ([\w$]+)\(/g);
  if (params) out.taskV2Params = params[1];
  const service = unique('subagentService', /invokeFunction\(([\w$]+)=>\1\.get\(([\w$]+)\)\)\.getLastTerminationReason/g);
  if (service) out.subagentService = service[2];
  const untrack = unique('conversationMap', /map:([\w$]+)\(\(\)=>([\w$]+)\.conversationMap\)\},this\.cachedConversationMapRef=/g);
  if (untrack) out.untrack = untrack[1];

  return {symbols: out, problems};
}

export function deriveSurface(source) {
  const {symbols, problems} = deriveSharedSurface(source);
  const unique = (label, pattern) => {
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) { problems.push(`${label}: ${matches.length} matches`); return null; }
    return matches[0];
  };

  // Plan & Usage card: the component, its jsx call and the four children
  // Up to 3.25 the children are plain locals; from 3.31 they are expressions,
  // so the list is read up to its matching bracket.
  const usage = unique('planUsage', /([\w$]+)\(([\w$]+),\{legacyScrollGutter:[\w$]+,title:"Plan & Usage",children:\[/g);
  if (usage) {
    symbols.usageJsx = usage[1];
    const open = usage.index + usage[0].length - 1, close = closingBracket(source, open);
    if (close < 0) problems.push('usageChildren: list end not found');
    else symbols.usageChildren = source.slice(source.indexOf('title:"Plan & Usage"', usage.index), close + 1);
    // The React compiler shape up to 3.25; a plain component with destructured
    // props from 3.31.
    const compiledHeader = [...source.slice(0, usage.index).matchAll(/function ([\w$]+)\(([\w$]+)\)\{const ([\w$]+)=([\w$]+)\((\d+)\)/g)].pop();
    const plainHeader = [...source.slice(0, usage.index).matchAll(/function ([\w$]+)\(\{[\w$:,]+\}\)\{/g)].pop();
    const header = [compiledHeader, plainHeader].filter(Boolean).sort((a, b) => b.index - a.index)[0];
    if (header) symbols.usageFn = header[0]; else problems.push('usageFn: not found');
    // The hook aliases differ per module, so read the ones this component
    // actually calls rather than the nearest import.
    if (header) {
      const body = source.slice(header.index, usage.index);
      const only = (label, pattern) => {
        const names = new Set([...body.matchAll(pattern)].map(m => m[1]));
        if (names.size === 1) return [...names][0];
        problems.push(`${label}: ${names.size} candidates`);
        return null;
      };
      symbols.usageUseState = only('usageUseState', /\[[\w$]+,[\w$]+\]=([\w$]+)\(/g);
      // Compiled components call the effect with hoisted locals; plain ones
      // pass an arrow and its dependency list.
      symbols.usageUseEffect = /,([\w$]+)\(([\w$]+),([\w$]+)\);/.test(body)
        ? only('usageUseEffect', /,([\w$]+)\(([\w$]+),([\w$]+)\);/g)
        : only('usageUseEffect', /[;,]([\w$]+)\(\(\)=>\{[^]*?\},\[[\w$.,]*\]\)/g);
    }
  }
  const bars = new Set([...source.matchAll(/[\w$]+\(([\w$]+),\{[^{}]{0,200}?variant:"bar"/g)].map(m => m[1]));
  if (bars.size === 1) symbols.bar = [...bars][0]; else problems.push(`bar: ${bars.size} candidates`);
  const barStyle = unique('barStyle', /,([\w$]+)=\{\.\.\.[\w$]+,"--cursor-bg-accent":"var\(--cursor-bg-blue-primary\)"\}/g);
  if (barStyle) symbols.barStyle = barStyle[1];

  // Command registration pair and the notification service identifier
  const pairs = new Map();
  for (const m of source.matchAll(/([\w$]+)\(class extends ([\w$]+)\{constructor\(\)\{super\(\{id:"/g))
    pairs.set(m[1] + '|' + m[2], (pairs.get(m[1] + '|' + m[2]) || 0) + 1);
  const ranked = [...pairs.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length && ranked[0][1] > (ranked[1]?.[1] ?? 0) * 2) {
    [symbols.registerAction, symbols.actionBase] = ranked[0][0].split('|');
  } else problems.push('action pair: no clear winner');
  const notification = unique('notificationService', /([\w$]+)=[\w$]+\("notificationService"\)/g);
  if (notification) symbols.notificationService = notification[1];

  // Argument order of the provider configuration hook, spelled out per build
  const provider = unique('providerConfig', /async getLocalAgentProviderConfig\(([\w$]+),([\w$]+)\)\{/g);
  if (provider) symbols.providerConfig = provider[0];
  return {symbols, problems};
}

if (process.argv[1] && process.argv[1].endsWith('derive-symbols.mjs')) {
  const all = process.argv.slice(2);
  const outAt = all.indexOf('--out');
  const out = outAt >= 0 ? all[outAt + 1] : null;
  const args = outAt >= 0 ? [...all.slice(0, outAt), ...all.slice(outAt + 2)] : all;
  const files = {};
  if (args[0] === '--desktop' || args[0] === '--glass') for (let i = 0; i < args.length; i += 2) files[args[i].slice(2)] = args[i + 1];
  else {
    if (!args[0]) throw new Error('Usage: node scripts/derive-symbols.mjs <resources/app> | --desktop <file> --glass <file>');
    files.desktop = path.join(args[0], 'out/vs/workbench/workbench.desktop.main.js');
    files.glass = path.join(args[0], 'out/vs/workbench/workbench.glass.main.js');
  }
  const result = {}, problems = [];
  for (const [surface, file] of Object.entries(files)) {
    const {symbols, problems: found} = deriveSurface(fs.readFileSync(file, 'utf8'));
    result[surface] = symbols;
    problems.push(...found.map(p => `${surface}.${p}`));
  }

  // From 3.32 the model picker lives in workbench.anysphere-ui.js, a module
  // both surfaces import. Its roles are taken from there, and the surfaces no
  // longer need them.
  const appRoot = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  const uiFile = appRoot && path.join(appRoot, 'out/vs/workbench/workbench.anysphere-ui.js');
  if (uiFile && fs.existsSync(uiFile)) {
    const {symbols: ui, problems: uiProblems} = deriveSurface(fs.readFileSync(uiFile, 'utf8'));
    result.ui = Object.fromEntries(['groupReturn', 'sectionLists', 'sectionRenderers', 'jsx'].filter(k => k in ui).map(k => [k, ui[k]]));
    problems.push(...uiProblems.filter(p => /^(groupReturn|sectionLists|sectionRenderers|promotedAnchor)\b/.test(p)).map(p => 'ui.' + p));
    if (result.ui.groupReturn && result.ui.sectionLists === 2)
      for (let i = problems.length - 1; i >= 0; i--) if (/^(desktop|glass)\.(groupReturn|promotedAnchor)\b/.test(problems[i])) problems.splice(i, 1);
  }
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  else console.log(JSON.stringify(result, null, 2));
  console.error(problems.length ? 'PROBLEMS:\n' + problems.map(p => '  - ' + p).join('\n') : 'problems: none');
  if (problems.length) process.exitCode = 1;
}
