import {usageTrailingArgument} from './usage-label.mjs';
import {insertListSections} from './section-list.mjs';
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

// From 3.24 the picker went through the React compiler. The promoted section is
// a memoized variable, and the fragment that lists the sections is rebuilt only
// when one of its memo slots changes:
//
//   return t[39]!==se||…||t[42]!==J?(ce=F(C,{children:[J,se,re,ue]}),…):ce=t[43]
//
// The subscription sections go into that list, before the promoted one. Their
// content (the usage label in particular) changes without any of those slots
// changing, so while subscription models are present the fragment is rebuilt
// on every render, which is what every build before the compiler did anyway.
// All three links write the same condition, so whichever comes first adds it.
export function compiledSectionsParts(sectionsReturn) {
  const match = sectionsReturn.match(/^return (.+)\?\(([\w$]+)=([\w$]+)\(([\w$]+),\{children:\[([\w$]+),([\w$]+),([\w$]+),([\w$]+)\]\}\)$/);
  if (!match) throw new Error('Unrecognised picker sections fragment: ' + sectionsReturn.slice(0, 100));
  const [, condition, result, fragment, component, leading, promoted, pinned, others] = match;
  return {condition, result, fragment, component, leading, promoted, pinned, others};
}

export const compiledRebuild = modelsVar =>
  `${modelsVar}.chatgpt?.length||${modelsVar}.claude?.length||${modelsVar}.mercury?.length||`;

export function insertCompiledSections(source, replaceOnce, {modelsVar, sectionsReturn}, sections) {
  const parts = compiledSectionsParts(sectionsReturn);
  const head = `return ${parts.condition}?(${parts.result}=`;
  if (!source.includes(`return ${compiledRebuild(modelsVar)}`)) source = replaceOnce(source, head, `return ${compiledRebuild(modelsVar)}${parts.condition}?(${parts.result}=`);
  // The list ends in the promoted, pinned and other sections whatever was put
  // in front of them, so a link that comes second still finds its place.
  const tail = `,${parts.promoted},${parts.pinned},${parts.others}]})`;
  // 3.25's Agents Window has a second fragment ending in the same names, so
  // the tail is looked for only after this picker's own fragment.
  const fragment = `(${parts.result}=${parts.fragment}(${parts.component},{children:[${parts.leading},`;
  const start = source.indexOf(fragment);
  if (start < 0 || source.indexOf(fragment, start + 1) >= 0) throw new Error('Picker sections fragment is missing or not unique');
  const at = source.indexOf(tail, start);
  if (at < 0) throw new Error('Picker sections tail not found');
  return source.slice(0, at) + ',' + sections + source.slice(at);
}

export function patchPickerSections(source, replaceOnce, symbols) {
  const {groupReturn, promotedAnchor, modelsVar, jsx, fmt, renderModel} = symbols;
  if (!source.includes('__withSubscriptionPickerSections(')) {
    source=replaceOnce(source, groupReturn, 'return __withSubscriptionPickerSections('+groupReturn.slice('return '.length)+')');
  }
  if (!source.includes('"chatgpt-subscription-models"')) {
    // titleTrailing is where Cursor puts "36% used" on its own section.
    const trailing=(name,base,key)=>',titleTrailing:'+usageTrailingArgument(name,jsx,base,key);
    const sections=
      modelsVar+'.chatgpt.length>0&&'+jsx+'('+fmt+',{models:'+modelsVar+'.chatgpt,title:"ChatGPT Subscription"'+trailing('chatgpt','__chatgptBridgeBase','__chatgptBridgeKey')+',renderModel:'+renderModel+'},"chatgpt-subscription-models"),'+
      modelsVar+'.claude.length>0&&'+jsx+'('+fmt+',{models:'+modelsVar+'.claude,title:"Claude Subscription"'+trailing('claude','__claudeBridgeBase','__claudeBridgeKey')+',renderModel:'+renderModel+'},"claude-subscription-models")';
    // From 3.31 the sections are list entries; trailing carries the usage.
    const entries = group => [
      `{id:"chatgpt-subscription-models",items:${group}.chatgpt??[],title:"ChatGPT Subscription",trailing:${usageTrailingArgument('chatgpt',jsx,'__chatgptBridgeBase','__chatgptBridgeKey')}}`,
      `{id:"claude-subscription-models",items:${group}.claude??[],title:"Claude Subscription",trailing:${usageTrailingArgument('claude',jsx,'__claudeBridgeBase','__claudeBridgeKey')}}`];
    source = symbols.sectionLists ? insertListSections(source, entries)
      : promotedAnchor ? replaceOnce(source, promotedAnchor, sections + ',' + promotedAnchor)
      : insertCompiledSections(source, replaceOnce, symbols, sections);
  }
  return source;
}
