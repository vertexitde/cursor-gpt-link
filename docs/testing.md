# Testing notes

Updated on September 26, 2026.

## Environment

| Component | Version |
| --- | --- |
| Operating system | Windows, x64 |
| Cursor | 3.22.9, 3.22.5, 3.21.18, 3.21.16, 3.21.13, 3.21.12, 3.21.9, 3.21.1, 3.20.23, 3.20.21, 3.20.17, 3.20.11 and 3.20.7 |
| Cursor 3.22.9 commit | `2ca0f45baa06796a86f6c6ba2b9bedacaf94c370` |
| Cursor 3.22.5 commit | `a00aa8754ab5bae70b637d98e126f9dbd4e1e5d0` |
| Cursor 3.21.18 commit | `c4730f7d93d787d9ab120af715999f0345ee5bc0` |
| Cursor 3.21.16 commit | `8ae78e8eee1e63479c7e0504b664bc0a80c68000` |
| Cursor 3.21.13 commit | `e44a49c17e334d442e58bbde931d791200f014a0` |
| Cursor 3.21.12 commit | `05ddb9e824590e2c1db6bd2548dd71bf67ac9d20` |
| Cursor 3.21.9 commit | `9998796a6096ce83d83a9332bfe7473b985db750` |
| Cursor 3.21.1 commit | `74f717017ddcbf0554cd8c91ec7e2fb56983a070` |
| Cursor 3.20.23 commit | `b23e0e2d3c0fc9bb9311f4390230a120ccc9aa50` |
| Cursor 3.20.21 commit | `f09fca384ceca23f7bf21f9c23655b162641d740` |
| Cursor 3.20.17 commit | `0c32194e3fb5ffaced9fb36430b860ec301e1fc0` |
| Cursor 3.20.11 commit | `69d099d6568dc97e110ba8184614faf51c4040b0` |
| Cursor 3.20.7 commit | `979197d5570b168c034c634b3e21f2bea3ea5be0` |
| Node.js | 26.7.0 |
| Codex CLI | 0.153.4 |

The original JavaScript hashes are recorded in [the 3.20.7 metadata](../src/supported-build.json) and [the 3.20.11 metadata](../src/supported-build-3.20.11.json). File hashes are used because the same version label is not sufficient to establish that minified patch anchors are compatible.

## Remote runtime patch

The four runtime-side repairs run wherever the agent runs, so a remote session needs them on the host. `scripts/install-remote.mjs` reads the two extension bundles from `~/.cursor-server/bin/<platform>/<commit>` over ssh, applies the same patch functions the local installer uses, checks the result with `node --check` on the client and writes it back by rename. Each file keeps its untouched copy as `main.js.cursor-links-original`, and one shared manifest records the pristine and patched hashes plus which links are installed.

Verified on a live host on September 26, 2026: all three links installed in order on the same build as the client, the shared registry in the host's bundle listing `chatgpt-codex/`, `claude-subscription/` and `inception-mercury/`, and both originals preserved. What sent us looking was a real failure on that host: a `task_v2` call with no `model` was rejected by the unpatched runtime with *Invalid model selection ""*, while the retry that named a model explicitly succeeded.


On a Windows host every command travels as an encoded PowerShell script, because the default shell there is cmd and quoting through it is a trap. Verified against a live Windows server on September 26, 2026: PowerShell 5, the same `binwin32-x64<commit>` layout, and a round trip of 200,000 characters with non-ASCII, quotes and backslashes that came back byte for byte with a matching hash.

Not yet confirmed: a remote turn against the patched host.

## Remote sessions, changed in 3.22.9

The patch used to force a remote session into Cursor's dedicated UI runtime so that the bridge on the client's loopback stayed reachable. That runtime has no notion of a remote workspace: `isRemote`, `remotePlatform`, `pathStyle` and `remoteAuthority` do not appear in its bundle at all, and it resolves paths with the client's own path module. The renderer hands it the workspace path in the host's own form (`BP(uri, true, isRemote)` turns the separators back into slashes), so a Windows client against a Linux host produced:

