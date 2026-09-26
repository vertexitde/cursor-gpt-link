// Cursor 3.20.17 can dispatch a local subagent before its legacy Task bubble
// exists in the Agents Window. Materialize that bubble through ToolFormer so
// the normal parent-linking barrier can observe it. Never signal a fake bubble.
export function ensureChatgptTaskBubble(service, request, parent, taskType, Params, capabilityType) {
  if (!parent || typeof request.modelId !== 'string' || !request.modelId.startsWith('chatgpt-codex/')) return;
  request.abortSignal?.throwIfAborted();
  const model = parent.data?.modelConfig;
  const ids = [model?.modelName, ...(model?.selectedModels ?? []).map(entry => entry.modelId)];
  if (!ids.some(id => typeof id === 'string' && id.startsWith('chatgpt-codex/'))) return;
  service.loadComposerCapabilities?.(parent);
  const toolFormer = service.getComposerCapability(parent, capabilityType);
  if (!toolFormer || toolFormer.getBubbleIdByToolCallId(request.toolCallId) !== undefined) return;
  const name = request.subagentType || 'general-purpose';
  toolFormer.getOrCreateBubbleId({
    toolCallId:request.toolCallId, toolIndex:0, modelCallId:'', toolCallType:taskType, name:'task_v2',
    params:{case:'taskV2Params', value:new Params({description:name, prompt:request.prompt ?? '',
      subagentType:name, name, model:request.modelId, mode:request.mode})}
  });
}

// Minified identifiers per reviewed build. Each entry names the id-trimming
// helper, the Task tool-call type, its parameter message and the capability.
const bubbleSymbols = {
  '3.20.17': {desktop:{trim:'BK', task:'Xe.TASK_V2', params:'$Be', former:'Xr.TOOL_FORMER'},
              glass:  {trim:'Roe',task:'vt.TASK_V2', params:'O7e', former:'Zs.TOOL_FORMER'}},
  '3.20.21': {desktop:{trim:'FK', task:'Xe.TASK_V2', params:'UBe', former:'Xr.TOOL_FORMER'},
              glass:  {trim:'Ioe',task:'vt.TASK_V2', params:'L7e', former:'Zs.TOOL_FORMER'}},
  '3.20.23': {desktop:{trim:'FK', task:'Xe.TASK_V2', params:'BBe', former:'Xr.TOOL_FORMER'},
              glass:  {trim:'Aoe',task:'vt.TASK_V2', params:'F7e', former:'Zs.TOOL_FORMER'}},
  '3.21.1':  {desktop:{trim:'$K', task:'Je.TASK_V2', params:'LBe', former:'es.TOOL_FORMER'},
              glass:  {trim:'yoe',task:'St.TASK_V2', params:'f7e', former:'to.TOOL_FORMER'}},
  '3.21.9':  {desktop:{trim:'$K', task:'Je.TASK_V2', params:'PBe', former:'es.TOOL_FORMER'},
              glass:  {trim:'voe',task:'St.TASK_V2', params:'v7e', former:'to.TOOL_FORMER'}},
  '3.21.12': {desktop:{trim:'$K', task:'Je.TASK_V2', params:'PBe', former:'es.TOOL_FORMER'},
              glass:  {trim:'voe',task:'St.TASK_V2', params:'_7e', former:'to.TOOL_FORMER'}},
  '3.21.13': {desktop:{trim:'VK', task:'Je.TASK_V2', params:'PBe', former:'Jr.TOOL_FORMER'},
              glass:  {trim:'voe',task:'yt.TASK_V2', params:'_7e', former:'to.TOOL_FORMER'}},
  '3.21.16': {desktop:{trim:'VK', task:'Je.TASK_V2', params:'PBe', former:'ts.TOOL_FORMER'},
              glass:  {trim:'boe',task:'yt.TASK_V2', params:'_7e', former:'to.TOOL_FORMER'}},
  '3.21.18': {desktop:{trim:'VK', task:'Je.TASK_V2', params:'LBe', former:'ts.TOOL_FORMER'},
              glass:  {trim:'_oe',task:'yt.TASK_V2', params:'_7e', former:'to.TOOL_FORMER'}},
  '3.22.5': {desktop:{trim:'cY', task:'Ze.TASK_V2', params:'n5e', former:'rs.TOOL_FORMER'},
              glass:  {trim:'eae',task:'yt.TASK_V2', params:'iUe', former:'io.TOOL_FORMER'}},
  '3.22.9': {desktop:{trim:'cY', task:'Ze.TASK_V2', params:'n5e', former:'rs.TOOL_FORMER'},
              glass:  {trim:'eae',task:'yt.TASK_V2', params:'rUe', former:'so.TOOL_FORMER'}},
};

export function patchSubagentBubbles(source, surface, version = '3.20.17') {
  const desktop = surface === 'desktop';
  if (!desktop && surface !== 'glass') throw new Error('Unknown workbench surface');
  const request = desktop ? 'e' : 't', parent = desktop ? 't' : 'e';
  const symbols = bubbleSymbols[version]?.[surface];
  if (!symbols) throw new Error('Unsupported subagent bubble version');
  const trim = symbols.trim;
  const anchor = 'async _waitForParentTaskBubbleIfPossible('+request+'){const '+parent+'='+trim+'('+request+'.parentConversationId),n='+trim+'('+request+'.toolCallId);if(!'+parent+'||!n)return;const i=this._composerDataService.getHandleIfLoaded('+parent+');';
  if (source.split(anchor).length !== 2) throw new Error('Subagent bubble anchor is not unique: '+surface);
  const call = '__ensureChatgptTaskBubble(this._composerDataService,'+request+',i,'+symbols.task+','+symbols.params+','+symbols.former+');';
  return ensureChatgptTaskBubble.toString().replace('function ensureChatgptTaskBubble','function __ensureChatgptTaskBubble')+'\n'+source.replace(anchor,anchor+call);
}
