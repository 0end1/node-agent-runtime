/**
 * A pragmatic subset of JSON Schema used to describe & validate tool arguments.
 * Dependency-free on purpose.
 */

export type JsonSchemaType =
  "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

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

type JsonTypeName = "string" | "number" | "boolean" | "null" | "array" | "object";

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
      typeof v === "number" && Number.isFinite(v) && (type === "number" || Number.isInteger(v))
    );
  }
  return jsonTypeOf(v) === type;
}

function validateValue(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
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

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))
  ) {
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

  if (!Array.isArray(value) && typeof value === "object" && schema.properties) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateValue(
          (value as Record<string, unknown>)[key],
          childSchema,
          `${path}.${key}`,
          errors,
        );
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

const SCHEMA_TYPES = new Set<JsonSchemaType>([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
  "null",
]);

/** Guards against pathological / accidentally cyclic schemas. */
const MAX_SCHEMA_DEPTH = 12;

/**
 * Validate a JSON Schema *itself* — not a value against it (that is `validate`).
 *
 * Returns human-readable errors (empty array == structurally sound). A schema
 * that is wrong (misspelled `type`, `required` naming a property that does not
 * exist, `minimum > maximum`) never fails loudly at runtime: it just makes the
 * model call the tool wrong forever. Compiling the recipe is the only cheap
 * place to catch it (M7-5, docs/m7-base-governance.md §8-11).
 */
export function validateSchema(schema: JsonSchema, path = "$", depth = 0): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${path}: schema 必须是对象`];
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    return [`${path}: schema 嵌套过深（超过 ${MAX_SCHEMA_DEPTH} 层）`];
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0) errors.push(`${path}: type 为数组时不得为空`);
    for (const t of types) {
      if (!SCHEMA_TYPES.has(t)) {
        errors.push(`${path}: 未知 type "${t}"（应为 ${[...SCHEMA_TYPES].join(" | ")}）`);
      }
    }
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum)) errors.push(`${path}: enum 必须是数组`);
    else if (schema.enum.length === 0) errors.push(`${path}: enum 不得为空数组`);
  }

  if (schema.minimum !== undefined && typeof schema.minimum !== "number") {
    errors.push(`${path}: minimum 必须是数字`);
  }
  if (schema.maximum !== undefined && typeof schema.maximum !== "number") {
    errors.push(`${path}: maximum 必须是数字`);
  }
  if (
    typeof schema.minimum === "number" &&
    typeof schema.maximum === "number" &&
    schema.minimum > schema.maximum
  ) {
    errors.push(`${path}: minimum（${schema.minimum}）不能大于 maximum（${schema.maximum}）`);
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((k) => typeof k !== "string")) {
      errors.push(`${path}: required 必须是字符串数组`);
    } else {
      const properties = schema.properties ?? {};
      for (const key of schema.required) {
        if (!(key in properties)) {
          errors.push(`${path}: required 引用了未定义的属性 "${key}"`);
        }
      }
    }
  }

  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
      errors.push(`${path}: properties 必须是对象`);
    } else {
      for (const [key, child] of Object.entries(schema.properties)) {
        errors.push(...validateSchema(child, `${path}.${key}`, depth + 1));
      }
    }
  }

  if (schema.items !== undefined) {
    errors.push(...validateSchema(schema.items, `${path}.items`, depth + 1));
  }

  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    errors.push(`${path}: additionalProperties 必须是布尔值`);
  }

  if (schema.description !== undefined && typeof schema.description !== "string") {
    errors.push(`${path}: description 必须是字符串`);
  }

  return errors;
}
