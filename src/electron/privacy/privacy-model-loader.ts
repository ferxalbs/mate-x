import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { app } from "electron";

import type { PrivacyModelStatus } from "../../contracts/privacy";
import type { WorkspaceTrustContract } from "../../contracts/workspace";
import { fetchWithNetworkPolicy } from "../network-policy";

const REQUIRED_FILES = [
  "model.onnx",
  "config.json",
  "custom_label_space.json",
  "onnx_export_metadata.json",
];
const PINNED_MODEL_REVISION = "c49fa626439c153644585e59a89ab1b7a0d8b863";
const MAX_MODEL_ASSET_BYTES = 512 * 1024 * 1024;
const MODEL_NETWORK_POLICY = {
  allowedDomains: ["huggingface.co", "hf.co"],
} as WorkspaceTrustContract;
const EXPECTED_ASSET_SHA256: Record<string, string> = {
  "model.onnx": "99fa2fe9e5c8b14b9fb3efd86635b4aa14e35515366fefae18d7b7864579aaa1",
  "model.onnx.data": "2f9c665aed0c77709a4c271f52f5de3a63197bfc8237d1108ec034feaf9ffc2e",
  "config.json": "12cd5f2e64be3a5fbab49835a1a600daec5cd6c6bd3151a56c64fa98fe408b67",
  "custom_label_space.json": "c26fd5367ea21b1731e213ddfa87505c4889d05e681c70cc4e2226ce7a0cc8a3",
  "onnx_export_metadata.json": "b69bd46dbc9c32d5df0814b899c7a3b660f0e71cf6ee5e3be591a165cb6b81f5",
};

