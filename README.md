# cursor-gpt-link

An experimental patch that adds models from your local Codex catalog to Cursor's model picker and routes them through your existing ChatGPT sign-in. It uses Cursor's local agent runtime. It does not install an extension.

This release targets one Windows build of Cursor. It is not a general patch for every Cursor version, operating system, subscription, or model.

## Status

| Item | Current status |
| --- | --- |
| Cursor | 3.20.7, Windows x64 |
| Cursor commit | `979197d5570b168c034c634b3e21f2bea3ea5be0` |
| Local test date | September 10, 2026 |
| Node.js used for testing | 26.7.0 |
| Codex CLI used for testing | 0.153.4 |
| Text generation through the bridge | Verified with GPT-6 Astra |
| Tool calls | Confirmed working in manual local Cursor testing; bridge round trip also verified |
| File edits | Confirmed working in manual local Cursor testing |
| Reasoning selection | Forwarding verified in both local runtimes |
| IDE and Agents Window | Both bundles patched and syntax checked; manual results do not specify coverage of each window |
| Remote SSH sessions | Not working |
| Fast mode | Selector and request forwarding verified; actual priority processing not confirmed |

The installer checks the Cursor version, commit and SHA-256 hashes of five original JavaScript bundles. It stops before patching an unknown or already modified build. See [testing notes](docs/testing.md) for the scope of verification.

## What it adds

Models appear with `(ChatGPT)` after their names. The list comes from your local Codex model catalog, including each model's supported reasoning levels. The patch does not ship a fixed model list or grant access to models your account cannot use.

The model picker offers reasoning levels such as Low, Medium, High, Very high and Max when the model advertises them. Fast appears when the model metadata advertises a speed tier. Each reasoning level can be combined with Fast independently. Fast is off by default.

A partial catalog refresh preserves previously seen models so entries such as Astra do not disappear just because one cache update omits them. An explicit hidden entry removes the model. The saved catalog is separated by account. A visible cached entry is not proof of current entitlement; the service still decides whether to accept a request.

Text added by this patch is English and does not follow the account language. Existing Cursor controls, including parts of the parameter popover, still use Cursor's own localization. Model descriptions come from the local catalog. The patch does not change the language of the rest of Cursor.

## Fast mode limitation

Fast sends `service_tier: "priority"` in the request. In our live tests, the service returned `service_tier: "default"`, including a direct request outside the bridge. Selecting Fast therefore does not currently establish that the request will run faster.

Do not assume a fixed twofold speed increase or a fixed usage multiplier. Availability, processing speed and subscription usage depend on the model and account. See OpenAI's [speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed). The selector tooltip explains the limitation as well.

## Requirements

* Windows x64 and the exact Cursor build listed above.
* Node.js 22 or newer on PATH. Only Node.js 26.7.0 has been tested locally.
* A Codex executable and a ChatGPT account with access to the requested models.
* Existing file-based Codex authentication in `auth.json` and a populated `models_cache.json` in the same Codex home.
* Permission to modify your Cursor installation directory.

This release reads file-based Codex authentication only. It does not read the Windows credential store or import browser cookies. API-key-only authentication is not supported. Refer to OpenAI's [authentication documentation](https://learn.chatgpt.com/docs/auth) for sign-in and credential storage options.

## Install

Clone this repository into a local directory, then open a terminal there:

```powershell
git clone https://github.com/vertexitde/cursor-gpt-link.git
cd cursor-gpt-link
node patcher.mjs check
```

If you have not signed in, run `codex login` and complete the ChatGPT sign-in. Open Codex once so it refreshes its model catalog. There are no npm dependencies to install.

Close all Cursor windows and background processes, then run:

```powershell
node patcher.mjs install
```

Start Cursor again and select a model ending in `(ChatGPT)`. The bridge starts with Cursor and listens only on `127.0.0.1`. A `ChatGPT: Sign in (subscription)` command is also added to the command palette. If that command does not open a browser, use `codex login` in a terminal.

The installer detects common per-user and system-wide Cursor locations. It looks for the Codex desktop executable, then for `codex.exe` on PATH. For other locations:

```powershell
node patcher.mjs install --cursor-root "D:\Apps\Cursor\resources\app" --codex-path "D:\Tools\codex.exe" --codex-home "D:\MyCodexHome" --port 43188
```

`--cursor-root` must point to `resources/app`, not the directory containing `Cursor.exe`. A npm command shim such as `codex.cmd` is not accepted as the executable path.

