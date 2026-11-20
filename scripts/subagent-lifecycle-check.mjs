import assert from 'node:assert/strict';
import {subscriptionComposer} from '../src/subagent-lifecycle.mjs';

// Execute Cursor's extracted methods, not a rewritten approximation of them.
export async function verifySubagentLifecycle(source, prefixes) {
  // A method ends where its source first parses as one; the neighbours moved
  // in 3.31, so the parser decides instead of a landmark.
  function method(start) {
    const p=source.indexOf(start);
    assert.ok(p>=0,start+' found');
    for(let q=source.indexOf('}',p);q>=0&&q-p<200000;q=source.indexOf('}',q+1)){
      const candidate=source.slice(p,q+1);
      try{new Function('return ({'+candidate+'})');return candidate;}catch{}
    }
    assert.fail(start+' end found');
  }
  const cancelStart=source.includes('cancelChat(e){const t=this.composerDataService')?'cancelChat(e){const t=this.composerDataService':'cancelChat(t){const e=this.composerDataService';
  const methods=[method(cancelStart),
    method('async stopSubagentTree(', 'async _loadSubagentTreeForStop('),
    method('classifyBubble(', 'getBubbleLoadState(')];
  // cancelChat also has call sites earlier in the bundle.
  methods[0]=method(source.includes('cancelChat(e){const t=this.composerDataService')?'cancelChat(e){const t=this.composerDataService':'cancelChat(t){const e=this.composerDataService','async cancelCurrentStep(');
  assert.match(source,/if\(subscriptionComposer\(this.composerDataService,[\w$]+,__subscriptionSubagentPrefixes\)\)this.instantiationService.invokeFunction\(s=>s.get\([\w$]+\)\).cancelSubagentTree/,
    'Descendants are cancelled from the native stop path');
  // Every build and surface minifies the helpers these methods reach for under
  // different names. Resolve them through one stub: reactive readers are called
  // with a thunk and must return its value, predicates must stay falsy so the
  // local path is exercised, and service identities are never dereferenced.
  // From 3.25 classifyBubble keeps the raw composer next to the reactive one
  // (const r=xl(t);n={composer:t,rawComposer:r,…}); that unwrap is an identity.
  const unwrap=source.match(/const ([\w$]+)=([\w$]+)\([\w$]+\);[\w$]+=\{composer:[\w$]+,rawComposer:\1,/)?.[2];
  const scope=new Proxy({subscriptionComposer,__subscriptionSubagentPrefixes:prefixes,...(unwrap?{[unwrap]:value=>value}:{})},{
    has:()=>true,
    get:(target,key)=>key===Symbol.unscopables?undefined
      :key in target?target[key]:value=>typeof value==='function'?value():false});
  const native=new Function('__scope','with(__scope){return ({'+methods.join(',')+'})}')(scope);
  for(const prefix of prefixes) {
    const controllers=new Map(['parent','child','grandchild','unrelated'].map(id=>[id,new AbortController()]));
    const handles=new Map([...controllers.keys()].map(id=>[id,{data:{composerId:id,status:id==='parent'?'completed':'generating',modelConfig:{modelName:prefix+'test'},subagentComposerIds:id==='parent'?['child']:id==='child'?['grandchild']:[]}}]));
    const dataService={getHandleIfLoaded:id=>handles.get(id),getComposerData:h=>h.data};
    const cancelTree=id=>{controllers.get(id)?.abort();for(const child of handles.get(id)?.data.subagentComposerIds??[])cancelTree(child);};
    let hostCalls=0,loadCalls=0;
    const service={_composerDataService:dataService,composerDataService:dataService,
      cancelSubagentTree:cancelTree,instantiationService:{invokeFunction:fn=>fn({get:()=>({cancelSubagentTree:cancelTree})})},
      composerEventService:{fireDidComposerStopGenerating(){}},
      _loadSubagentTreeForStop:async()=>{loadCalls++;return new Map();},
      _interruptAgentHostSessionTree:async()=>{hostCalls++;}};
    native.cancelChat.call(service,'parent');
    assert.ok(controllers.get('child').signal.aborted);assert.ok(controllers.get('grandchild').signal.aborted);
    assert.equal(controllers.get('unrelated').signal.aborted,false);
    const stopped=native.stopSubagentTree.call(service,'unrelated');
    assert.equal(controllers.get('unrelated').signal.aborted,true,'Cancel happens before yielding');
    await stopped;assert.equal(loadCalls,0);assert.equal(hostCalls,0);
    const child=handles.get('child');child.data.subagentInfo={parentComposerId:'parent'};
    child.data.fullConversationHeadersOnly=[{bubbleId:'message'}];child.data.conversationMap={};
    const transcript={composerId:'child',composerHandle:child,composerDataService:dataService,
      getHeaderBubbleIdSet:()=>new Set(['message'])};
    assert.equal(native.classifyBubble.call(transcript,'message').status,'unloaded');
    child.data.conversationMap={message:{text:'Hydrated after switching chats'}};
    assert.equal(native.classifyBubble.call(transcript,'message').bubble.text,'Hydrated after switching chats');
  }
  console.log('Native subagent lifecycle: idle-parent cascade, immediate local stop and transcript cache refresh passed.');
}
