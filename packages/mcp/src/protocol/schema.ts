// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Tool arguments are validated against each tool's input schema before the
// tool runs (the MCP spec: servers MUST validate all tool inputs). The
// schemas are ours and use a small, closed subset of JSON Schema 2020-12 —
// no $ref, no composition — so a validator this size can be exact. Unknown
// properties are refused everywhere: an argument the tool does not declare
// is a mistake or an attack, never something to ignore.

export type Schema =
  | {
      type: "object";
      description?: string;
      properties: Record<string, Schema>;
      required?: string[];
      additionalProperties: false;
    }
  | {
      type: "string";
      description?: string;
      enum?: string[];
      minLength?: number;
      maxLength: number;
      pattern?: string;
      default?: string;
    }
  | {
      type: "integer" | "number";
      description?: string;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | { type: "boolean"; description?: string; default?: boolean }
  | {
      type: "array";
      description?: string;
      items: Schema;
      minItems?: number;
      maxItems: number;
    };

export type ObjectSchema = Extract<Schema, { type: "object" }>;

export class SchemaError extends Error {}

const compiled = new Map<string, RegExp>();
function regex(pattern: string): RegExp {
  let r = compiled.get(pattern);
  if (!r) compiled.set(pattern, (r = new RegExp(pattern, "u")));
  return r;
}

/** Throw a SchemaError naming the first problem; return the value otherwise. */
export function validate(
  schema: Schema,
  value: unknown,
  at = "arguments",
): void {
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new SchemaError(`${at} must be an object`);
      const o = value as Record<string, unknown>;
      for (const key of Object.keys(o)) {
        if (!Object.hasOwn(schema.properties, key))
          throw new SchemaError(`${at}.${key} is not a known argument`);
      }
      for (const key of schema.required ?? []) {
        if (o[key] === undefined)
          throw new SchemaError(`${at}.${key} is required`);
      }
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (o[key] !== undefined) validate(sub, o[key], `${at}.${key}`);
      }
      return;
    }
    case "string": {
      if (typeof value !== "string")
        throw new SchemaError(`${at} must be a string`);
      const n = [...value].length;
      if (n > schema.maxLength)
        throw new SchemaError(`${at} is longer than ${schema.maxLength}`);
      if (schema.minLength !== undefined && n < schema.minLength)
        throw new SchemaError(`${at} is shorter than ${schema.minLength}`);
      if (schema.enum && !schema.enum.includes(value))
        throw new SchemaError(`${at} must be one of ${schema.enum.join(", ")}`);
      if (schema.pattern && !regex(schema.pattern).test(value))
        throw new SchemaError(`${at} has an invalid format`);
      return;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new SchemaError(`${at} must be a number`);
      if (schema.type === "integer" && !Number.isSafeInteger(value))
        throw new SchemaError(`${at} must be an integer`);
      if (schema.minimum !== undefined && value < schema.minimum)
        throw new SchemaError(`${at} must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum)
        throw new SchemaError(`${at} must be at most ${schema.maximum}`);
      return;
    }
    case "boolean":
      if (typeof value !== "boolean")
        throw new SchemaError(`${at} must be true or false`);
      return;
    case "array": {
      if (!Array.isArray(value))
        throw new SchemaError(`${at} must be an array`);
      if (value.length > schema.maxItems)
        throw new SchemaError(`${at} has more than ${schema.maxItems} items`);
      if (schema.minItems !== undefined && value.length < schema.minItems)
        throw new SchemaError(`${at} has fewer than ${schema.minItems} items`);
      value.forEach((v, i) => validate(schema.items, v, `${at}[${i}]`));
      return;
    }
  }
}

// ---- builders (keep tool definitions short and uniform) ------------------------

export const s = {
  object(
    properties: Record<string, Schema>,
    required: string[] = [],
  ): ObjectSchema {
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  },
  string(
    description: string,
    opts: Partial<Omit<Extract<Schema, { type: "string" }>, "type">> = {},
  ): Schema {
    return { type: "string", description, maxLength: 1024, ...opts };
  },
  enum(description: string, values: string[]): Schema {
    return { type: "string", description, enum: values, maxLength: 64 };
  },
  integer(description: string, minimum?: number, maximum?: number): Schema {
    return { type: "integer", description, minimum, maximum };
  },
  boolean(description: string): Schema {
    return { type: "boolean", description };
  },
  array(description: string, items: Schema, maxItems: number): Schema {
    return { type: "array", description, items, maxItems };
  },
};
