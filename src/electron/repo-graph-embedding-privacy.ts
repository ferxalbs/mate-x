import path from 'node:path';

const SENSITIVE_PATH_PATTERN =
  /(^|[/\\])(?:\.env(?:\.|$)|.*(?:secret|secrets|credential|credentials|token|tokens|private[-_.]?key|id_rsa|id_dsa|id_ecdsa|id_ed25519).*)/i;
const SENSITIVE_CONTENT_PATTERN =
  /\b(api[_-]?key|authorization|bearer|client[_-]?secret|credential|password|passwd|private[_-]?key|rainy[_-]?api[_-]?key|secret|token)\b/i;
const PEM_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|SECRET|CERTIFICATE)[\s\S]*?-----END [A-Z0-9 ]*(?:PRIVATE KEY|SECRET|CERTIFICATE)-----/g;

export function getEmbeddingContent(filePath: string, content: string | undefined) {
  if (!content) {
    return '';
  }
  if (isSensitiveEmbeddingPath(filePath)) {
    return '[omitted: sensitive configuration content]';
  }
  return redactEmbeddingContent(content);
}

export function redactEmbeddingContent(content: string) {
  return content
    .replace(PEM_BLOCK_PATTERN, '[REDACTED_PEM_BLOCK]')
    .split('\n')
    .map((line) => (SENSITIVE_CONTENT_PATTERN.test(line) ? redactSensitiveLine(line) : line))
    .join('\n');
}

export function isSensitiveEmbeddingPath(file: string) {
  const normalizedPath = file.replace(/\\/g, '/');
  const basename = path.basename(normalizedPath);
  return (
    basename.startsWith('.env') ||
    SENSITIVE_PATH_PATTERN.test(normalizedPath) ||
    ['.pem', '.key', '.p12', '.pfx'].includes(path.extname(normalizedPath).toLowerCase())
  );
}

function redactSensitiveLine(line: string) {
  const delimiterMatch = /^([^:=]+[:=]\s*)(.*)$/.exec(line);
  if (delimiterMatch) {
    return `${delimiterMatch[1]}[REDACTED]`;
  }
  return '[REDACTED_SECRET_LINE]';
}