const DEFAULT_MODEL_CONFIG: Required<ModelConfig> = {
  huggingFaceRepo: "enosislabs/matex-privacy-sentinel-v0.15-onnx",
  revision: PINNED_MODEL_REVISION,
  downloadUrl: `https://huggingface.co/enosislabs/matex-privacy-sentinel-v0.15-onnx/resolve/${PINNED_MODEL_REVISION}`,
  apiUrl: `https://huggingface.co/api/models/enosislabs/matex-privacy-sentinel-v0.15-onnx/revision/${PINNED_MODEL_REVISION}`,
  requiredFiles: REQUIRED_FILES,
  externalDataFiles: ["model.onnx.data"],
  expectedSha256: EXPECTED_ASSET_SHA256,
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
  expectedSha256?: Record<string, string>;
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
  const config = mergeModelConfig(bundledConfig, userConfig);
  const requiredFiles = config.requiredFiles?.length ? config.requiredFiles : REQUIRED_FILES;
  const externalDataFiles = config.externalDataFiles ?? ["model.onnx.data"];
  const configError = validateModelConfig(config, [...requiredFiles, ...externalDataFiles]);
  const userState = await checkFiles(userDataPath, [...requiredFiles, ...externalDataFiles]);
  const bundledState = await checkFiles(bundledPath, [...requiredFiles, ...externalDataFiles]);
  const loadedFromUserData = userState.missingFiles.length === 0;
  const loadedFromBundled = bundledState.missingFiles.length === 0;
  const assetPath = loadedFromUserData ? userDataPath : loadedFromBundled ? bundledPath : userDataPath;
  const presentFiles = loadedFromUserData ? userState.presentFiles : loadedFromBundled ? bundledState.presentFiles : userState.presentFiles;
  const missingFiles = loadedFromUserData ? [] : loadedFromBundled ? [] : userState.missingFiles;

  const importError = configError ?? (missingFiles.length === 0 ? await detectRuntimeImportError() : undefined);

  return {
    model: "matex-privacy-v0.15",
    loaded: missingFiles.length === 0,
    missing: missingFiles.length > 0,
    assetPath,
    userDataPath,
    bundledPath,
    source: loadedFromUserData ? "userData" : loadedFromBundled ? "bundled" : "missing",
    huggingFaceRepo: config.huggingFaceRepo,
    revision: config.revision,
    requiredFiles,
    externalDataFiles,
    presentFiles,
    missingFiles,
    downloadUrl: config.downloadUrl,
    apiUrl: config.apiUrl,
    inferenceReady: missingFiles.length === 0 && !importError,
    inferenceError: importError,
    error: configError,
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
  const config = mergeModelConfig(await readModelConfig(bundledPath));
  const baseUrl = config.downloadUrl;

  const status = await loadPrivacyModelStatus();
  const targetFiles = [...config.requiredFiles, ...config.externalDataFiles];

  const configError = validateModelConfig(config, targetFiles);
  if (configError) {
    return { ...status, error: configError };
  }
  const remoteFiles = await fetchRemoteFiles(config.apiUrl);

  if (targetFiles.length === 0) {
    return {
      ...status,
      remoteFiles,
      error: "Privacy model repo has no compatible ONNX assets.",
    };
  }

  for (const [index, file] of targetFiles.entries()) {
    const response = await fetchPinnedResource(
      `${baseUrl}/${encodeURIComponent(file)}`,
      MAX_MODEL_ASSET_BYTES,
    );
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
    try {
      verifyPrivacyModelAsset(file, bytes, config.expectedSha256[file]);
    } catch (error) {
      await rm(tempPath, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : `Privacy model asset verification failed for ${file}.`;
      onProgress?.({
        state: "failed",
        file,
        fileIndex: index + 1,
        fileCount: targetFiles.length,
        receivedBytes: bytes.byteLength,
        message,
      });
      return {
        ...(await loadPrivacyModelStatus()),
        remoteFiles,
        error: message,
      };
    }
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
    const response = await fetchPinnedResource(apiUrl);
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

export function isPinnedModelRevision(revision: string): boolean {
  return /^[0-9a-f]{40}$/i.test(revision);
}

export function verifyPrivacyModelAsset(
  file: string,
  bytes: Uint8Array,
  expectedSha256: string | undefined,
): string {
  if (!expectedSha256 || !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new Error(`No valid SHA-256 is pinned for privacy model asset ${file}.`);
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Privacy model asset ${file} failed SHA-256 verification.`,
    );
  }
  return actualSha256;
}

function mergeModelConfig(...configs: ModelConfig[]): Required<ModelConfig> {
  const merged = configs.reduce<ModelConfig>(
    (current, config) => ({ ...current, ...config }),
    DEFAULT_MODEL_CONFIG,
  );
  const expectedSha256 = {
    ...DEFAULT_MODEL_CONFIG.expectedSha256,
    ...(configs[0]?.expectedSha256 ?? {}),
    ...(configs[1]?.expectedSha256 ?? {}),
  };
  const repo = merged.huggingFaceRepo ?? DEFAULT_MODEL_CONFIG.huggingFaceRepo;
  const revision = merged.revision ?? DEFAULT_MODEL_CONFIG.revision;
  return {
    ...merged,
    huggingFaceRepo: repo,
    revision,
    // Ignore configurable URLs. They are derived from the pinned repository
    // and revision so a stale config cannot restore a mutable `main` download.
    downloadUrl: `https://huggingface.co/${repo}/resolve/${revision}`,
    apiUrl: `https://huggingface.co/api/models/${repo}/revision/${revision}`,
    requiredFiles: merged.requiredFiles?.length ? merged.requiredFiles : REQUIRED_FILES,
    externalDataFiles: merged.externalDataFiles?.length
      ? merged.externalDataFiles
      : ["model.onnx.data"],
    expectedSha256,
  };
}

function validateModelConfig(config: Required<ModelConfig>, files: string[]): string | undefined {
  if (!isPinnedModelRevision(config.revision)) {
    return "Privacy model downloads require an immutable 40-character revision SHA.";
  }
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(config.huggingFaceRepo)) {
    return "Privacy model repository identifier is invalid.";
  }
  for (const file of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(file)) {
      return `Privacy model asset name is invalid: ${file}.`;
    }
    if (!/^[0-9a-f]{64}$/i.test(config.expectedSha256[file] ?? "")) {
      return `Privacy model asset ${file} has no pinned SHA-256.`;
    }
  }
  return undefined;
}

async function fetchPinnedResource(
  initialUrl: string,
  maxResponseBytes?: number,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchWithNetworkPolicy(
      currentUrl,
      { redirect: "error" },
      MODEL_NETWORK_POLICY,
      maxResponseBytes === undefined ? undefined : { maxResponseBytes },
    );
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Privacy model redirect did not include a location.");
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error("Privacy model download exceeded the redirect limit.");
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
