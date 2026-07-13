import { getStoredTimeFormat } from '../services/settings-client';

const TIMESTAMP_FORMATTERS = {
  '12h': new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }),
  '24h': new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }),
  auto: new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }),
} as const;

export function formatTimestamp(input: string) {
  const timeFormat = getStoredTimeFormat();
  const formatter =
    timeFormat === '12h'
      ? TIMESTAMP_FORMATTERS['12h']
      : timeFormat === '24h'
        ? TIMESTAMP_FORMATTERS['24h']
        : TIMESTAMP_FORMATTERS.auto;

  return formatter.format(new Date(input));
}