| Call | Result on a Windows client |
| --- | --- |
| `resolve("/srv/app")` | `C:\srv\app` |
| `resolve("/srv/app", "src/main.ts")` | `C:\srv\app\src\main.ts` |
| `join("/srv/app", "src/main.ts")` | `\srv\app\src\main.ts` |

The runtime does not only format those strings, it uses them: the workspace boundary check for every tool call, `.cursor/rules` discovery, `git rev-parse --git-common-dir` with that directory as `cwd`, the ignore-file walk up to the drive root, and the `.git` probe that builds the sandbox policy. Anything routed back through the renderer worked, anything the runtime resolved itself did not.

From 3.22.9 the agent therefore runs on the SSH host, which is Cursor's own arrangement: the agent-exec provider is registered per remote authority and implements `runLocalAgent` itself. The provider configuration is resolved in the renderer and travels with the request, so the host receives the bridge address and reaches it through the ssh reverse forward.

Verified without touching an installation, against copies of the original 3.22.9 bundles:

- the reproduction above, run against Node's win32 path implementation;
- the patched workbench no longer contains `__useChatgptDedicatedRuntime` and leaves the native dedicated-runtime decision alone, while the run gate for subscription models stays;
- the routing check now expects a remote subscription model to take the same route as an ordinary one, and passes on both surfaces;
- the `~/.ssh/config` writer has unit tests for the block format, three links sharing one block, repeated installs, removal restoring the file byte for byte, an explicit host list and a malformed block being refused;
- a dry run on a copy of a real configuration, with `ssh -G` used to confirm that OpenSSH parses the result, attaches the three forwards to a configured host and leaves an unrelated host without any.

Not yet confirmed: a live remote turn. The host's own runtime under `~/.cursor-server` is unpatched, so reasoning effort forwarding and the subagent model repairs are missing there.

## Cursor 3.22.9 update

Cursor 3.22.9 renamed symbols again and changed nothing else: 16 of 50 in the editor, 31 of 50 in the Agents Window. The anchors the minor release had moved a build earlier, the model map and `subscribeHeaders`, stayed as 3.22.5 left them, and both runtime bundles are unchanged. The extractor reproduced every reviewed 3.22.5 value before it was used here. All automated checks pass and the three patches were installed together on a local 3.22.9. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.22.5 update

Cursor 3.22.5 is the first minor release these patches have been carried across, and it renamed more than four fifths of the derived symbols: 42 of 50 in the editor and 41 of 50 in the Agents Window. Two things changed beyond the names. The default model map renamed both its prefix binding and its mapper, which every build since 3.20 had left alone. And `subscribeHeaders` was rewritten: the disposed-store check is now an early return instead of a ternary, and the reactive read the old anchor matched on is gone. The shared subagent lifecycle module now recognises both shapes and hydrates the transcript after the new guard, so the older supported builds keep their original treatment. Everything else, including both runtime bundles, needed no change. All automated checks pass and the three patches were installed together on a local 3.22.5. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.21.18 update

Cursor 3.21.18 renamed the obfuscated workbench symbols again, this time 11 of 50 in the editor and 13 of 50 in the Agents Window; the anchored code and both runtime bundles are unchanged. The extractor reproduced every reviewed 3.21.16 value unchanged before it was used on this build. The recycled name this time sits in the Plan & Usage card itself: the Agents Window identifier that rendered the card in 3.21.16 is the card's useEffect alias in 3.21.18, so a symbol-by-symbol substitution would have swapped the two. All automated checks pass and the three patches were installed together on a local 3.21.18. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.21.16 update

Cursor 3.21.16 renamed the obfuscated workbench symbols again, and again left the anchored code and both runtime bundles untouched. Half the workbench symbols changed on each surface. The extractor was rebuilt for this port and first had to reproduce every reviewed 3.21.13 value before it was used here. Recycled names showed up once more: the editor identifier that pointed at the Google dashboard link in 3.21.13 is the settings card's useEffect alias in 3.21.16, so replacements are made on whole anchors rather than symbol by symbol. All automated checks pass and the three patches were installed together on a local 3.21.16. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.21.13 update

