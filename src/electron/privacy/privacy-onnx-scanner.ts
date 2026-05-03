import type { PrivacySpan } from "./privacy-types";
import { loadPrivacyModelStatus, type PrivacyModelStatus } from "./privacy-model-loader";

export interface PrivacyOnnxScanResult {
  spans: PrivacySpan[];
  status: PrivacyModelStatus;
  error?: string;
}

export async function scanWithOnnx(_text: string): Promise<PrivacyOnnxScanResult> {
  const status = await loadPrivacyModelStatus();

  if (!status.loaded) {
    return {
      spans: [],
      status,
      error: "MaTE X Privacy v0.15 ONNX assets missing.",
    };
  }

  return {
    spans: [],
    status: { ...status, loaded: false },
    error: "MaTE X Privacy v0.15 ONNX adapter not initialized in this build.",
  };
}
