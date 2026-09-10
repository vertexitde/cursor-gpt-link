# Testing notes

Recorded on September 10, 2026.

## Environment

| Component | Version |
| --- | --- |
| Operating system | Windows, x64 |
| Cursor | 3.20.7 |
| Cursor commit | `979197d5570b168c034c634b3e21f2bea3ea5be0` |
| Node.js | 26.7.0 |
| Codex CLI | 0.153.4 |

The supported original JavaScript file hashes are recorded in [supported-build.json](../src/supported-build.json). File hashes are used because the same version label is not sufficient to establish that minified patch anchors are compatible.

## Automated checks

All 21 public unit tests passed locally. They cover partial model refreshes, explicit model hiding, account-separated saved catalogs, supported reasoning and Fast combinations, the default speed setting, request normalization, unsupported settings, local bearer authentication and browser-origin rejection. Installation tests verify exact restoration, refusal of changed application files or damaged backups, and resuming an interrupted restore. Remote routing tests check runtime selection, extension activation and preservation of workspace resources and cancellation signals in both workbenches. Additional checks cover the icon labels, subscription usage mapping, quota errors, and exact bridge-process selection on restart. Tests use synthetic data without access to a real account.

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
