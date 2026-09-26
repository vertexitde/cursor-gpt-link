// Cursor puts "36% used" next to its own picker section, from the section
// component's titleTrailing prop. The subscription sections can say the same:
// both bridges already report their windows, so the label shows the window
// that is closest to its limit. That is usually the short rolling one, and it
// becomes the weekly one exactly when the week is the tighter constraint.

// The two bridges describe their windows differently: Claude sends a list,
// ChatGPT a primary and a secondary window with their length in seconds.
export function usageWindows(data) {
  if (data && Array.isArray(data.windows)) {
    return data.windows
      .filter(w => w && typeof w.usedPercent === 'number')
      .map(w => ({label:String(w.label || 'Usage'), percent:w.usedPercent}));
  }
  const out = [];
  for (const key of ['primary', 'secondary']) {
    const w = data && data[key];
    if (!w || typeof w.usedPercent !== 'number') continue;
    const seconds = Number(w.windowSeconds);
    const label = !Number.isFinite(seconds) || seconds <= 0 ? 'Usage'
      : seconds >= 604800 ? (seconds === 604800 ? 'Weekly' : Math.round(seconds / 604800) + '-week')
      : seconds >= 3600 ? Math.round(seconds / 3600) + '-hour'
      : Math.round(seconds / 60) + '-minute';
    out.push({label, percent:w.usedPercent});
  }
  return out;
}

// Cursor's own rounding: never round a started window down to zero.
export function usagePercent(value) {
  return value > 0 && value < 1 ? 1 : Math.round(Math.min(Math.max(value, 0), 100));
}

export function usageLabel(windows) {
  if (!windows || !windows.length) return undefined;
  const worst = windows.reduce((a, b) => b.percent > a.percent ? b : a);
  return {text:usagePercent(worst.percent) + '% used',
    title:windows.map(w => w.label + ': ' + usagePercent(w.percent) + '% used').join(' · ')};
}

// Everything below is executed inside Cursor, so it is kept as plain functions
// and shipped through toString. Each link prepends the same copy; redefining
// them is harmless because they are identical.
function __subscriptionUsageRead(name) {
  return (globalThis.__subscriptionUsage || (globalThis.__subscriptionUsage = {}))[name] ||
    (globalThis.__subscriptionUsage[name] = {});
}

function __subscriptionUsageRefresh(name, base, key) {
  const state = __subscriptionUsageRead(name);
  if (state.pending || Date.now() - (state.checkedAt || 0) < 60000) return;
  state.pending = true;
  fetch(base + '/usage', {headers:{Authorization:'Bearer ' + key}, signal:AbortSignal.timeout(4000)})
    .then(r => r.ok ? r.json() : undefined)
    .then(data => { if (data) state.value = __subscriptionUsageLabel(__subscriptionUsageWindows(data)); })
    .catch(() => {})
    .finally(() => { state.pending = false; state.checkedAt = Date.now(); });
}

// Called while the section renders: hand back the last known label and start a
// refresh at most once a minute. A bridge that cannot answer leaves the
// section exactly as it was.
function __subscriptionUsageTrailing(name, jsx, base, key) {
  if (typeof base !== 'string' || base.length === 0) return undefined;
  __subscriptionUsageRefresh(name, base, key);
  const value = __subscriptionUsageRead(name).value;
  if (!value) return undefined;
  return jsx('span', {className:'ui-4b2ntj ui-2lah0s', title:value.title, children:value.text});
}

// Every link prepends this same text, so the helpers are assignments rather
// than declarations: a second copy simply overwrites the first with identical
// code, the way the picker helper does. Two declarations would be a syntax
// error under module semantics.
const assignment = (fn, name) => 'var ' + name + '=' + fn.toString().replace(/^function [\w$]+/, 'function') + ';';

export const usageLabelHelpersSrc = [
  assignment(usageWindows, '__subscriptionUsageWindows'),
  assignment(usagePercent, '__subscriptionUsagePercent'),
  assignment(usageLabel, '__subscriptionUsageLabel'),
  assignment(__subscriptionUsageRead, '__subscriptionUsageRead'),
  assignment(__subscriptionUsageRefresh, '__subscriptionUsageRefresh'),
  assignment(__subscriptionUsageTrailing, '__subscriptionUsageTrailing')
].join('\n').replace(/\busagePercent\(/g, '__subscriptionUsagePercent(') + '\n';

// The expression a section passes as titleTrailing. The bridge constants only
// exist when that link is installed, so they are read defensively.
export const usageTrailingArgument = (name, jsx, base, key) =>
  `__subscriptionUsageTrailing("${name}",${jsx},typeof ${base}==="string"?${base}:"",typeof ${key}==="string"?${key}:"")`;
