export type DatabasePropertyType = "text" | "checkbox" | "select" | "date";
export const DATABASE_TITLE_PROPERTY_ID = "__title__";

export type DatabaseSortDirection = "asc" | "desc";
export type DatabaseFilterOperator = "contains" | "equals" | "is_empty";
export type DatabaseViewMode = "table" | "board";

export interface DatabaseProperty {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options?: string[];
}

export interface DatabaseSchema {
  properties: DatabaseProperty[];
  sort?: DatabaseSort;
  filter?: DatabaseFilter;
  view?: DatabaseViewMode;
  boardPropertyId?: string;
  boardViewEnabled?: boolean;
}

export type DatabaseProperties = Record<string, string | boolean>;

export interface DatabaseSort {
  propertyId: string;
  direction: DatabaseSortDirection;
}

export interface DatabaseFilter {
  propertyId: string;
  operator: DatabaseFilterOperator;
  value?: string | boolean;
}

export interface DatabaseRowLike {
  id?: string;
  title: string;
  properties?: string | null;
}

export interface DatabaseTemplateRowLike {
  is_template?: number;
}

export interface DatabaseBoardColumn<T extends DatabaseRowLike> {
  id: string;
  name: string;
  rows: T[];
}

export function defaultDatabaseSchema(): DatabaseSchema {
  return {
    properties: [
      { id: "status", name: "Status", type: "select", options: ["Not started", "In progress", "Done"] },
      { id: "done", name: "Done", type: "checkbox" },
      { id: "date", name: "Date", type: "date" },
    ],
  };
}

function isDatabaseProperty(value: unknown): value is DatabaseProperty {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const property = value as Record<string, unknown>;
  return (
    typeof property.id === "string" &&
    typeof property.name === "string" &&
    (property.type === "text" || property.type === "checkbox" || property.type === "select" || property.type === "date") &&
    (property.options === undefined ||
      (Array.isArray(property.options) && property.options.every((option) => typeof option === "string")))
  );
}

function isDatabaseSort(value: unknown): value is DatabaseSort {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const sort = value as Record<string, unknown>;
  return typeof sort.propertyId === "string" && (sort.direction === "asc" || sort.direction === "desc");
}

function isDatabaseFilter(value: unknown): value is DatabaseFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const filter = value as Record<string, unknown>;
  return (
    typeof filter.propertyId === "string" &&
    (filter.operator === "contains" || filter.operator === "equals" || filter.operator === "is_empty") &&
    (filter.value === undefined || typeof filter.value === "string" || typeof filter.value === "boolean")
  );
}

function isDatabaseViewMode(value: unknown): value is DatabaseViewMode {
  return value === "table" || value === "board";
}

export function parseDatabaseSchema(value: string | null | undefined): DatabaseSchema {
  if (!value) return defaultDatabaseSchema();

  try {
    const parsed = JSON.parse(value);
    const properties =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).properties
        : null;

    if (Array.isArray(properties) && properties.every(isDatabaseProperty)) {
      const record = parsed as Record<string, unknown>;
      const schema: DatabaseSchema = {
        properties,
      };

      if (isDatabaseSort(record.sort)) {
        schema.sort = record.sort;
      }

      if (isDatabaseFilter(record.filter)) {
        schema.filter = record.filter;
      }

      if (isDatabaseViewMode(record.view)) {
        schema.view = record.view;
      }

      if (typeof record.boardPropertyId === "string") {
        schema.boardPropertyId = record.boardPropertyId;
      }

      if (typeof record.boardViewEnabled === "boolean") {
        schema.boardViewEnabled = record.boardViewEnabled;
      }

      return schema;
    }
  } catch {
    return defaultDatabaseSchema();
  }

  return defaultDatabaseSchema();
}

export function isBoardViewEnabled(schema: DatabaseSchema): boolean {
  return schema.boardViewEnabled !== false || schema.view === "board";
}

export function deleteDatabaseBoardView(schema: DatabaseSchema): DatabaseSchema {
  const nextSchema: DatabaseSchema = {
    ...schema,
    view: "table",
    boardViewEnabled: false,
  };

  delete nextSchema.boardPropertyId;
  return nextSchema;
}

export function parseDatabaseProperties(value: string | null | undefined): DatabaseProperties {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as DatabaseProperties;
    }
  } catch {
    return {};
  }

  return {};
}

export function addDatabaseProperty(
  schema: DatabaseSchema,
  name: string,
  id: string,
  type: DatabasePropertyType = "text"
): DatabaseSchema {
  return {
    ...schema,
    properties: [
      ...schema.properties,
      {
        id,
        name: name.trim() || "Property",
        type,
      },
    ],
  };
}