Cursor 3.21.13 renamed the obfuscated workbench symbols again; the anchored code is unchanged and the runtime bundles needed no change. The extractor was validated against the reviewed 3.21.12 values before this build was derived. Recycled names caught the eye again: the editor identifier that meant the tool-former capability here was the untracked reader in the Agents Window a build earlier, which is why whole anchors are replaced rather than single symbols. All automated checks pass and the three patches were installed together on a local 3.21.13. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.21.12 update

Cursor 3.21.12 renamed the obfuscated workbench symbols again; the code the patches anchor to is unchanged. The symbols were re-derived by role and the extractor was validated against the reviewed 3.21.9 values before it was trusted with this build. Names are recycled between builds, so replacements are made on whole anchors rather than symbol by symbol: in the editor bundle the identifier that meant useState in 3.21.9 means useEffect in 3.21.12. The runtime bundle anchors needed no change. All automated checks pass, and the three patches were installed together on a local 3.21.12. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.21.9 update

Reviewed on September 17, 2026 against commit `9998796a6096ce83d83a9332bfe7473b985db750`. Both workbenches renamed their minified identifiers; the anchored code is structurally unchanged. The workbench symbols were derived with a script that locates each one by the role it plays (picker sections, default model mapping, local run gate, dedicated runtime host, activation, Plan & Usage card and hooks, login action registration, Task bubble types and subagent service). Run against the pristine 3.21.1 bundles, the script reproduced every symbol reviewed for that build before it was trusted with 3.21.9. The runtime bundle anchors, which read their symbols from the match since 3.21.1, needed no change.

The automated checks pass on 3.21.9 for both workbench bundles and both runtime bundles, with the same coverage as 3.21.1. Both patches were installed together on a local 3.21.9, ChatGPT first and Claude second. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.21.1 update

Reviewed on September 16, 2026 against commit `74f717017ddcbf0554cd8c91ec7e2fb56983a070`. Both workbenches renamed their minified identifiers again, and this time both agent runtime bundles also rotated their minified locals: the name sequence moved from `e,t,n,r,o,s` to `e,t,r,n,o,s`, and the two bundles no longer agree with each other. That broke every literal anchor and several regex anchors that had pinned those names, so the affected patches now read their symbols out of the anchor match instead: the reasoning branch, the local API type heuristic, the conversation action receiver and its protobuf namespace, the plan initializer, the local task configuration and the subagent model resolver.

Both runtime bundles were also re-chunked. `main.js` shrank from 10.08 MB to 8.48 MB (agent-exec) and from 8.83 MB to 5.95 MB (local-agent-runtime), with the remainder moved into numbered webpack chunks beside it. Every patched anchor still lives in `main.js`.

One behavioural change: `subscribeHeaders` now returns an empty disposable when its store is already disposed. The transcript warm-up is no longer run through a disposed store.

The automated checks pass on 3.21.1 for both workbench bundles and both runtime bundles: syntax and unique anchors, subscription settings rendering and login action registration, the native action manager, the Max toggle and context budget, the subagent lifecycle, the subagent registration barrier, the native subagent model resolver, Explore settings, reasoning forwarding and the workbench checksum. Checks that previously pinned one bundle’s minified names were widened to resolve their dependencies by role.

Both patches were installed together on a local 3.21.1, ChatGPT first and Claude second. Cursor started with no workbench errors in its logs, and both bridges answered with their model catalogs. Live model selection, tool calls, file edits, remote SSH and attachment workflows have not been confirmed on this build.

## Cursor 3.20.23 update