Configuration, a copy of the bridge runtime, model catalogs and original-file backups are stored in `%LOCALAPPDATA%\cursor-gpt-link`. Set `CURSOR_GPT_LINK_HOME` before running the patcher to choose a different state directory. Use the same value for subsequent status and restore commands. The runtime is copied during installation, so moving the repository afterwards does not break autostart. The Node.js executable must stay at its installation path.

## Check or remove the patch

```powershell
node patcher.mjs status
```

To remove it, close Cursor and run:

```powershell
node patcher.mjs restore
```

Restore verifies both the installed files and the backups before copying originals back. Backups are retained. It refuses to overwrite files changed by a Cursor update or another patch. If an update has replaced the application, use a clean Cursor installation instead of forcing old backups over the new version. The patcher has no force option.

Restoring removes the autostart code. An already running bridge can remain until it is stopped or Windows is restarted. It accepts requests only with its local key. You can inspect its process command line for the `cursor-gpt-link\runtime\bridge.mjs` path before stopping that process. The patcher does not stop unrelated Node.js processes.

Cursor updates can remove this patch. New builds need separate review, new anchors and new verification. Do not change the supported version number to bypass the checks.

If you used an earlier private prototype, restore it using its own installer before installing this release. Its backups and state are separate.

## How it works

The patch changes the desktop workbench, the Agents Window workbench, both local agent runtime bundles, the main-process startup file and the corresponding workbench checksum in `product.json`.

Only model IDs beginning with `chatgpt-codex/` use the bridge. Cursor continues to run its local agent and handle tools and approvals. The bridge translates the request into the streaming Responses format and sends it to `https://chatgpt.com/backend-api/codex/responses`. This is an internal service endpoint, not a supported public integration contract.

Codex is used for sign-in and token renewal, not as the agent harness. The bridge reads the existing access token and account ID and asks Codex to refresh authentication after an unauthorized response. It does not implement a separate OAuth client or bundle anyone's credentials.

Prompts, attachments and tool data in the forwarded request are sent to OpenAI. The bridge does not add request logging. Account credentials are not inserted into Cursor bundles; a generated local bridge key is inserted instead. Local programs running as your user can read that key and the state directory. Do not share your state directory, patched bundles, authentication files or backups.

## Limitations

* Remote SSH sessions do not work with the current patch.
* Only the listed Windows x64 build is supported. macOS, Linux, other remote environments and cloud agents are untested.
* Tool calls and file edits work in manual local Cursor testing. Separate coverage of the IDE and Agents Window, including approvals and cancellation, has not yet been recorded.
* Authentication formats, model metadata and the internal endpoint can change independently of Cursor.
* The bridge uses Codex's local model cache. After switching accounts, open Codex to refresh its cache and reload the Cursor window. A stale cache may temporarily show models the new account cannot use.
* Initial model entries are embedded when installing. Refreshing the picker normally replaces them with the bridge catalog; an unavailable bridge can leave stale entries visible.
* The bridge is a Responses adapter, not an implementation of every OpenAI API feature. Voice, video, image generation and every model-specific feature have not been validated.

## Development

```powershell
npm test
node scripts/verify-build.mjs "C:\Path\To\Original\Cursor\resources\app"
```

Unit tests use synthetic credentials and model data and do not make requests to OpenAI. The optional build verification reads original Cursor files locally, validates hashes, generates candidate patches in a temporary directory, checks syntax and exercises reasoning and Fast forwarding. It does not modify Cursor. No Cursor binaries, bundled source, model caches or account files are distributed here.

When reporting a problem, include your Cursor version and commit, operating system, Node.js version and a redacted error message. Do not attach `auth.json`, `config.json`, model caches, patched application files or backup directories.

## Legal Disclaimer & Terms of Service Notice

- **Educational & PoC Only:** This project is an independent open-source proof-of-concept for educational purposes.
- **No Affiliation:** This project is not affiliated with, maintained, sponsored, or endorsed by Anysphere (Cursor) or OpenAI.
- **Use at Your Own Risk:** Modifying software binaries or patching client environments may violate the Terms of Service of Cursor and/or OpenAI.
- **Account Safety:** The maintainers are not responsible for suspended accounts, lost access, or any damages caused by using this patch.

## License

The patcher and bridge source are provided under the [MIT license](LICENSE). That license does not apply to Cursor, Codex or OpenAI services.
