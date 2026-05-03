import { access } from "node:fs/promises";
import path from "node:path";

export interface PrivacyModelStatus {
  model: "matex-privacy-v0.15";
  loaded: boolean;
  missing: boolean;
  error?: string;
  assetPath: string;
}

export async function loadPrivacyModelStatus(): Promise<PrivacyModelStatus> {
  const assetPath = path.resolve(process.cwd(), "resources/models/matex-privacy-v0.15");

  try {
    await Promise.all([
      access(path.join(assetPath, "model.onnx")),
      access(path.join(assetPath, "tokenizer.json")),
      access(path.join(assetPath, "config.json")),
      access(path.join(assetPath, "label_space.json")),
    ]);
    return { model: "matex-privacy-v0.15", loaded: true, missing: false, assetPath };
  } catch {
    return { model: "matex-privacy-v0.15", loaded: false, missing: true, assetPath };
  }
}
