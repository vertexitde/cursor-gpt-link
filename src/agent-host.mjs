// Cursor 3.25 can run every chat through its new agent host instead of the
// classic agent path. It decides once per window, from a server-side
// experiment (cursor_agent_host) or private inference, and the agent host
// talks to Cursor's backend directly, so local models never reach the local
// runtime: Cursor answers "Unknown model ID". Users outside the experiment get
// the classic path, which the links route; keep every window on it. Each link
// applies this, and the marker makes the second one a no-op.
export const agentHostMarker = '/*cursor-links: classic agent path*/';

export function patchAgentHost(source) {
  if (source.includes(agentHostMarker)) return source;
  // 3.24 and 3.25: this._agentHostEnabled=(gate||privateInference)&&policy,
  // From 3.31: this._topologyEnabled=gate&&!orbitOff||forced, with the remote
  // workspace policy read separately when the window asks.
  const enabled = [...source.matchAll(/this\._agentHostEnabled=\(([\w$]+)\|\|([\w$]+)\)&&([\w$]+),/g)];
  const topology = [...source.matchAll(/this\._topologyEnabled=([\w$!&|]+),/g)];
  // Earlier builds, reviewed as they are, stay untouched; verify-build checks
  // that a supported build from 3.24 on carries the marker.
  if (!enabled.length && !topology.length) return source;
  if (enabled.length + topology.length !== 1) throw new Error('Agent host enablement anchor is not unique');
  if (enabled.length) {
    const [anchor, gate, privateInference, policy] = enabled[0];
    return source.replace(anchor, () => `this._agentHostEnabled=${agentHostMarker}!1&&(${gate}||${privateInference})&&${policy},`);
  }
  const [anchor, condition] = topology[0];
  return source.replace(anchor, () => `this._topologyEnabled=${agentHostMarker}!1&&(${condition}),`);
}
