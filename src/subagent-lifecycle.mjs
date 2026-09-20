// Shared by both links. A combined install adds its provider prefix once.
export function subscriptionComposer(service, id, prefixes) {
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const data = service.getHandleIfLoaded(id)?.data;
    if (!data) return false;
    const models = [data.modelConfig?.modelName, ...(data.modelConfig?.selectedModels ?? []).map(m => m.modelId)];
    if (models.some(model => typeof model === 'string' && prefixes.some(prefix => model.startsWith(prefix)))) return true;
    id = data.subagentInfo?.parentComposerId;
  }
  return false;
}

export function subscriptionRequest(service, request, prefixes) {
  return prefixes.some(prefix => request.modelId?.startsWith(prefix)) ||
    subscriptionComposer(service._composerDataService, request.parentConversationId, prefixes);
}

export function subscriptionRequestSignal(service, request) {
  const parent = service._composerDataService.getHandleIfLoaded(request.parentConversationId)?.data;
  const parentSignal = service._aiService.streamingAbortControllers.get(parent?.chatGenerationUUID)?.signal;
  const signals = [request.abortSignal, parentSignal].filter(Boolean);
  return signals.length ? AbortSignal.any(signals) : undefined;
}

export async function createSubscriptionSubagent(service, request, prefixes) {
  if (!subscriptionRequest(service, request, prefixes)) return service._subscriptionNativeCreateSubagent(request);
  const signal = subscriptionRequestSignal(service, request);
  signal?.throwIfAborted();
  const handle = await service._subscriptionNativeCreateSubagent({...request, abortSignal:signal});
  if (signal?.aborted) {
    service.cancelSubagentTree(handle.data.composerId);
    signal.throwIfAborted();
  }
  return handle;
}

export async function runSubscriptionSubagent(service, request, handle, options, prefixes) {
  if (!subscriptionRequest(service, request, prefixes)) return service._subscriptionNativeRunSubagent(request, handle, options);
  const signal = subscriptionRequestSignal(service, request);
  if (signal?.aborted) {
    const id = handle.data.composerId;
    service.cancelSubagentTree(id);
    service._terminationReasonByComposerId.set(id, 'aborted');
    service._composerDataService.updateComposerDataSetStore(handle, set => {
      set('status', 'aborted'); set('generatingBubbleIds', []);
    });
    return {success:false, composerId:id, error:'Subagent was aborted by the user', terminationReason:'aborted'};
  }
  return service._subscriptionNativeRunSubagent({...request, abortSignal:signal}, handle, options);
}

// Hydrate a bounded recent tail as soon as a transcript is attached. Keep the
// native loader responsible for persistence, placeholders and live message merges.
export function warmSubscriptionTranscript(source, prefixes) {
  const service = source.composerDataService;
  const data = service.getComposerData(source.composerHandle);
  if (!data?.subagentInfo || !subscriptionComposer(service, source.composerId, prefixes) || source.__subscriptionTailLoad) return;
  const ids = (data.fullConversationHeadersOnly ?? []).slice(-64).map(h => h.bubbleId)
    .filter(id => !data.conversationMap?.[id] || data.conversationMap[id].isPlaceholder);
  if (!ids.length) return;
  source.__subscriptionTailLoad = Promise.resolve().then(() => {
    if (!source.__subscriptionDisposed) return source.loadBubbles(ids);
  }).then(() => {
    if (source.__subscriptionDisposed) return;
    source.cachedConversationMapRef = undefined;
    for (const id of ids) source.notifyBubbleListeners(id);
  }).catch(error => {
    service._logService?.warn('[subscription-link] Could not hydrate the subagent transcript', error);
  }).finally(() => { source.__subscriptionTailLoad = undefined; });
  return source.__subscriptionTailLoad;
}

function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Subagent lifecycle anchor is not unique: ' + before.slice(0,100));
  return source.replace(before, after);
}

// Minified identifiers per reviewed build: the subagent service used to cancel a
// tree, and the untracked reader around the transcript conversation map.
const lifecycleSymbols = {
  '3.20.21': {desktop:{service:'SZe', untrack:'tr'}, glass:{service:'Cde', untrack:'cs'}},
  '3.20.23': {desktop:{service:'yZe', untrack:'tr'}, glass:{service:'Tde', untrack:'cs'}},
  '3.21.1':  {desktop:{service:'hZe', untrack:'Xi'}, glass:{service:'ude', untrack:'Kr'}},
  '3.21.9':  {desktop:{service:'pZe', untrack:'Xi'}, glass:{service:'lde', untrack:'Qr'}},
  '3.21.12': {desktop:{service:'pZe', untrack:'Xi'}, glass:{service:'lde', untrack:'Jr'}},
  '3.21.16': {desktop:{service:'mZe', untrack:'Ki'}, glass:{service:'cde', untrack:'Xr'}},
  '3.21.13': {desktop:{service:'pZe', untrack:'Xi'}, glass:{service:'lde', untrack:'Jr'}},
};

