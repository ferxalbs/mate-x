import { getStoredTimeFormat } from '../services/settings-client';

export function formatTimestamp(input: string) {
  const timeFormat = getStoredTimeFormat();

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: timeFormat === '12h' ? true : timeFormat === '24h' ? false : undefined,
  }).format(new Date(input));
}
