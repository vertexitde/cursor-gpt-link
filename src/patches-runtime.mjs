import {patchFusionRuntime} from './fusion.mjs';
// The reasoning and Fast forwarding for the extension runtimes. Shared so the
// same code patches the client bundles and, through scripts/install-remote.mjs,
// the copy under ~/.cursor-server on an SSH host.
function replaceOnce(source,from,to){
  if(source.split(from).length!==2)throw new Error('Patch anchor not unique: '+from.slice(0,100));
  return source.replace(from,to);
}

export function wrapRuntime(runtime){
  if(runtime.includes('t.startsWith("chatgpt-codex/")'))return runtime;
  // Cursor 3.21.1 rotated the minified locals and the two runtime bundles no
  // longer agree on them, so read the parameter list variable off the anchor.
  // The Fusion branch, when the other link added it, sits between the two.
  const anchor=runtime.match(/\}\(([\w$]+)\);(?:if\(typeof t==="string"&&\/\^\(chatgpt-codex\|claude-subscription\)\\\/fusion\$\/\.test\(t\)\)\{[^}]*\})?if\(typeof t==="string"&&t\.startsWith\("claude-subscription\/"\)/)
    ??runtime.match(/\}\(([\w$]+)\);if\(void 0===a\)return;if\(void 0!==i&&"openai_compatible"===[\w$]+\)/);
  const branch=params=>'if(typeof t==="string"&&t.startsWith("chatgpt-codex/")){const selected='+params+'?.find(p=>p.id==="reasoning")?.value;if(selected!==undefined){e.reasoning={...e.reasoning,effort:selected};delete e.reasoning_effort}const fast='+params+'?.find(p=>p.id==="fast")?.value;if(fast==="true")e.service_tier="priority";else delete e.service_tier;return}';
  if(anchor){
    const params=anchor[1];
    return patchFusionRuntime(replaceOnce(runtime,anchor[0],'}('+params+');'+branch(params)+anchor[0].slice(('}('+params+');').length)),params);
  }
  // Any order of the links: on an SSH host the other links may already have
  // put their branches here. The effort normalisation that ends right before
  // all of them is the same in every state.
  const all=[...runtime.matchAll(/"none"===([\w$]+)\?void 0:\1\}\(([\w$]+)\);/g)];
  if(all.length!==1)throw new Error('Reasoning effort anchor missing');
  const params=all[0][2];
  return patchFusionRuntime(replaceOnce(runtime,all[0][0],all[0][0]+branch(params)),params);
}