Reviewed on September 15, 2026 against commit `b23e0e2d3c0fc9bb9311f4390230a120ccc9aa50`. Both workbenches changed their minified identifiers. The picker, subscription usage components, dedicated-runtime activation, Task parameters and subagent service bindings were checked against the new source. The two agent runtime bundles only changed their privacy schema and build metadata; existing runtime patch anchors remain valid.

The following controlled checks passed:

- All 63 ChatGPT and 65 Claude unit tests, plus source checks.
- Exact original hashes, unique anchors and JavaScript syntax for all generated bundles.
- Native SSH routing, Task registration, Explore model selection, inheritance and restrictions.
- Immediate local stop, parent cancellation, transcript refresh, queued delivery and Plan-to-Build message forwarding.
- Context and MAX switching with effort preserved; ChatGPT Fast forwarding and Claude context forwarding.
- Subscription settings rendering against the actual native hooks and card components, and ChatGPT login command registration in both workbenches.
- Standalone and combined installations, linked manifest hashes and exact restoration of every original file.
- ChatGPT native build checks against 3.20.21 to check backward compatibility.

These checks execute extracted native functions with controlled dependencies. They do not prove a complete live SSH session or every UI interaction. After installing both patches and starting Cursor 3.20.23, short live requests completed in the Agents Window with Claude Opus 5 High and GPT-6 Astra Medium (272K). Switching from Claude to ChatGPT in the same test conversation also worked. These prompts deliberately requested no tools or file changes. Fresh IDE, remote SSH, attachment and full subagent workflow checks remain pending for this build. Both installed manifests and backup hashes were verified. Native Responses-adapter error and tool-call checks also passed against both installed runtime bundles. Original build hashes are recorded in [the build metadata](../src/supported-build-3.20.23.json).

## Cursor 3.20.21 update

On September 14, 2026, the patch anchors and referenced symbols were reviewed against Cursor commit `f09fca384ceca23f7bf21f9c23655b162641d740`. The model mapper, picker renderer, usage components, dedicated-runtime activation and Task bubble parameters have new identifiers. Version-specific definitions preserve support for the preceding builds.

The following checks passed against local copies of the exact new bundles:

- Unique patch anchors and JavaScript syntax in both workbenches, both agent runtimes and the main process.
- Native SSH routing with workspace execution resources and cancellation preserved.
- Reasoning and Fast forwarding for ChatGPT, and effort plus 200K/1M context forwarding for Claude.
- Native subagent registration and model inheritance, including reproductions of the missing Task bubble and empty model failures.
- Both native Responses adapters with timeout, sign-in and quota errors, plus a successful tool call. The probe now accepts native identifiers containing a dollar sign.
- Standalone Claude, standalone ChatGPT, and combined installations; linked hashes and exact restoration of the original files after uninstall.

Both patches were installed locally after those checks. Installed-file and backup hashes matched. The ChatGPT native build checks and Claude Responses-adapter checks were also repeated successfully against Cursor 3.20.17. These are controlled automated checks; a fresh manual IDE, Agents Window and SSH test remains pending for 3.20.21.

The reviewed 3.20.21 hashes are in [the build metadata](../src/supported-build-3.20.21.json).

## Cursor 3.20.17 update

On September 12, 2026, the model mapping, picker rendering, usage-card components and local routing symbols were reviewed against the new desktop and Agents Window bundles. The new definitions check the exact commit and original file hashes, including `product.json`.

Candidate syntax, unique anchors, both native SSH routing methods, reasoning and Fast forwarding, and the workbench checksum passed. Installation together with Claude was checked on a separate local copy before installing both patches in Cursor. Linked installation manifests and original-file backups passed hash verification. These checks preserve the workspace execution resources and cancellation signal. A fresh manual IDE and Agents Window test, including SSH, is still pending for this build.

The reviewed hashes are in [the 3.20.17 metadata](../src/supported-build-3.20.17.json).

## Automated checks

