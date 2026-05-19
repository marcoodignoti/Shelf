import { describe, expect, it } from "vitest";
import {
  addDatabaseProperty,
  defaultDatabaseSchema,
  deleteDatabaseProperty,
  databaseDataRows,
  databaseTemplateRows,
  groupDatabaseBoardRows,
  filterDatabaseRows,
  parseDatabaseProperties,
  parseDatabaseSchema,
  selectedBoardProperty,
  sortDatabaseRows,
  updateDatabaseProperty,
  updateDatabaseSchemaProperty,
  updateDatabaseView,
  deleteDatabaseBoardView,
  isBoardViewEnabled,
} from "./database";

describe("database schema", () => {
  it("creates a useful default schema for database v1", () => {
    expect(defaultDatabaseSchema()).toEqual({
      properties: [
        { id: "status", name: "Status", type: "select", options: ["Not started", "In progress", "Done"] },
        { id: "done", name: "Done", type: "checkbox" },
        { id: "date", name: "Date", type: "date" },
      ],
    });
  });

  it("falls back to default schema when persisted schema is invalid", () => {
    expect(parseDatabaseSchema(null)).toEqual(defaultDatabaseSchema());
    expect(parseDatabaseSchema("{bad json")).toEqual(defaultDatabaseSchema());
  });

  it("keeps valid persisted sort and filter state", () => {
    expect(
      parseDatabaseSchema(
        JSON.stringify({
          properties: [{ id: "status", name: "Status", type: "select" }],
          sort: { propertyId: "status", direction: "desc" },
          filter: { propertyId: "status", operator: "equals", value: "Done" },
        })
      )
    ).toEqual({
      properties: [{ id: "status", name: "Status", type: "select" }],
      sort: { propertyId: "status", direction: "desc" },
      filter: { propertyId: "status", operator: "equals", value: "Done" },
    });
  });

  it("keeps valid persisted board view state", () => {
    expect(
      parseDatabaseSchema(
        JSON.stringify({
          properties: [{ id: "status", name: "Status", type: "select", options: ["Todo", "Done"] }],
          view: "board",
          boardPropertyId: "status",
        })
      )
    ).toEqual({
      properties: [{ id: "status", name: "Status", type: "select", options: ["Todo", "Done"] }],
      view: "board",
      boardPropertyId: "status",
    });
  });

  it("deletes board view while preserving table data", () => {
    const schema = deleteDatabaseBoardView({
      properties: [{ id: "status", name: "Status", type: "select", options: ["Todo"] }],
      view: "board",
      boardPropertyId: "status",
    });

    expect(schema).toEqual({
      properties: [{ id: "status", name: "Status", type: "select", options: ["Todo"] }],
      view: "table",
      boardViewEnabled: false,
    });
    expect(isBoardViewEnabled(schema)).toBe(false);
  });

  it("falls back when persisted select options are malformed", () => {
    expect(
      parseDatabaseSchema(
        JSON.stringify({
          properties: [{ id: "status", name: "Status", type: "select", options: ["Todo", 7] }],
        })
      )
    ).toEqual(defaultDatabaseSchema());
  });

  it("adds a text property with a stable generated id", () => {
    expect(addDatabaseProperty({ properties: [] }, "Priority", "property-1")).toEqual({
      properties: [{ id: "property-1", name: "Priority", type: "text" }],
    });
  });

  it("adds a property without dropping database view state", () => {
    expect(
      addDatabaseProperty(
        {
          properties: [{ id: "status", name: "Status", type: "select", options: ["Todo"] }],
          sort: { propertyId: "status", direction: "asc" },
          filter: { propertyId: "status", operator: "equals", value: "Todo" },
          view: "board",
          boardPropertyId: "status",
        },
        "Priority",
        "priority"
      )
    ).toEqual({
      properties: [
        { id: "status", name: "Status", type: "select", options: ["Todo"] },
        { id: "priority", name: "Priority", type: "text" },
      ],
      sort: { propertyId: "status", direction: "asc" },
      filter: { propertyId: "status", operator: "equals", value: "Todo" },
      view: "board",
      boardPropertyId: "status",
    });
  });

  it("renames, changes type, and stores select options", () => {
    const schema = updateDatabaseSchemaProperty(
      { properties: [{ id: "status", name: "Status", type: "text" }] },
      "status",
      { name: "Stage", type: "select", options: ["Idea", "Done"] }
    );

    expect(schema).toEqual({
      properties: [{ id: "status", name: "Stage", type: "select", options: ["Idea", "Done"] }],
    });
  });

  it("deletes a property from schema", () => {
    expect(
      deleteDatabaseProperty(
        {
          properties: [
            { id: "status", name: "Status", type: "select" },
            { id: "date", name: "Date", type: "date" },
          ],
        },
        "status"
      )
    ).toEqual({
      properties: [{ id: "date", name: "Date", type: "date" }],
    });
  });

  it("clears sort and filter when their property is deleted", () => {
    expect(
      deleteDatabaseProperty(
        {
          properties: [{ id: "status", name: "Status", type: "select" }],
          sort: { propertyId: "status", direction: "asc" },
          filter: { propertyId: "status", operator: "equals", value: "Done" },
        },
        "status"
      )
    ).toEqual({
      properties: [],
    });
  });

  it("clears board state when its property is deleted", () => {
    expect(
      deleteDatabaseProperty(
        {
          properties: [{ id: "status", name: "Status", type: "select", options: ["Todo"] }],
          view: "board",
          boardPropertyId: "status",
        },
        "status"
      )
    ).toEqual({
      properties: [],
      view: "table",
    });
  });

  it("updates view state without changing properties", () => {
    expect(
      updateDatabaseView(
        { properties: [{ id: "status", name: "Status", type: "select" }] },
        { sort: { propertyId: "status", direction: "asc" } }
      )
    ).toEqual({
      properties: [{ id: "status", name: "Status", type: "select" }],
      sort: { propertyId: "status", direction: "asc" },
    });
  });
});

