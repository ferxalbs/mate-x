import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Tool } from "../tool-service";
import {
  analyzePatchAfter,
  analyzePatchBefore,
  assessPatchBeforeWrite,
  formatPatchImpactBlocked,
  formatPatchImpactSkipped,
  formatPatchImpactSummary,
} from "../patch-impact-engine";
import { resolveWorkspacePath } from "./tool-utils";

export const autoPatchTool: Tool = {
  name: "auto_patch",
  description:
    "An Active Remediation tool that replaces a vulnerable block of code with a secure patch and returns PATCH_IMPACT_SUMMARY_JSON. Does not create backup files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file to patch (relative to workspace).",
      },
      searchString: {
        type: "string",
        description: "The exact vulnerable string/block to replace. Must exactly match the file.",
      },
      replacementString: {
        type: "string",
        description: "The secure code to inject.",
      },
      replaceAll: {
        type: "boolean",
        description:
          "Replace every occurrence when true. Defaults to false (single replacement).",
      },
      allowHighImpact: {
        type: "boolean",
        description:
          "Set true only after explicit user confirmation when PATCH_IMPACT_DECISION requires confirmation.",
      },
    },
    required: ["path", "searchString", "replacementString"],
  },
  async execute(args, { workspacePath }) {
    const { path, searchString, replacementString, replaceAll = false, allowHighImpact = false } = args;
    const targetFile = resolveWorkspacePath(workspacePath, path);

    try {
      const content = await readFile(targetFile, "utf8");
      const impactBefore = await analyzePatchBefore(workspacePath, String(path));
      const decision = assessPatchBeforeWrite(impactBefore);

      if (!content.includes(searchString)) {
        return `Patch failed: The exact searchString was not found in ${path}.`;
      }

      const replacementCount = content.split(searchString).length - 1;
      const newContent = replaceAll
        ? content.split(searchString).join(replacementString)
        : content.replace(searchString, replacementString);
      if (newContent === content) {
        return formatPatchImpactSkipped(impactBefore.targetFile, decision, impactBefore.summary);
      }
      if (decision.requiresConfirmation && allowHighImpact !== true) {
        return formatPatchImpactBlocked(impactBefore.targetFile, decision, impactBefore.summary);
      }

      await writeFile(targetFile, newContent, "utf8");
      const impactSummary = await analyzePatchAfter(impactBefore);

      const rel = relative(workspacePath, targetFile);
      return `Patch applied successfully to ${rel}. Replaced ${
        replaceAll ? replacementCount : 1
      } occurrence(s).\nNo backup file was created.\n${formatPatchImpactSummary(impactSummary)}`;
    } catch (error) {
      return `Error applying patch: ${(error as Error).message}`;
    }
  },
};