All 32 public unit tests passed locally. They cover partial model refreshes, explicit model hiding, account-separated saved catalogs, supported reasoning and Fast combinations, the default speed setting, request normalization, unsupported settings, local bearer authentication and browser-origin rejection. Installation tests verify exact restoration, refusal of changed application files or damaged backups, and resuming an interrupted restore. Remote routing tests check runtime selection, extension activation and preservation of workspace resources and cancellation signals in both workbenches. Additional checks cover the icon labels, subscription usage mapping, quota errors, and exact bridge-process selection on restart. Tests use synthetic data without access to a real account.

The GitHub workflow runs this suite on Windows with Node.js 22, 24 and 26. These unit jobs do not contain or test a real Cursor installation.

Local build verification uses original files from the tested installation. It checks unique patch anchors and JavaScript syntax in both workbenches, both local runtimes and the main process. It invokes each patched runtime's parameter normalizer for Low, Medium, High, Very high, Max and Ultra, with Fast both on and off, and checks the desktop workbench checksum.

## Live checks on the preceding local prototype

These checks exercised the same bridge protocol and runtime hooks before packaging this public release. They are not claims of an end-to-end public installer or UI test.

* A GPT-6 Astra text request completed through the bridge.
* A function tool call with arguments 19 and 23 completed; returning 42 to the model completed the follow-up response.
* Installed file hashes matched the private prototype's installation manifest.
* Runtime parameter forwarding passed for both `cursor-agent-exec` and `cursor-local-agent-runtime`.

The streaming tool test collected `response.output_item.done` events. In these checks, `response.completed.output` was empty, so checking only that final output array would miss the streamed result.

## Manual Cursor testing

On September 10, 2026, the project owner reported successful tool calls and file edits in local Cursor usage. This confirms that those operations work in the tested setup, beyond the earlier standalone bridge checks.

The report did not identify which window was used or establish separate coverage of the IDE and Agents Window. Approvals and cancellation were not reported separately.

Remote SSH initially failed because model requests ran in the remote workspace extension host and tried to reach the bridge through the remote machine's loopback address. The 0.1.1 fix enables Cursor's existing dedicated local runtime and selects it for ChatGPT models in remote workspaces. Tool execution continues through the existing workspace resources.

After applying this fix and reloading the SSH window, the project owner confirmed that both responses and remote file edits work. No remote Codex installation, remote ChatGPT sign-in or SSH port forwarding was needed. This confirms the tested SSH setup; it does not establish coverage of every remote configuration or both window types.

The local build verification also executes the actual patched routing method extracted from each workbench with synthetic services. It verifies that ChatGPT SSH turns use the local runtime with the original workspace resources and cancellation signal, while local sessions and ordinary models preserve their existing routing.

## Fast processing

Priority requests were tested with Astra, Sol, Terra, Luna and GPT-5.5. The service reported `default`, including for a direct request outside the bridge. Sending the literal API field `service_tier: "fast"` was rejected. The patch sends `priority`.

The UI control and request field work, but faster processing and its usage multiplier are unverified. A test requiring a `priority` or `fast` response tier did not pass. This remains an open limitation, not a successful Fast test.

## Still to verify

* Separate IDE and Agents Window coverage, including approvals and cancellation, beyond the confirmed local tool calls and file edits.
* The public installer and restore flow against a fresh real application installation with Cursor closed.
* Interactive sign-in and automatic renewal in a fresh public installation.
* Actual priority processing when requested.
* Other accounts, installation layouts and operating systems.

## Subscription usage and model labels

Version 0.1.2 incorporates the locally developed subscription usage card, OpenAI picker icon, quota error handling and bridge restart changes. The public tests use synthetic usage responses. The usage UI patches are checked against both original workbench bundles; a fresh interactive test of the combined public build is still pending.

## Cursor 3.20.11

Version 0.1.3 adds a separate patch implementation for build `69d099d6568dc97e110ba8184614faf51c4040b0`. Build verification against original files passed for both workbenches, both runtimes and the main process. The actual patched workbench methods passed synthetic SSH-routing checks, and both runtime normalizers preserved every tested reasoning and Fast combination. The workbench checksum matched. No application files are distributed in this repository.

