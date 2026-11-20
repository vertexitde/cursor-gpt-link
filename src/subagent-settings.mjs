// Keep Cursor's native mode and model resolver. Only supply the model IDs and
// parameters that its local runtime otherwise drops from the UI selection.
export function selectedModelIds(existing, overrides, parentModelId) {
  if(!parentModelId?.startsWith('chatgpt-codex/'))return existing;
  const selected=(overrides??[]).filter(o=>o.subagentType==='explore'&&o.selection?.case==='model')
    .map(o=>o.selection.value?.modelId).filter(id=>typeof id==='string'&&id.trim()&&id!=='default');
  return [...new Set([...existing,...selected])];
}
export function configureTaskProps(input, props) {
  if(!input.modelId?.startsWith('chatgpt-codex/'))return props;
  const selected=input.subagentModelOverrides?.find(o=>o.subagentType==='explore'&&o.selection?.case==='model');
  const resolved=props.subagentModelOverrides?.explore;
  const parameters=selected?.selection.value?.parameters;
  return {...props,parentModelParameters:input.modelParameters,
    subagentModels:{...props.subagentModels,__ChatgptSelection:resolved?.type==='model'&&selected?
      {modelId:resolved.modelId,parameters:(parameters??[]).map(({id,value})=>({id,value}))}:undefined}};
}
export function selectedParameters(options, config, modelId, fallback) {
  if(!options.parentRequestedModelName?.startsWith('chatgpt-codex/'))return fallback;
  const selected=options.subagentModels?.__ChatgptSelection;
  return config.subagent_type?.type?.case==='explore'&&selected?.modelId===modelId&&config.userRequestedModelId===modelId
    ?selected.parameters:fallback;
}
function once(source, before, after) {
  if(source.split(before).length!==2)throw new Error('Subagent settings anchor is not unique: '+before.slice(0,100));
  return source.replace(before,after);
}
function definition(fn,name){return fn.toString().replace('function '+fn.name,'function '+name);}
export function patchSubagentSettingsWorkbench(source) {
  const pattern=/,([\w$]+)=([^;]+?localProviderAgentModelIds\?\?\[\][^;]*?),([\w$]+)=([\w$]+)\?\?this.createDefaultLocalModel\(([\w$]+)\)/g;
  const matches=[...source.matchAll(pattern)];
  if(matches.length!==1)throw new Error('Local subagent catalog anchor is not unique');
  const match=matches[0];
  const [, list, catalog, local, model, options]=match;
  return once(source,match[0],','+list+'=__ChatgptSelectedModelIds('+catalog+','+options+'.subagentModelOverrides,'+options+'.requestedModel?.modelId??'+model+'?.modelId),'+local+'='+model+'??this.createDefaultLocalModel('+options+')')
    +'\n'+definition(selectedModelIds,'__ChatgptSelectedModelIds')+'\n';
}
export function patchSubagentSettingsRuntime(source) {
  // Cursor 3.21.1 rotated the minified locals in both runtime bundles.
  // Up to 3.22 the nullish fallback is down-levelled (null!=r?r:…); from 3.24
  // the runtimes keep the native operator (r??…).
  const matches=[...source.matchAll(/function ([\w$]+)\(e\)\{const t=\(\)=>!1,([\w$]+)=[\w$]+\(e\)(?:,([\w$]+)=null!=\2\?\2:e\.localProvider|\?\?e\.localProvider);/g)];
  if(matches.length!==1)throw new Error('Local task configuration anchor is not unique');
  const match=matches[0],original=match[1];
  source=once(source,match[0],'function '+original+'(e){return __ChatgptConfigureTaskProps(e,__ChatgptNativeTaskProps(e))}'+match[0].replace('function '+original+'(','function __ChatgptNativeTaskProps('));
  const input=source.match(/modelId:([\w$]+)\.modelDetails\.modelId,(modelParameters:[\w$]+\.parameters,)?modelInfo:[\w$]+,localProvider:this\.options\.localProvider/);
  if(!input)throw new Error('Local task model input anchor missing');
  if(!input[2])source=once(source,input[0],input[0].replace(',modelInfo:',',modelParameters:'+input[1]+'.parameters,modelInfo:'));
  const params=[...source.matchAll(/return\{subagentConfig:([\w$]+),effectiveReadonly:[\s\S]{0,200}?resolvedModelId:([\w$]+),resolvedModelParameters:(.*?),subagentIdToResume:/g)];
  if(params.length!==1)throw new Error('Resolved subagent parameters anchor is not unique');
  const p=params[0];
  source=once(source,p[0],p[0].replace('resolvedModelParameters:'+p[3]+',subagentIdToResume:',
    'resolvedModelParameters:__ChatgptSelectedParameters(a,'+p[1]+','+p[2]+','+p[3]+'),subagentIdToResume:'));
  return source+'\n'+definition(configureTaskProps,'__ChatgptConfigureTaskProps')+'\n'+definition(selectedParameters,'__ChatgptSelectedParameters')+'\n';
}
