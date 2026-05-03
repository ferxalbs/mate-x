export type PrivacyLabel =
  | "secret"
  | "api_key"
  | "auth_token"
  | "session_cookie"
  | "database_uri"
  | "cloud_credential"
  | "repo_secret"
  | "prompt_sensitive"
  | "private_file_path"
  | "internal_url"
  | "workspace_identity"
  | "customer_data"
  | "stacktrace_sensitive"
  | "private_email"
  | "private_phone"
  | "account_number"
  | "payment_token"
  | "personal_document_id"
  | "private_url"
  | "private_person"
  | "private_address"
  | "private_date";

export type PrivacySource = "regex" | "onnx" | "postprocessor" | "manual";
export type PrivacyRisk = "p0" | "p1" | "p2" | "low";

export interface PrivacySpan {
  id: string;
  label: PrivacyLabel;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: PrivacySource[];
  risk: PrivacyRisk;
  replacement: string;
  hash: string;
}

export interface PrivacySafeSpan extends Omit<PrivacySpan, "text"> {
  text?: never;
}

export interface PrivacyScanResult {
  originalLength: number;
  redactedText: string;
  spans: PrivacySpan[];
  blocked: boolean;
  blockReason?: string;
  stats: {
    totalSpans: number;
    p0Count: number;
    modelCount: number;
    regexCount: number;
    elapsedMs: number;
  };
}

export interface PrivacySafeScanResult extends Omit<PrivacyScanResult, "spans"> {
  spans: PrivacySafeSpan[];
}

export interface PrivacyFirewallOptions {
  mode: "off" | "warn" | "review" | "strict";
  placeholderStyle: "simple" | "typed" | "stable";
  scanModel: boolean;
  scanRegex: boolean;
  encryptVault: boolean;
  blockP0CloudSend: boolean;
  minModelConfidence: number;
}

export interface PrivacySanitizeResult<T> {
  payload: T;
  scan: PrivacyScanResult;
  blocked: boolean;
  reason?: string;
}

export interface PrivacyModelStatus {
  model: "matex-privacy-v0.15";
  loaded: boolean;
  missing: boolean;
  assetPath: string;
  userDataPath: string;
  bundledPath: string;
  source: "userData" | "bundled" | "missing";
  huggingFaceRepo?: string;
  revision?: string;
  requiredFiles: string[];
  externalDataFiles: string[];
  presentFiles: string[];
  missingFiles: string[];
  downloadUrl?: string;
  apiUrl?: string;
  remoteFiles?: string[];
  inferenceReady: boolean;
  inferenceError?: string;
  error?: string;
}

export interface PrivacyApi {
  scanText: (text: string) => Promise<PrivacySafeScanResult>;
  getModelStatus: () => Promise<PrivacyModelStatus>;
  downloadModel: () => Promise<PrivacyModelStatus>;
  clearVault: () => Promise<void>;
}
