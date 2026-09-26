// What this link contributes to an agent runtime, on the client and on an SSH
// host. The marker is what this provider leaves behind, so a second link can
// patch the same file without tripping over the first one's work.
import {wrapRuntime} from './patches-runtime.mjs';
import {patchSubagentModel} from './subagent-model.mjs';
import {patchSubagentSettingsRuntime} from './subagent-settings.mjs';
import {patchConversationActionsRuntime} from './conversation-actions.mjs';

export const link = 'cursor-gpt-link';
export const prefix = 'chatgpt-codex/';
export const marker = 't.startsWith("chatgpt-codex/")';

export function patchRuntime(source) {
  return patchConversationActionsRuntime(patchSubagentSettingsRuntime(patchSubagentModel(wrapRuntime(source))), prefix);
}
