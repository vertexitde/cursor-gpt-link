// The native Max toggle changes context capacity, not reasoning or speed.
export function maxModeVariant(model, parameters, maxMode) {
  // A model without variants for this mode (Fusion, Haiku) keeps the chosen
  // parameters instead of falling back to its first variant.
  let candidates=model.variants.filter(v=>(v.isMaxMode===true)===maxMode);
  if(!candidates.length)candidates=model.variants;
  if(!candidates.length)return;
  const requested=parameters.filter(p=>p.id!=='context');
  const score=v=>requested.filter(p=>v.parameterValues.some(q=>q.id===p.id&&q.value===p.value)).length;
  return candidates.reduce((best,v)=>score(v)>score(best)?v:best);
}
// From 3.32 the solver lives in workbench.anysphere-ui.js, not in the surfaces.
export const hasMaxModeSolver = source => /function [\w$]+\(([\w$]+),[\w$]+,([\w$]+)\)\{if\(\1\.variants\.length===0\|\|!\2&&\1\.supportsNonMaxMode===!1\)return;/.test(source);
export function patchMaxMode(source) {
  const matches=[...source.matchAll(/function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{if\(\2.variants.length===0\|\|!\4&&\2.supportsNonMaxMode===!1\)return;/g)];
  if(matches.length!==1)throw new Error('Max-mode variant solver anchor is not unique');
  const match=matches[0],model=match[2],params=match[3],mode=match[4];
  const call='if('+model+'.name?.startsWith("chatgpt-codex/")){const v=__ChatgptMaxModeVariant('+model+','+params+','+mode+');if(v)return{model:'+model+',variant:v,parameters:v.parameterValues}}';
  return source.replace(match[0],match[0]+call)+'\n'+maxModeVariant.toString().replace('function maxModeVariant','function __ChatgptMaxModeVariant')+'\n';
}
