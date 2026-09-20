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

// Substituting the 3.20.7 identifiers is only safe while no replacement collides
// with another symbol in the same anchor, which stopped holding in 3.21.1: its
// glass storage key reuses a name the older builds gave the usage hook. Newer
// builds therefore spell their anchors out.
const routingSymbols = {
  '3.21.1': {
    desktop: {host:'Zh', local:'qc', activation:'fdp', key:'Usy', model:'g', arg:'e'},
    glass:   {host:'Bp', local:'Ml', activation:'sDg', key:'pDg', model:'p', arg:'t'}
  },
  '3.21.9': {
    desktop: {host:'Qh', local:'qc', activation:'Jdp', key:'Poy', model:'g', arg:'e'},
    glass:   {host:'jp', local:'Ml', activation:'aNg', key:'gNg', model:'p', arg:'t'}
  },
  '3.21.12': {
    desktop: {host:'Qh', local:'jc', activation:'nhp', key:'Ooy', model:'g', arg:'e'},
    glass:   {host:'Pp', local:'Al', activation:'lNg', key:'fNg', model:'p', arg:'t'}
  },
  '3.21.16': {
    desktop: {host:'qh', local:'Gc', activation:'ihp', key:'Boy', model:'g', arg:'e'},
    glass:   {host:'Rp', local:'Rl', activation:'cNg', key:'vNg', model:'p', arg:'t'}
  },
  '3.21.13': {
    desktop: {host:'qh', local:'zc', activation:'nhp', key:'Ooy', model:'g', arg:'e'},
    glass:   {host:'Rp', local:'Rl', activation:'lNg', key:'fNg', model:'p', arg:'t'}
  }
};

function spelledAnchors({host,local,activation,key,model,arg}) {
  const selector=host+'(this.storageService,"useDedicatedLocalAgentRuntimeHost")';
  const native='return '+local+'.localMode&&'+arg+'?.get('+key+',-1)==="true"}';
  return {
    selector: selector+'?',
    selection: '(__useChatgptDedicatedRuntime('+model+',this.environmentService.remoteAuthority)||'+selector+')?',
    activation: 'function '+activation+'('+arg+'){'+native,
    enabled: 'function '+activation+'('+arg+'){return typeof __chatgptBridgeBase==="string"||'+native.slice('return '.length)
  };
}

export function patchRemoteRouting(source, surface, version='3.20.7') {
  if(!['3.20.7','3.20.11','3.20.17','3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13','3.21.16'].includes(version))throw new Error('Unsupported routing version');
  const original=remoteAnchors[surface];
  const anchors=routingSymbols[version]?.[surface]?spelledAnchors(routingSymbols[version][surface])
    :original&&Object.fromEntries(Object.entries(original).map(([key,value])=>[key,version==='3.20.23'?value.replaceAll('edp','kup').replaceAll('Qc','Zc').replaceAll('Qey','gJ_').replaceAll('mIg','SIg').replaceAll('Cl','kl').replaceAll('wIg','AIg'):version==='3.20.21'?value.replaceAll('edp','Sup').replaceAll('Qc','Zc').replaceAll('Qey','pJ_').replaceAll('mIg','_Ig').replaceAll('Cl','kl').replaceAll('wIg','xIg'):version==='3.20.17'?value.replaceAll('edp','jup').replaceAll('Qc','Zc').replaceAll('Qey','vey').replaceAll('mIg','mAg').replaceAll('Cl','wl').replaceAll('wIg','wAg').replaceAll('qp','Gp'):version==='3.20.11'?value.replaceAll('edp','ndp').replaceAll('Qey','ity').replaceAll('mIg','SIg').replaceAll('wIg','AIg'):value]));
  if (!anchors) throw new Error('Unknown workbench surface: ' + surface);
  for (const [before, after] of [[anchors.selector, anchors.selection], [anchors.activation, anchors.enabled]]) {
    if (source.split(before).length !== 2) throw new Error('Remote routing anchor not unique: ' + surface + ': ' + before);
    source = source.replace(before, after);
  }
  return remoteRoutingPrelude + source;
}
