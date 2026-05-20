import type { Tool } from "./tool-types";

export function toStrictObjectSchema(schema: Tool["parameters"]): Tool["parameters"] {
  const normalized = strictifySchemaNode(schema);
  return {
    ...normalized,
    type: "object",
    required: Array.isArray(normalized.required) ? normalized.required : [],
  };
}

export function validateToolArguments(tool: Tool, args: unknown): string | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return "Arguments must be a JSON object.";
  }

  const values = args as Record<string, unknown>;
  const schema = tool.parameters;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of required) {
    if (!(key in values)) {
      return `Missing required argument "${key}".`;
    }
  }

  for (const key of Object.keys(values)) {
    const propertySchema = properties[key] as any;
    if (!propertySchema) {
      return `Unexpected argument "${key}".`;
    }

    const error = validateValueAgainstSchema(values[key], propertySchema, key);
    if (error) {
      return error;
    }
  }

  return null;
}

function strictifySchemaNode(node: any): any {
  if (!node || typeof node !== "object") {
    return node;
  }

  if (node.type === "object") {
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).map(([key, value]) => [
        key,
        strictifySchemaNode(value),
      ]),
    );

    return {
      ...node,
      properties,
      additionalProperties: false,
      required: Array.isArray(node.required) ? node.required : [],
    };
  }

  if (node.type === "array" && node.items) {
    return {
      ...node,
      items: strictifySchemaNode(node.items),
    };
  }

  return node;
}

function validateValueAgainstSchema(
  value: unknown,
  schema: any,
  keyPath: string,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `"${keyPath}" must be one of: ${schema.enum.join(", ")}.`;
  }

  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        return `"${keyPath}" must be a string.`;
      }
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `"${keyPath}" must be a finite number.`;
      }
      return null;
    case "boolean":
      if (typeof value !== "boolean") {
        return `"${keyPath}" must be a boolean.`;
      }
      return null;
    case "array":
      if (!Array.isArray(value)) {
        return `"${keyPath}" must be an array.`;
      }

      if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
          const childError = validateValueAgainstSchema(
            value[index],
            schema.items,
            `${keyPath}[${index}]`,
          );
          if (childError) {
            return childError;
          }
        }
      }

      return null;
    case "object":
      return validateObjectValueAgainstSchema(value, schema, keyPath);
    default:
      return null;
  }
}

function validateObjectValueAgainstSchema(
  value: unknown,
  schema: any,
  keyPath: string,
): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `"${keyPath}" must be an object.`;
  }

  if (!schema.properties || typeof schema.properties !== "object") {
    return null;
  }

  const objectValue = value as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const requiredKey of required) {
    if (!(requiredKey in objectValue)) {
      return `Missing required argument "${keyPath}.${requiredKey}".`;
    }
  }

  for (const childKey of Object.keys(objectValue)) {
    const childSchema = properties[childKey];
    if (!childSchema) {
      return `Unexpected argument "${keyPath}.${childKey}".`;
    }

    const childError = validateValueAgainstSchema(
      objectValue[childKey],
      childSchema,
      `${keyPath}.${childKey}`,
    );
    if (childError) {
      return childError;
    }
  }

  return null;
}