The local prototype returned a successful ChatGPT response after the update, and its catalog and subscription usage endpoints responded successfully. The project owner confirmed model selection and a file edit after reloading the updated Cursor, without specifying provider or window. This is not a separate manual SSH test on 3.20.11. The public installer was checked through candidate generation against original files; it was not used to replace the running private installation.

## Attachments

On September 11, 2026, the installed local GPT bridge with GPT-5.6 Luna identified a generated PNG color and read a validation word embedded only in a PDF. No conversion or text extraction was needed in the bridge. Unit coverage verifies that image and PDF bytes and tool-call history survive normalization, and vision capability follows the model catalog. The request-body ceiling is now 64 MiB including base64 overhead. Separate attachment testing through each Cursor window and SSH is still pending.

See [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs) for the public input schema; the live check validates the subscription endpoint separately.

## Local ChatGPT subagent startup

On September 13, 2026, an SSH Agents Window session on Cursor 3.20.17 reported `Timeout waiting for bubble creation` for both explore and general-purpose subagents. The renderer received the requests, but the native parent Task registration barrier expired before inference started.

The 3.20.17 ChatGPT patch now creates a missing parent Task bubble through Cursor's existing ToolFormer method before entering that barrier. The repair applies only to ChatGPT subagent requests whose loaded parent also uses a ChatGPT model. Existing bubbles are retained. Cancelled requests cannot create a bubble, and a missing parent or capability still follows the original failure path. The registry is signalled only after the native lookup finds a real bubble.

Five regression tests cover creation, duplicate prevention, provider scope, cancellation and unavailable parent state. Build verification executes the actual desktop and Agents Window registration methods: the missing-bubble case fails without the repair and passes with it. Both patch manifests and backups were verified after installation. A new manual SSH subagent result is still pending; these checks do not establish a completed remote task or approval-flow coverage.

### Empty optional model on the first attempt

The later ChatGPT SSH session contained a separate failure after reload: Task calls supplied an empty model string and failed native validation. The next attempts selected a model successfully and started local subagents. This confirms successful startup after retries, not reliable first-attempt behavior before the additional repair.

For this subscription provider, an empty or whitespace-only requested model is now normalized to an omitted selection before the native resolver runs. Cursor still chooses the inherited, configured or forced model and checks availability. Explicit models and other providers retain native validation. Both runtime resolvers passed a reproduced empty-string failure, inheritance, configured defaults, forced-model handling and blocked-model checks. A new live test of the first attempt after this additional repair is still pending.

### Bridge startup after the launching process exits

A detached launcher now owns the complete stop/start sequence. Windows regression tests cover cold startup and replacement of an existing fixture worker after the launching process exits immediately. Previously the restart callback belonged to the exiting host. These checks use temporary workers, not account credentials or model requests. Both local usage endpoints were checked separately; the Agents Window display still requires a manual check.

### Explore model settings on Cursor 3.20.21

The workbench now includes the explicitly selected Explore model in the local runtime catalog. Previously a selection missing from `localProviderAgentModelIds` silently became Inherit. The patch also carries the selected model parameters into the client subagent request and preserves parent parameters for inherited models. Default, Inherit and Disabled continue through Cursor's native resolver, including its priority for explicit Task model arguments. Disabled applies to Explore, not every type of subagent.

Tests reproduce the missing-catalog fallback using Cursor's local task factory and verify both runtimes. Standalone Claude and combined installations, IDE and Agents Window routing, parameter forwarding and exact restoration were checked on a separate copy of 3.20.21. After reloading Cursor, the project owner confirmed a different selected Explore model, its effort setting, and both tooltip layouts. The test response did not separately identify the provider, window or SSH host, so it is not recorded as a complete matrix of those environments. Tooltip tests cover every effort and context variant using the native Markdown layout.

### Context and MAX mode on Cursor 3.20.21

