import { Supermemory } from "supermemory";
import type { Tool } from "../tool-service";

export const supermemoryTool: Tool = {
  name: "supermemory",
  description: "Access Supermemory to store or retrieve long-term context, user preferences, and knowledge.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "profile", "search"],
        description: "The action to perform."
      },
      content: {
        type: "string",
        description: "The content to add (for 'add' action)."
      },
      query: {
        type: "string",
        description: "The query for searching or profile retrieval."
      },
      containerTag: {
        type: "string",
        description: "The tag to isolate memory (e.g. project name or user id). Defaults to the current workspace path."
      }
    },
    required: ["action"]
  },
  async execute(args, { settings, workspacePath }) {
    const { action, content, query, containerTag } = args;
    const apiKey = settings.supermemoryApiKey;

    if (!apiKey) {
      return "Error: Supermemory API Key is not configured in Settings. Please ask the user to provide it.";
    }

    const sm = new Supermemory({ apiKey });
    const tag = containerTag || workspacePath;

    try {
      switch (action) {
        case "add": {
          if (!content) return "Error: 'content' is required for 'add' action.";
          await sm.add({ content, containerTag: tag });
          return `Successfully added content to Supermemory with tag '${tag}'.`;
        }

        case "search": {
          if (!query) return "Error: 'query' is required for 'search' action.";
          const searchResult = await sm.search.execute({ q: query, containerTags: [tag] });
          return JSON.stringify(searchResult, null, 2);
        }

        case "profile": {
          if (!query) return "Error: 'query' is required for 'profile' action.";
          const profileResult = await sm.profile({ q: query, containerTag: tag });
          return JSON.stringify(profileResult, null, 2);
        }

        default:
          return `Error: Unknown action '${action}'.`;
      }
    } catch (error) {
      return `Error interacting with Supermemory: ${(error as Error).message}`;
    }
  }
};
