import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrivacyModelStatus } from "../../contracts/privacy";

const REQUIRED_FILES = [
  "model.onnx",
  "config.json",
  "custom_label_space.json",
  "onnx_export_metadata.json",
];

interface ModelConfig {
  huggingFaceRepo?: string;
  revision?: string;
  downloadUrl?: string;
  apiUrl?: string;
  requiredFiles?: string[];
  externalDataFiles?: string[];
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
  const externalDataFiles = config.externalDataFiles ?? ["model.onnx.data"];
  const presentFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of [...requiredFiles, ...externalDataFiles]) {
    try {
      await access(path.join(assetPath, file));
      presentFiles.push(file);
    } catch {
      missingFiles.push(file);
    }
  }

  const importError = missingFiles.length === 0 ? await detectRuntimeImportError() : undefined;

  return {
    model: "matex-privacy-v0.15",
    loaded: missingFiles.length === 0,
    missing: missingFiles.length > 0,
    assetPath,
    huggingFaceRepo: config.huggingFaceRepo,
    revision: config.revision ?? "main",
    requiredFiles,
    externalDataFiles,
    presentFiles,
    missingFiles,
    downloadUrl: config.downloadUrl,
    apiUrl: config.apiUrl,
    inferenceReady: missingFiles.length === 0 && !importError,
    inferenceError: importError,
  };
}

export async function downloadPrivacyModelAssets(): Promise<PrivacyModelStatus> {
  const assetPath = resolveAssetPath();
  await mkdir(assetPath, { recursive: true });
  const config = await readModelConfig(assetPath);
  const revision = config.revision ?? "main";
  const repo = config.huggingFaceRepo ?? "enosislabs/matex-privacy-sentinel-v0.15-onnx";
  const baseUrl = config.downloadUrl ?? `https://huggingface.co/${repo}/resolve/${revision}`;

  const remoteFiles = await fetchRemoteFiles(config.apiUrl ?? `https://huggingface.co/api/models/${repo}`);
  const status = await loadPrivacyModelStatus();
  const targetFiles = [...status.requiredFiles, ...status.externalDataFiles].filter((file) =>
    remoteFiles.length === 0 ? true : remoteFiles.includes(file),
  );

  if (targetFiles.length === 0) {
    return {
      ...status,
      remoteFiles,
      error: "Privacy model repo has no compatible ONNX assets.",
    };
  }

  for (const file of targetFiles) {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(file)}`);
    if (!response.ok) {
      return {
        ...(await loadPrivacyModelStatus()),
        remoteFiles,
        error: `Privacy model download failed for ${file} with status ${response.status}.`,
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path.join(assetPath, file), bytes);
  }

  return {
    ...(await loadPrivacyModelStatus()),
    remoteFiles,
  };
}

async function fetchRemoteFiles(apiUrl: string) {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { siblings?: Array<{ rfilename?: string }> };
    return (payload.siblings ?? [])
      .map((item) => item.rfilename)
      .filter((file): file is string => typeof file === "string");
  } catch {
    return [];
  }
}

async function detectRuntimeImportError() {
  try {
    await Promise.all([
      import("onnxruntime-node").catch(() => import("onnxruntime-web")),
      import("js-tiktoken"),
    ]);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Privacy ONNX runtime is unavailable.";
  }
}