export function patchSubagentLifecycle(source, surface, prefix, version='3.20.21') {
  if (!['desktop','glass'].includes(surface)) throw new Error('Unknown workbench surface');
  if (!['chatgpt-codex/','claude-subscription/'].includes(prefix)) throw new Error('Unknown subscription provider');
  const registry = /var __subscriptionSubagentPrefixes=(\[[^;]+\]);/;
  const existing = source.match(registry);
  if (existing) {
    const prefixes = [...new Set([...JSON.parse(existing[1]), prefix])];
    return source.replace(registry, 'var __subscriptionSubagentPrefixes='+JSON.stringify(prefixes)+';');
  }
  const desktop = surface === 'desktop', arg = desktop ? 'e' : 't', handle = desktop ? 't' : 'e';
  const symbols = (lifecycleSymbols[version] ?? lifecycleSymbols['3.20.21'])[surface];
  const serviceId = symbols.service, untrack = symbols.untrack;
  const own = 'subscriptionComposer(this._composerDataService,'+arg+',__subscriptionSubagentPrefixes)';
  source = once(source, 'async stopSubagentTree('+arg+'){',
    'async stopSubagentTree('+arg+'){if('+own+'){this.cancelSubagentTree('+arg+');return;}');
  // Stop descendants even when the parent itself has already finished its turn.
  const cancel = 'const n=this.composerDataService.getComposerData('+handle+'),i=n!==void 0&&(n.status==="generating"||n.conversationActionManager!==void 0);';
  source = once(source, cancel, cancel+'if(subscriptionComposer(this.composerDataService,'+arg+',__subscriptionSubagentPrefixes))this.instantiationService.invokeFunction(s=>s.get('+serviceId+')).cancelSubagentTree('+arg+');');
  source = once(source, 'async createOrResumeSubagent('+arg+'){',
    'async createOrResumeSubagent('+arg+'){return createSubscriptionSubagent(this,'+arg+',__subscriptionSubagentPrefixes)}async _subscriptionNativeCreateSubagent('+arg+'){');
  source = once(source, 'async _runSubagent('+arg+','+handle+',n){',
    'async _runSubagent('+arg+','+handle+',n){return runSubscriptionSubagent(this,'+arg+','+handle+',n,__subscriptionSubagentPrefixes)}async _subscriptionNativeRunSubagent('+arg+','+handle+',n){');
  // This object survives a switch while its conversationMap can be replaced.
  const stale = '(n===void 0||n.composer!=='+handle+')&&(n={composer:'+handle+',map:'+untrack+'(()=>'+handle+'.conversationMap)},this.cachedConversationMapRef=n);';
  source = once(source, stale, stale.replace(')&&(n=', '||('+handle+'.subagentInfo&&subscriptionComposer(this.composerDataService,this.composerId,__subscriptionSubagentPrefixes)&&n.map!=='+untrack+'(()=>'+handle+'.conversationMap)))&&(n='));
  // There are several transcript implementations; anchor the Solid composer one.
  // Cursor 3.21.1 returns an empty disposable when the store is already gone;
  // do not hydrate through a disposed store.
  const matches = [...source.matchAll(/subscribeHeaders\((\w+)\)\{return (this\._store\.isDisposed\?[\w$]+\.None:)?([\w$]+)\(\(\)=>\{const (\w+)=this.getComposerDataForReactiveTracking\(\);/g)];
  if (matches.length !== 1) throw new Error('Transcript subscription anchor is not unique');
  const warm = 'warmSubscriptionTranscript(this,__subscriptionSubagentPrefixes);';
  const hydrate = matches[0][2] ? 'if(!this._store.isDisposed)'+warm : warm;
  source = once(source, matches[0][0], matches[0][0].replace('{return ', '{'+hydrate+'return '));
  source = once(source, 'dispose(){this.editDisplayCache.clear(),', 'dispose(){this.__subscriptionDisposed=true;this.editDisplayCache.clear(),');
  return 'var __subscriptionSubagentPrefixes='+JSON.stringify([prefix])+';\n'+
    [subscriptionComposer, subscriptionRequest, subscriptionRequestSignal, createSubscriptionSubagent, runSubscriptionSubagent, warmSubscriptionTranscript].map(fn=>fn.toString()).join('\n')+'\n'+source;
}
