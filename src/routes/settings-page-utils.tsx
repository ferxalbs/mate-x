import { SettingsRow } from '../components/ui/settings-layout';
import type { AppSettings } from '../contracts/settings';
import type { WorkspaceTrustContract } from '../contracts/workspace';

export function maskKey(key: string) {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 24)) + key.slice(-4);
}

export function isValidRainyApiKey(value: string) {
  return value.startsWith('ra-') || value.startsWith('rk_live_');
}

export function TrustTextareaRow({
  title,
  description,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  description: string;
  value: string[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <textarea
          className="min-h-20 w-full rounded-md border border-input bg-[var(--mate-control-bg)] px-3 py-2 text-xs leading-5 text-foreground outline-none backdrop-blur-md placeholder:text-muted-foreground/50 focus-visible:border-ring sm:w-[360px]"
          value={value.join('\n')}
          placeholder={placeholder}
          onChange={(event) => onChange(parseLines(event.target.value))}
        />
      }
    />
  );
}

export function parseLines(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

export function serializeAppSettings(settings: AppSettings) {
  return JSON.stringify(settings);
}

export function serializeTrustContract(contract: WorkspaceTrustContract) {
  return JSON.stringify({
    name: contract.name,
    version: contract.version,
    autonomy: contract.autonomy,
    allowedPaths: contract.allowedPaths,
    forbiddenPaths: contract.forbiddenPaths,
    allowedCommands: contract.allowedCommands,
    allowedDomains: contract.allowedDomains,
    allowedSecrets: contract.allowedSecrets,
    allowedActions: contract.allowedActions,
    blockedActions: contract.blockedActions,
  });
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
