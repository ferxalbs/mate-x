import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrivacyModelStatus } from "../../contracts/privacy";

const REQUIRED_FILES = [
  "model.onnx",
  "tokenizer.json",
  "tokenizer_config.json",
  "config.json",
  "label_space.json",
  "special_tokens_map.json",
];

interface ModelConfig {
  downloadUrl?: string;
  requiredFiles?: string[];
}

function resolveAssetPath() {
  return path.resolve(process.cwd(), "resources/models/matex-privacy-v0.15");
}

async function readModelConfig(assetPath: string): Promise<ModelConfig> {
  try {
    return JSON.parse(await readFile(path.join(assetPath, "privacy-model.json"), "utf8")) as ModelConfig;
  } catch {
    return {};
  }
}

export async function loadPrivacyModelStatus(): Promise<PrivacyModelStatus> {
  const assetPath = resolveAssetPath();
  const config = await readModelConfig(assetPath);
  const requiredFiles = config.requiredFiles?.length ? config.requiredFiles : REQUIRED_FILES;
  const presentFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of requiredFiles) {
    try {
      await access(path.join(assetPath, file));
      presentFiles.push(file);
    } catch {
      missingFiles.push(file);
    }
  }

  return {
    model: "matex-privacy-v0.15",
    loaded: missingFiles.length === 0,
    missing: missingFiles.length > 0,
    assetPath,
    requiredFiles,
    presentFiles,
    missingFiles,
    downloadUrl: config.downloadUrl,
  };
}

export async function downloadPrivacyModelAssets(): Promise<PrivacyModelStatus> {
  const assetPath = resolveAssetPath();
  await mkdir(assetPath, { recursive: true });
  const config = await readModelConfig(assetPath);

  if (!config.downloadUrl) {
    return {
      ...(await loadPrivacyModelStatus()),
      error: "Privacy model downloadUrl is not configured.",
    };
  }

  const response = await fetch(config.downloadUrl);
  if (!response.ok) {
    return {
      ...(await loadPrivacyModelStatus()),
      error: `Privacy model download failed with status ${response.status}.`,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(assetPath, "model.onnx"), bytes);
  return loadPrivacyModelStatus();
}
