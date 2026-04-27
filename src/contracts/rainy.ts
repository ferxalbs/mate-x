export type RainyApiMode = 'chat_completions' | 'responses';

export interface RainyModelCapabilities {
  multimodal?: {
    input?: string[];
    output?: string[];
  };
  reasoning?: {
    supported?: boolean;
    controls?: {
      reasoning_toggle?: boolean;
      reasoning_effort?: boolean;
      effort?: string[];
      thinking_level?: string[];
    };
    profiles?: Array<{
      id?: string;
      label?: string;
      parameter_path?: string;
      values?: string[];
    }>;
    toggle?: boolean;
  };
  parameters?: {
    accepted?: string[];
  };
}

export interface RainyModelCatalogEntry {
  id: string;
  label: string;
  description: string | null;
  ownedBy: string | null;
  supportedApiModes: RainyApiMode[];
  preferredApiMode: RainyApiMode | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supportedParameters?: string[];
  capabilities?: RainyModelCapabilities;
}
