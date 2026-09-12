// Cursor's dedicated UI runtime makes model requests locally and sends tool
// execution back through the renderer's existing workspace exec resources.
// The workspace provider can therefore remain on the SSH host.
export const remoteRoutingPrelude = `
function __useChatgptDedicatedRuntime(model, remoteAuthority) {
  return __isChatgptBridgeModel(model) && typeof remoteAuthority === "string" && remoteAuthority.length > 0;
}
`;

export const remoteAnchors = {
  desktop: {
    selector: 'Gh(this.storageService,"useDedicatedLocalAgentRuntimeHost")?',
    selection: '(__useChatgptDedicatedRuntime(g,this.environmentService.remoteAuthority)||Gh(this.storageService,"useDedicatedLocalAgentRuntimeHost"))?',
    activation: 'function edp(e){return Qc.localMode&&e?.get(Qey,-1)==="true"}',
    enabled: 'function edp(e){return typeof __chatgptBridgeBase==="string"||Qc.localMode&&e?.get(Qey,-1)==="true"}'
  },
  glass: {
    selector: 'qp(this.storageService,"useDedicatedLocalAgentRuntimeHost")?',
    selection: '(__useChatgptDedicatedRuntime(p,this.environmentService.remoteAuthority)||qp(this.storageService,"useDedicatedLocalAgentRuntimeHost"))?',
    activation: 'function mIg(t){return Cl.localMode&&t?.get(wIg,-1)==="true"}',
    enabled: 'function mIg(t){return typeof __chatgptBridgeBase==="string"||Cl.localMode&&t?.get(wIg,-1)==="true"}'
  }
};

export function patchRemoteRouting(source, surface, version='3.20.7') {
  if(!['3.20.7','3.20.11','3.20.17'].includes(version))throw new Error('Unsupported routing version');
  const original=remoteAnchors[surface];
  const anchors=original&&Object.fromEntries(Object.entries(original).map(([key,value])=>[key,version==='3.20.17'?value.replaceAll('edp','jup').replaceAll('Qc','Zc').replaceAll('Qey','vey').replaceAll('mIg','mAg').replaceAll('Cl','wl').replaceAll('wIg','wAg').replaceAll('qp','Gp'):version==='3.20.11'?value.replaceAll('edp','ndp').replaceAll('Qey','ity').replaceAll('mIg','SIg').replaceAll('wIg','AIg'):value]));
  if (!anchors) throw new Error('Unknown workbench surface: ' + surface);
  for (const [before, after] of [[anchors.selector, anchors.selection], [anchors.activation, anchors.enabled]]) {
    if (source.split(before).length !== 2) throw new Error('Remote routing anchor not unique: ' + surface + ': ' + before);
    source = source.replace(before, after);
  }
  return remoteRoutingPrelude + source;
}