describe("database properties", () => {
  it("updates one persisted row property without dropping the others", () => {
    const properties = updateDatabaseProperty('{"status":"Not started"}', "done", true);

    expect(parseDatabaseProperties(properties)).toEqual({
      status: "Not started",
      done: true,
    });
  });
});

describe("database rows", () => {
  const rows = [
    { id: "a", title: "Alpha", properties: '{"status":"Done","done":true,"date":"2026-05-20"}' },
    { id: "b", title: "Beta", properties: '{"status":"Idea","done":false,"date":""}' },
    { id: "c", title: "Gamma", properties: '{"status":"Doing","done":true,"date":"2026-05-18"}' },
  ];

  it("separates real rows from row templates", () => {
    const mixedRows = [
      { id: "row", title: "Task", properties: null, is_template: 0 },
      { id: "template", title: "Bug template", properties: null, is_template: 1 },
    ];

    expect(databaseDataRows(mixedRows).map((row) => row.id)).toEqual(["row"]);
    expect(databaseTemplateRows(mixedRows).map((row) => row.id)).toEqual(["template"]);
  });

  it("filters text, select, checkbox, and empty date values", () => {
    expect(
      filterDatabaseRows(rows, {
        properties: [{ id: "status", name: "Status", type: "select" }],
        filter: { propertyId: "status", operator: "equals", value: "Done" },
      }).map((row) => row.id)
    ).toEqual(["a"]);

    expect(
      filterDatabaseRows(rows, {
        properties: [{ id: "done", name: "Done", type: "checkbox" }],
        filter: { propertyId: "done", operator: "equals", value: true },
      }).map((row) => row.id)
    ).toEqual(["a", "c"]);

    expect(
      filterDatabaseRows(rows, {
        properties: [{ id: "date", name: "Date", type: "date" }],
        filter: { propertyId: "date", operator: "is_empty" },
      }).map((row) => row.id)
    ).toEqual(["b"]);

    expect(
      filterDatabaseRows(rows, {
        properties: [],
        filter: { propertyId: "__title__", operator: "contains", value: "alp" },
      }).map((row) => row.id)
    ).toEqual(["a"]);
  });

  it("sorts by title and property value", () => {
    expect(
      sortDatabaseRows(rows, {
        properties: [],
        sort: { propertyId: "__title__", direction: "desc" },
      }).map((row) => row.id)
    ).toEqual(["c", "b", "a"]);

    expect(
      sortDatabaseRows(rows, {
        properties: [{ id: "status", name: "Status", type: "select" }],
        sort: { propertyId: "status", direction: "asc" },
      }).map((row) => row.id)
    ).toEqual(["c", "a", "b"]);
  });

  it("selects a board property and groups rows into select columns", () => {
    const schema = {
      properties: [{ id: "status", name: "Status", type: "select" as const, options: ["Idea", "Doing", "Done"] }],
      view: "board" as const,
      boardPropertyId: "status",
    };

    expect(selectedBoardProperty(schema)?.id).toBe("status");
    expect(groupDatabaseBoardRows(rows, schema).map((column) => ({
      id: column.id,
      rowIds: column.rows.map((row) => row.id),
    }))).toEqual([
      { id: "Idea", rowIds: ["b"] },
      { id: "Doing", rowIds: ["c"] },
      { id: "Done", rowIds: ["a"] },
    ]);
  });
});
