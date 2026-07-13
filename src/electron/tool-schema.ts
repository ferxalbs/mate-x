import type { Tool, ToolParametersSchema } from "./tool-types";

const strictSchemaCache = new WeakMap<object, ToolParametersSchema>();

export function toStrictObjectSchema(schema: Tool["parameters"]): Tool["parameters"] {
  const cached = strictSchemaCache.get(schema);
  if (cached) {
    return cached;
  }

  const normalized = strictifySchemaNode(schema);
  const result: ToolParametersSchema = {
    ...normalized,
    type: "object",
    required: Array.isArray(normalized.required) ? normalized.required : [],
  };
  strictSchemaCache.set(schema, result);
  return result;
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
    if (!(key in values) || values[key] === undefined) {
      return `Missing required argument "${key}".`;
    }
  }

  for (const key of Object.keys(values)) {
    // Allow undefined optional fields without treating them as present values.
    if (values[key] === undefined) {
      continue;
    }

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
      return validateStringValue(value, schema, keyPath);
    case "number":
    case "integer":
      return validateNumberValue(value, schema, keyPath, schema.type === "integer");
    case "boolean":
      if (typeof value !== "boolean") {
        return `"${keyPath}" must be a boolean.`;
      }
      return null;
    case "array":
      return validateArrayValue(value, schema, keyPath);
    case "object":
      return validateObjectValueAgainstSchema(value, schema, keyPath);
    default:
      // Union / untyped nodes: accept to avoid rejecting valid provider schemas.
      return null;
  }
}

function validateStringValue(
  value: unknown,
  schema: any,
  keyPath: string,
): string | null {
  if (typeof value !== "string") {
    return `"${keyPath}" must be a string.`;
  }

  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    return `"${keyPath}" must be at least ${schema.minLength} characters.`;
  }

  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    return `"${keyPath}" must be at most ${schema.maxLength} characters.`;
  }

  if (typeof schema.pattern === "string") {
    try {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        return `"${keyPath}" does not match required pattern.`;
      }
    } catch {
      // Invalid pattern in schema — ignore rather than block execution.
    }
  }

  return null;
}

function validateNumberValue(
  value: unknown,
  schema: any,
  keyPath: string,
  integerOnly: boolean,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `"${keyPath}" must be a finite number.`;
  }

  if (integerOnly && !Number.isInteger(value)) {
    return `"${keyPath}" must be an integer.`;
  }

  if (typeof schema.minimum === "number" && value < schema.minimum) {
    return `"${keyPath}" must be >= ${schema.minimum}.`;
  }

  if (typeof schema.maximum === "number" && value > schema.maximum) {
    return `"${keyPath}" must be <= ${schema.maximum}.`;
  }

  if (
    typeof schema.exclusiveMinimum === "number" &&
    value <= schema.exclusiveMinimum
  ) {
    return `"${keyPath}" must be > ${schema.exclusiveMinimum}.`;
  }

  if (
    typeof schema.exclusiveMaximum === "number" &&
    value >= schema.exclusiveMaximum
  ) {
    return `"${keyPath}" must be < ${schema.exclusiveMaximum}.`;
  }

  return null;
}

function validateArrayValue(
  value: unknown,
  schema: any,
  keyPath: string,
): string | null {
  if (!Array.isArray(value)) {
    return `"${keyPath}" must be an array.`;
  }

  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    return `"${keyPath}" must contain at least ${schema.minItems} items.`;
  }

  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    return `"${keyPath}" must contain at most ${schema.maxItems} items.`;
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
    if (!(requiredKey in objectValue) || objectValue[requiredKey] === undefined) {
      return `Missing required argument "${keyPath}.${requiredKey}".`;
    }
  }

  for (const childKey of Object.keys(objectValue)) {
    if (objectValue[childKey] === undefined) {
      continue;
    }

    const childSchema = properties[childKey];
    if (!childSchema) {
      if (schema.additionalProperties === false) {
        return `Unexpected argument "${keyPath}.${childKey}".`;
      }
      // When additionalProperties is not explicitly false, still reject unknown
      // keys for tool args (strict agent contracts).
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
