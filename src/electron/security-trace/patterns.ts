export interface SecurityPattern {
  id: string;
  label: string;
  regex: RegExp;
  symbolRegex?: RegExp;
}

export const SOURCE_PATTERNS: SecurityPattern[] = [
  {
    id: 'user-input',
    label: 'user input',
    regex: /\b(req\.(body|query|params|headers)|request\.(body|query|params|headers)|event\.target\.value|FormData\(|URLSearchParams\()/,
  },
  {
    id: 'ipc-renderer',
    label: 'IPC renderer call',
    regex: /\b(ipcRenderer\.(invoke|send)|window\.[A-Za-z0-9_]+Api\.[A-Za-z0-9_]+\()/,
  },
  {
    id: 'http-handler',
    label: 'HTTP request handler',
    regex: /\.(get|post|put|patch|delete)\s*\([^,]+,\s*(async\s*)?\(?\s*(req|request)\b/,
  },
  {
    id: 'env',
    label: 'environment variable',
    regex: /\bprocess\.env\.[A-Z0-9_]+/,
  },
  {
    id: 'file-read',
    label: 'file read',
    regex: /\b(readFile|readFileSync|createReadStream)\s*\(/,
  },
  {
    id: 'external-api',
    label: 'external API response',
    regex: /\b(await\s+)?(fetch|axios\.(get|post|put|patch|delete)|got|request)\s*\(/,
  },
];

export const SINK_PATTERNS: SecurityPattern[] = [
  {
    id: 'shell-exec',
    label: 'shell execution',
    regex: /\b(exec|execSync|spawn|spawnSync|execa|shell)\s*\(/,
  },
  {
    id: 'file-write',
    label: 'file write',
    regex: /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/,
  },
  {
    id: 'db-query',
    label: 'database query',
    regex: /\b(query|execute|raw|run|prepare)\s*\(/,
  },
  {
    id: 'dom-injection',
    label: 'HTML/DOM injection',
    regex: /(\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML)/,
  },
  {
    id: 'dynamic-code',
    label: 'dynamic code execution',
    regex: /\b(eval|Function|runInNewContext|runInThisContext|compileFunction)\s*\(/,
  },
  {
    id: 'network-request',
    label: 'network request',
    regex: /\b(fetch|axios\.(get|post|put|patch|delete)|got|request)\s*\(/,
  },
  {
    id: 'secret-usage',
    label: 'token/secret usage',
    regex: /\b(Authorization|Bearer|token|secret|apiKey|api_key|accessToken|process\.env\.[A-Z0-9_]+)\b/,
  },
];

export const TRANSFORM_REGEX =
  /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)|([A-Za-z_$][\w$]*)\s*=\s*(.+)|return\s+(.+)/;

