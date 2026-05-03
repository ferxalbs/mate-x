import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import type { PrivacyModelStatus } from "../../contracts/privacy";

const REQUIRED_FILES = [
  "model.onnx",
  "config.json",
  "custom_label_space.json",
  "onnx_export_metadata.json",
];

const DEFAULT_MODEL_CONFIG: Required<ModelConfig> = {
  huggingFaceRepo: "enosislabs/matex-privacy-sentinel-v0.15-onnx",
  revision: "main",
  downloadUrl: "https://huggingface.co/enosislabs/matex-privacy-sentinel-v0.15-onnx/resolve/main",
  apiUrl: "https://huggingface.co/api/models/enosislabs/matex-privacy-sentinel-v0.15-onnx",
  requiredFiles: REQUIRED_FILES,
  externalDataFiles: ["model.onnx.data"],
};

type PrivacyModelProgressCallback = (progress: {
  state: "downloading" | "verifying" | "ready" | "failed";
  file?: string;
  fileIndex: number;
  fileCount: number;
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
  message?: string;
}) => void;

interface ModelConfig {
  huggingFaceRepo?: string;
  revision?: string;
  downloadUrl?: string;
  apiUrl?: string;
  requiredFiles?: string[];
  externalDataFiles?: string[];
}

function resolveAssetPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "privacy", "models", "matex-privacy-v0.15")
    : path.resolve(process.cwd(), "resources/models/matex-privacy-v0.15");
}

function resolveUserDataPath() {
  return path.join(app.getPath("userData"), "privacy", "models", "matex-privacy-v0.15");
}

async function readModelConfig(assetPath: string): Promise<ModelConfig> {
  try {
    return JSON.parse(await readFile(path.join(assetPath, "privacy-model.json"), "utf8")) as ModelConfig;
  } catch {
    return {};
  }
}

export async function loadPrivacyModelStatus(): Promise<PrivacyModelStatus> {
  const bundledPath = resolveAssetPath();
  const userDataPath = resolveUserDataPath();
  const bundledConfig = await readModelConfig(bundledPath);
  const userConfig = await readModelConfig(userDataPath);
  const config = { ...DEFAULT_MODEL_CONFIG, ...bundledConfig, ...userConfig };
  const requiredFiles = config.requiredFiles?.length ? config.requiredFiles : REQUIRED_FILES;
  const externalDataFiles = config.externalDataFiles ?? ["model.onnx.data"];
  const userState = await checkFiles(userDataPath, [...requiredFiles, ...externalDataFiles]);
  const bundledState = await checkFiles(bundledPath, [...requiredFiles, ...externalDataFiles]);
  const loadedFromUserData = userState.missingFiles.length === 0;
  const loadedFromBundled = bundledState.missingFiles.length === 0;
  const assetPath = loadedFromUserData ? userDataPath : loadedFromBundled ? bundledPath : userDataPath;
  const presentFiles = loadedFromUserData ? userState.presentFiles : loadedFromBundled ? bundledState.presentFiles : userState.presentFiles;
  const missingFiles = loadedFromUserData ? [] : loadedFromBundled ? [] : userState.missingFiles;

  const importError = missingFiles.length === 0 ? await detectRuntimeImportError() : undefined;

  return {
    model: "matex-privacy-v0.15",
    loaded: missingFiles.length === 0,
    missing: missingFiles.length > 0,
    assetPath,
    userDataPath,
    bundledPath,
    source: loadedFromUserData ? "userData" : loadedFromBundled ? "bundled" : "missing",
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

export async function downloadPrivacyModelAssets(
  onProgress?: PrivacyModelProgressCallback,
): Promise<PrivacyModelStatus> {
  const bundledPath = resolveAssetPath();
  const assetPath = resolveUserDataPath();
  const tempPath = `${assetPath}.download`;
  await rm(tempPath, { recursive: true, force: true });
  await mkdir(tempPath, { recursive: true });
  const config = { ...DEFAULT_MODEL_CONFIG, ...(await readModelConfig(bundledPath)) };
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

  for (const [index, file] of targetFiles.entries()) {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(file)}`);
    if (!response.ok) {
      onProgress?.({
        state: "failed",
        file,
        fileIndex: index + 1,
        fileCount: targetFiles.length,
        receivedBytes: 0,
        message: `Privacy model download failed for ${file} with status ${response.status}.`,
      });
      return {
        ...(await loadPrivacyModelStatus()),
        remoteFiles,
        error: `Privacy model download failed for ${file} with status ${response.status}.`,
      };
    }

    const bytes = await readResponseBytes(response, (receivedBytes, totalBytes) => {
      onProgress?.({
        state: "downloading",
        file,
        fileIndex: index + 1,
        fileCount: targetFiles.length,
        receivedBytes,
        totalBytes,
        percent: totalBytes ? Math.round((receivedBytes / totalBytes) * 100) : undefined,
      });
    });
    await writeFile(path.join(tempPath, file), bytes);
  }

  onProgress?.({
    state: "verifying",
    fileIndex: targetFiles.length,
    fileCount: targetFiles.length,
    receivedBytes: 0,
    message: "Installing MaTE X Privacy model.",
  });
  await writeFile(path.join(tempPath, "privacy-model.json"), JSON.stringify(config, null, 2));
  await rm(assetPath, { recursive: true, force: true });
  await mkdir(path.dirname(assetPath), { recursive: true });
  await cp(tempPath, assetPath, { recursive: true });
  await rm(tempPath, { recursive: true, force: true });

  onProgress?.({
    state: "ready",
    fileIndex: targetFiles.length,
    fileCount: targetFiles.length,
    receivedBytes: 0,
    percent: 100,
    message: "MaTE X Privacy model ready.",
  });

  return {
    ...(await loadPrivacyModelStatus()),
    remoteFiles,
  };
}

async function readResponseBytes(
  response: Response,
  onChunk: (receivedBytes: number, totalBytes?: number) => void,
) {
  const totalBytes = Number(response.headers.get("content-length")) || undefined;
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    onChunk(bytes.byteLength, totalBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    receivedBytes += value.byteLength;
    onChunk(receivedBytes, totalBytes);
  }

  return Buffer.concat(chunks);
}

async function checkFiles(basePath: string, files: string[]) {
  const presentFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of files) {
    try {
      await access(path.join(basePath, file));
      presentFiles.push(file);
    } catch {
      missingFiles.push(file);
    }
  }

  return { presentFiles, missingFiles };
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
