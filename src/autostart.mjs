const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function bridgeCommandPattern(nodePath, bridgePath) {
  return '^"?' + escapeRegex(nodePath) + '"?\\s+"?' + escapeRegex(bridgePath) + '"?\\s*$';
}

export function buildAutostart({nodePath, bridgePath, stateDir}) {
  // Restart only this installation's worker, not other Node.js processes or
  // bridges installed in another state directory. Encode the PowerShell script
  // so paths containing quotes cannot become shell instructions.
  const pattern = bridgeCommandPattern(nodePath, bridgePath).replaceAll("'", "''");
  const restart = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  const encoded = Buffer.from(restart, 'utf16le').toString('base64');
  return `
/* cursor-chatgpt-bridge autostart */
import("node:child_process").then(({execFile:bridgeKill,spawn:bridgeSpawn})=>{
  const start=()=>{
    const child=bridgeSpawn(${JSON.stringify(nodePath)},[${JSON.stringify(bridgePath)}],{
      detached:true,windowsHide:true,stdio:"ignore",
      env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,CURSOR_GPT_LINK_HOME:${JSON.stringify(stateDir)}}
    });
    child.on("error",()=>{});child.unref();
  };
  if(process.platform==="win32")bridgeKill("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",${JSON.stringify(encoded)}],{windowsHide:true},()=>start());
  else start();
});
`;
}
