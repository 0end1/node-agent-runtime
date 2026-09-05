/**
 * A pragmatic subset of JSON Schema used to describe & validate tool arguments.
 * Dependency-free on purpose.
 */

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  /** Open-ended objects (untyped tool payloads) are allowed via {} */
  additionalProperties?: boolean;
}

type JsonTypeName =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

function jsonTypeOf(v: unknown): JsonTypeName {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "null";
  }
}

function typeAllows(v: unknown, type: JsonSchemaType): boolean {
  if (type === "number" || type === "integer") {
    return (
      typeof v === "number" &&
      Number.isFinite(v) &&
      (type === "number" || Number.isInteger(v))
    );
  }
  return jsonTypeOf(v) === type;
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[]
): void {
  if (!schema || typeof schema !== "object") return;

  const type = schema.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    const ok = types.some((t) => typeAllows(value, t));
    if (!ok) {
      errors.push(`${path}: 类型应为 ${types.join(" | ")}，实际为 ${jsonTypeOf(value)}`);
      return;
    }
  }

  if (value === null || value === undefined) return;

  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: 取值必须在枚举 ${JSON.stringify(schema.enum)} 中`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: 不能小于 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: 不能大于 ${schema.maximum}`);
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateValue(item, schema.items!, `${path}[${i}]`, errors));
  }

  if (
    !Array.isArray(value) &&
    typeof value === "object" &&
    schema.properties
  ) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateValue((value as Record<string, unknown>)[key], childSchema, `${path}.${key}`, errors);
      }
    }
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in (value as Record<string, unknown>))) {
        errors.push(`${path}: 缺少必填字段 "${requiredKey}"`);
      }
    }
  }
}

/**
 * Validate an unknown payload against a schema.
 * Returns a list of human-readable errors (empty array == valid).
 */
export function validate(value: unknown, schema: JsonSchema): string[] {
  if (!schema || Object.keys(schema).length === 0) return [];
  const errors: string[] = [];
  validateValue(value, schema, "$", errors);
  return errors;
}