The native mode solver was exercised in both workbenches for every synthetic effort/Fast combination, in both directions. Ordinary models retain Cursor's original behavior. Both native runtime metadata decoders reproduce the ignored top-level `context_window` field and correctly read `capabilities.context_length`. The native prompt-session budget respects the selected size, falls back to the advertised size and caps oversized selections at the provider limit. Standalone Claude and combined installs, linked hashes and exact restoration passed. Unit tests also verify the real catalog variants, Claude CLI context selection, and that local MAX/Context controls are not sent as unsupported OpenAI API fields. No full-window stress test has been performed.

After installation, both live model endpoints were checked using Cursor's native metadata decoder and context-budget functions. The tested GPT-5.6 Luna entry reported 272,000 tokens and the Claude Opus entry reported 1,000,000. A short live response completed successfully through each bridge; the Claude request explicitly selected 1M. These requests establish basic inference compatibility, not behavior at a full context window. After reloading Cursor, the project owner confirmed changing the context size while retaining effort and receiving the next response. The reply did not separately establish a legacy-plan MAX toggle test or full-window stress coverage.

### Subagent transcript and cancellation on Cursor 3.20.21

The project owner reported empty subagent panels after switching chats and child runs continuing after Stop. Source inspection found that cancelChat only cascaded for a chat with subagentInfo and skipped an already idle parent. stopSubagentTree also waited for storage loading and an agent-host RPC before aborting local runs. Subscription chats now cancel their loaded tree immediately, including an idle parent with active children. Local inference is cancelled through the existing runtime signal rather than an unrelated agent-host session.

Subagent requests combine their own signal with the active parent generation signal. Tests cover a stop before inference, cancellation during a background child run, cancellation during creation, a usable later turn, provider scoping and listener cleanup. Late creation results are cancelled before they can run. The original desktop and Agents Window methods fail the parent-stop regression; the patched methods pass.

The transcript classifier cached conversationMap by composer identity alone. A replaced map on the same composer could therefore remain invisible. The patch refreshes that cache for subscription subagents and hydrates up to 64 recent missing or placeholder bodies when a transcript is attached. It uses Cursor's existing loader, preserves live messages and skips hydration after disposal. A native-method regression reproduces map replacement without replacing the composer.

The ChatGPT suite has 52 passing tests, including a real loopback HTTP stream that closes upstream when its client disconnects. The Claude suite has 54 passing tests, including its existing request-disconnect coverage. Native checks passed on both workbenches, standalone Claude and the combined installation. Existing SSH routing, model settings, context controls, linked manifest hashes and exact restoration were also checked. No new live model request was needed for these tests. The installed UI still requires a manual chat-switch and Stop check after reload; these results do not establish remote process cancellation timing.

### Queued follow-ups and Plan-to-Build on Cursor 3.20.21

The local workbench runner did not pass its conversation action manager to the runtime. Its engine used an empty action receiver. The Build override also omitted unconfirmed human messages collected from the transcript. Both gaps are patched in the IDE and Agents Window bundles and both local runtimes. The connection uses the existing per-run binary callback transport, including the dedicated runtime used for SSH.

Eleven regression tests cover FIFO delivery, attachment references, replay deduplication, failures during preparation, end-of-turn races, checkpoint continuation, cancellation, provider isolation and prepended Build messages. Native manager checks exercise queue submission, replay, acknowledgement and Stop using methods extracted from the original Cursor build. Both runtime receiver anchors and the plan initializer are checked, along with standalone and combined installation and exact restoration. These tests use synthetic messages and do not make model requests. Manual Plan-to-Build validation, especially during SSH subagent execution, is still pending.

## ChatGPT context display correction

Models with multiple context sizes now report the standard window separately from the extended window. Previously the Agents Window used the maximum capacity for both selections, such as 272K while 200K was selected. The provider catalog retains the full capacity. Single-window models retain their original limit. Run `node scripts/check-context-display.mjs <Cursor resources/app>` to reproduce the old result and verify native 200K/272K/200K display switching and percentages.