export function updateDatabaseSchemaProperty(
  schema: DatabaseSchema,
  propertyId: string,
  updates: Partial<DatabaseProperty>
): DatabaseSchema {
  return {
    ...schema,
    properties: schema.properties.map((property) => {
      if (property.id !== propertyId) return property;

      const type = updates.type ?? property.type;
      const nextProperty: DatabaseProperty = {
        ...property,
        ...updates,
        name: updates.name?.trim() || property.name,
        type,
      };

      if (type !== "select") {
        delete nextProperty.options;
      }

      return nextProperty;
    }),
  };
}

export function deleteDatabaseProperty(schema: DatabaseSchema, propertyId: string): DatabaseSchema {
  const nextSchema: DatabaseSchema = {
    ...schema,
    properties: schema.properties.filter((property) => property.id !== propertyId),
  };

  if (nextSchema.sort?.propertyId === propertyId) {
    delete nextSchema.sort;
  }

  if (nextSchema.filter?.propertyId === propertyId) {
    delete nextSchema.filter;
  }

  if (nextSchema.boardPropertyId === propertyId) {
    nextSchema.view = "table";
    delete nextSchema.boardPropertyId;
  }

  return nextSchema;
}

export function updateDatabaseView(
  schema: DatabaseSchema,
  updates: { sort?: DatabaseSort | null; filter?: DatabaseFilter | null; view?: DatabaseViewMode; boardPropertyId?: string | null }
): DatabaseSchema {
  const nextSchema: DatabaseSchema = {
    ...schema,
    properties: [...schema.properties],
  };

  if ("sort" in updates) {
    if (updates.sort) {
      nextSchema.sort = updates.sort;
    } else {
      delete nextSchema.sort;
    }
  }

  if ("filter" in updates) {
    if (updates.filter) {
      nextSchema.filter = updates.filter;
    } else {
      delete nextSchema.filter;
    }
  }

  if ("view" in updates && updates.view) {
    nextSchema.view = updates.view;
    if (updates.view === "board") {
      nextSchema.boardViewEnabled = true;
    }
  }

  if ("boardPropertyId" in updates) {
    if (updates.boardPropertyId) {
      nextSchema.boardPropertyId = updates.boardPropertyId;
    } else {
      delete nextSchema.boardPropertyId;
    }
  }

  return nextSchema;
}

export function selectedBoardProperty(schema: DatabaseSchema): DatabaseProperty | null {
  const selected = schema.properties.find(
    (property) => property.type === "select" && property.id === schema.boardPropertyId
  );

  return selected ?? schema.properties.find((property) => property.type === "select") ?? null;
}

export function groupDatabaseBoardRows<T extends DatabaseRowLike>(
  rows: T[],
  schema: DatabaseSchema
): DatabaseBoardColumn<T>[] {
  const property = selectedBoardProperty(schema);

  if (!property) return [];

  const options = property.options ?? [];

  return options.map((option) => ({
    id: option,
    name: option,
    rows: rows.filter((row) => databaseRowValue(row, property.id) === option),
  }));
}

function databaseRowValue(row: DatabaseRowLike, propertyId: string): string | boolean {
  if (propertyId === DATABASE_TITLE_PROPERTY_ID) {
    return row.title || "";
  }

  return parseDatabaseProperties(row.properties)[propertyId] ?? "";
}

export function filterDatabaseRows<T extends DatabaseRowLike>(rows: T[], schema: DatabaseSchema): T[] {
  const filter = schema.filter;

  if (!filter) return rows;

  return rows.filter((row) => {
    const value = databaseRowValue(row, filter.propertyId);

    if (filter.operator === "is_empty") {
      return value === "";
    }

    if (filter.operator === "contains") {
      return String(value).toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    }

    return value === filter.value;
  });
}

export function sortDatabaseRows<T extends DatabaseRowLike>(rows: T[], schema: DatabaseSchema): T[] {
  const sort = schema.sort;

  if (!sort) return rows;

  const direction = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((first, second) => {
    const firstValue = databaseRowValue(first, sort.propertyId);
    const secondValue = databaseRowValue(second, sort.propertyId);
    const comparison = String(firstValue).localeCompare(String(secondValue), undefined, {
      numeric: true,
      sensitivity: "base",
    });

    return comparison * direction;
  });
}

export function visibleDatabaseRows<T extends DatabaseRowLike>(rows: T[], schema: DatabaseSchema): T[] {
  return sortDatabaseRows(filterDatabaseRows(rows, schema), schema);
}

export function databaseDataRows<T extends DatabaseTemplateRowLike>(rows: T[]): T[] {
  return rows.filter((row) => row.is_template !== 1);
}

export function databaseTemplateRows<T extends DatabaseTemplateRowLike>(rows: T[]): T[] {
  return rows.filter((row) => row.is_template === 1);
}

export function updateDatabaseProperty(
  value: string | null | undefined,
  propertyId: string,
  nextValue: string | boolean
): string {
  return JSON.stringify({
    ...parseDatabaseProperties(value),
    [propertyId]: nextValue,
  });
}
