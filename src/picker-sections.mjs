export function withSubscriptionPickerSections(g) {
  const claude=[],chatgpt=[];
  const rest=list=>{
    const out=[];
    for (const m of list||[]) {
      const n=m?.name;
      if (typeof n==='string'&&n.startsWith('claude-subscription/')) claude.push(m);
      else if (typeof n==='string'&&n.startsWith('chatgpt-codex/')) chatgpt.push(m);
      else out.push(m);
    }
    return out;
  };
  return {leading:rest(g.leading),promoted:rest(g.promoted),others:rest(g.others),claude,chatgpt};
}

export const pickerSectionHelpersSrc='var __withSubscriptionPickerSections=function(g){const claude=[],chatgpt=[];const rest=function(list){const out=[];for(const m of list||[]){const n=m&&m.name;if(typeof n==="string"&&n.startsWith("claude-subscription/"))claude.push(m);else if(typeof n==="string"&&n.startsWith("chatgpt-codex/"))chatgpt.push(m);else out.push(m)}return out};return{leading:rest(g.leading),promoted:rest(g.promoted),others:rest(g.others),claude,chatgpt}};';

export function patchPickerSections(source, replaceOnce, {groupReturn, promotedAnchor, modelsVar, jsx, fmt, renderModel}) {
  if (!source.includes('__withSubscriptionPickerSections(')) {
    source=replaceOnce(source, groupReturn, 'return __withSubscriptionPickerSections('+groupReturn.slice('return '.length)+')');
  }
  if (!source.includes('"chatgpt-subscription-models"')) {
    source=replaceOnce(source, promotedAnchor,
      modelsVar+'.chatgpt.length>0&&'+jsx+'('+fmt+',{models:'+modelsVar+'.chatgpt,title:"ChatGPT Subscription",renderModel:'+renderModel+'},"chatgpt-subscription-models"),'+
      modelsVar+'.claude.length>0&&'+jsx+'('+fmt+',{models:'+modelsVar+'.claude,title:"Claude Subscription",renderModel:'+renderModel+'},"claude-subscription-models"),'+
      promotedAnchor);
  }
  return source;
}
