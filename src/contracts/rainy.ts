export type RainyApiMode = 'chat_completions' | 'responses';

export interface RainyModelCatalogEntry {
  id: string;
  label: string;
  description: string | null;
  ownedBy: string | null;
  supportedApiModes: RainyApiMode[];
  preferredApiMode: RainyApiMode | null;
}
