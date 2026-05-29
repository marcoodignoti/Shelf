import { ArrowUpDown, ChevronDown, Columns3, Copy, ExternalLink, GripVertical, ListFilter, Pencil, Plus, PlusCircle, Star, Table2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDatabaseProperty,
  DATABASE_TITLE_PROPERTY_ID,
  databaseDataRows,
  databaseTemplateRows,
  groupDatabaseBoardRows,
  DatabaseFilter,
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseSchema,
  DatabaseSort,
  defaultDatabaseSchema,
  deleteDatabaseBoardView,
  deleteDatabaseProperty,
  isBoardViewEnabled,
  parseDatabaseProperties,
  parseDatabaseSchema,
  updateDatabaseProperty,
  updateDatabaseSchemaProperty,
  updateDatabaseView,
  visibleDatabaseRows,
  selectedBoardProperty,
} from "../lib/database";
import { clampContextMenuPosition } from "../lib/contextMenu";
import { Page, updatePage } from "../lib/db";
import { normalizePageTitle } from "../lib/pageTitle";
import { appendedSiblingId, dropPositionFromOffset, reorderedSiblingIds } from "../lib/pageOrder";
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from "../lib/overlay";
import { useAppStore } from "../store/useAppStore";
import { FloatingPopover } from "./FloatingPopover";

// Optimistically apply a page field update, persist it, and roll back the
// in-memory value (plus surface an error) if the command fails — so the table
// UI never diverges silently from the database on a failed write.
async function persistPageFieldUpdate(
  deps: {
    updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
    showError: (error: unknown) => void;
  },
  id: string,
  next: Partial<Page>,
  previous: Partial<Page>,
): Promise<void> {
  deps.updatePageOptimistically(id, next);
  try {
    await updatePage(id, next);
  } catch (error) {
    deps.updatePageOptimistically(id, previous);
    deps.showError(error);
  }
}

const PROPERTY_TYPES: DatabasePropertyType[] = ["text", "checkbox", "select", "date"];
type TableDropTarget = { rowId: string; position: "before" | "after" };
type TableDragSession = {
  rowId: string;
  startX: number;
  startY: number;
  active: boolean;
};

function isDatabaseControlTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
}

export function DatabaseTableView({
  databasePage,
  rows,
  onSelectPage,
}: {
  databasePage: Page;
  rows: Page[];
  onSelectPage: (id: string) => void;
}) {
  const addPage = useAppStore((state) => state.addPage);
  const showError = useAppStore((state) => state.showError);
  const addPageFromTemplate = useAppStore((state) => state.addPageFromTemplate);
  const duplicatePageAction = useAppStore((state) => state.duplicatePageAction);
  const renamePageAction = useAppStore((state) => state.renamePageAction);
  const removePage = useAppStore((state) => state.removePage);
  const reorderPagesAction = useAppStore((state) => state.reorderPagesAction);
  const toggleFavoriteAction = useAppStore((state) => state.toggleFavoriteAction);
  const toggleTemplateAction = useAppStore((state) => state.toggleTemplateAction);
  const updatePageOptimistically = useAppStore((state) => state.updatePageOptimistically);
  const [openPropertyId, setOpenPropertyId] = useState<string | null>(null);
  const [rowContextMenu, setRowContextMenu] = useState<{ rowId: string; left: number; top: number } | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [tableDropTarget, setTableDropTarget] = useState<TableDropTarget | null>(null);
  const [renamingRowId, setRenamingRowId] = useState<string | null>(null);
  const [draftRowTitle, setDraftRowTitle] = useState("");
  const propertyButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRenameInputRef = useRef<HTMLInputElement>(null);
  const tableDragSessionRef = useRef<TableDragSession | null>(null);
  const tableDropTargetRef = useRef<TableDropTarget | null>(null);
  const dataRowsRef = useRef<Page[]>([]);
  const templateMenuButtonRef = useRef<HTMLButtonElement>(null);
  const schema = parseDatabaseSchema(databasePage.database_schema ?? JSON.stringify(defaultDatabaseSchema()));
  const viewProperties = useMemo(
    () => [{ id: DATABASE_TITLE_PROPERTY_ID, name: "Name", type: "text" as const }, ...schema.properties],
    [schema.properties]
  );
  const rowTemplates = useMemo(() => databaseTemplateRows(rows), [rows]);
  const dataRows = useMemo(() => databaseDataRows(rows), [rows]);
  const visibleRows = useMemo(() => visibleDatabaseRows(dataRows, schema), [dataRows, schema]);
  const boardProperty = selectedBoardProperty(schema);
  const boardColumns = useMemo(() => groupDatabaseBoardRows(visibleRows, schema), [visibleRows, schema]);
  const boardViewEnabled = isBoardViewEnabled(schema);
  const tableGridTemplateColumns = `minmax(220px, 1.4fr) repeat(${schema.properties.length}, minmax(140px, 1fr)) 96px`;
  const contextMenuRow = rowContextMenu ? rows.find((row) => row.id === rowContextMenu.rowId) ?? null : null;

  useEffect(() => {
    dataRowsRef.current = dataRows;
  }, [dataRows]);

  useEffect(() => {
    if (!rowContextMenu) return;

    const closeMenu = () => setRowContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [rowContextMenu]);

  useEffect(() => {
    if (!renamingRowId) return;

    rowRenameInputRef.current?.focus();
    rowRenameInputRef.current?.select();
  }, [renamingRowId]);

  const persistSchema = async (nextSchema: DatabaseSchema) => {
    const database_schema = JSON.stringify(nextSchema);
    await persistPageFieldUpdate(
      { updatePageOptimistically, showError },
      databasePage.id,
      { database_schema },
      { database_schema: databasePage.database_schema },
    );
  };

  const handleAddRow = async () => {
    const row = await addPage("Untitled", databasePage.id, { select: false });
    if (row) {
      await reorderPagesAction(databasePage.id, appendedSiblingId(dataRows.map((dataRow) => dataRow.id), row.id));
    }
  };

  const handleAddRowFromTemplate = async (templateId: string) => {
    setTemplateMenuOpen(false);
    const row = await addPageFromTemplate(templateId, databasePage.id, { select: false });
    if (row) {
      await reorderPagesAction(databasePage.id, appendedSiblingId(dataRows.map((dataRow) => dataRow.id), row.id));
    }
  };

  const handlePropertyChange = async (row: Page, propertyId: string, value: string | boolean) => {
    const properties = updateDatabaseProperty(row.properties, propertyId, value);
    await persistPageFieldUpdate(
      { updatePageOptimistically, showError },
      row.id,
      { properties },
      { properties: row.properties },
    );
  };

  const handleAddProperty = async () => {
    const nextSchema = addDatabaseProperty(schema, "Property", crypto.randomUUID());
    await persistSchema(nextSchema);
  };

  const handleUpdateProperty = async (propertyId: string, updates: Partial<DatabaseProperty>) => {
    await persistSchema(updateDatabaseSchemaProperty(schema, propertyId, updates));
  };

  const handleDeleteProperty = async (propertyId: string) => {
    setOpenPropertyId(null);
    await persistSchema(deleteDatabaseProperty(schema, propertyId));
  };

  const handleSortChange = async (sort: DatabaseSort | null) => {
    await persistSchema(updateDatabaseView(schema, { sort }));
  };

  const handleFilterChange = async (filter: DatabaseFilter | null) => {
    await persistSchema(updateDatabaseView(schema, { filter }));
  };

  const handleViewChange = async (view: "table" | "board") => {
    await persistSchema(
      updateDatabaseView(schema, {
        view,
        boardPropertyId: view === "board" ? boardProperty?.id ?? null : null,
      })
    );
  };

  const handleBoardPropertyChange = async (propertyId: string) => {
    await persistSchema(updateDatabaseView(schema, { view: "board", boardPropertyId: propertyId }));
  };

  const handleDeleteBoardView = async () => {
    await persistSchema(deleteDatabaseBoardView(schema));
  };

  const handleAddBoardRow = async (option: string) => {
    const row = await addPage("Untitled", databasePage.id, { select: false });
    if (row && boardProperty) {
      const properties = updateDatabaseProperty(row.properties, boardProperty.id, option);
      await persistPageFieldUpdate(
        { updatePageOptimistically, showError },
        row.id,
        { properties },
        { properties: row.properties },
      );
      await reorderPagesAction(databasePage.id, appendedSiblingId(dataRows.map((dataRow) => dataRow.id), row.id));
    }
  };

  const handleDropBoardRow = async (rowId: string, option: string) => {
    const row = rows.find((candidate) => candidate.id === rowId);
    if (!row || !boardProperty) return;

    await handlePropertyChange(row, boardProperty.id, option);
    setDraggedRowId(null);
  };

  const clearTableDragState = () => {
    setDraggedRowId(null);
    tableDropTargetRef.current = null;
    setTableDropTarget(null);
  };

  const handleRowDragEnd = () => {
    setDraggedRowId(null);
    setTableDropTarget(null);
  };

  const updateTableDropTarget = (clientX: number, clientY: number) => {
    const session = tableDragSessionRef.current;
    if (!session) return;

    const rowElement = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-database-row-id]");
    const targetId = rowElement?.dataset.databaseRowId;
    if (!rowElement || !targetId || targetId === session.rowId) {
      tableDropTargetRef.current = null;
      setTableDropTarget(null);
      return;
    }

    const rect = rowElement.getBoundingClientRect();
    const dropPosition = dropPositionFromOffset(clientY - rect.top, rect.height);
    const nextDropTarget: TableDropTarget = {
      rowId: targetId,
      position: dropPosition === "before" ? "before" : "after",
    };
    tableDropTargetRef.current = nextDropTarget;
    setTableDropTarget(nextDropTarget);
  };

  const reorderTableRowsFromDropTarget = async (sourceId: string, target: TableDropTarget) => {
    const siblingIds = dataRowsRef.current.map((row) => row.id);
    const orderedIds = reorderedSiblingIds(siblingIds, sourceId, target.rowId, target.position);
    if (orderedIds.join("\0") === siblingIds.join("\0")) return;

    await reorderPagesAction(databasePage.id, orderedIds);
  };

  const handleTableDragHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>, row: Page) => {
    if (event.button !== 0 || event.pointerType === "touch") return;

    event.preventDefault();
    event.stopPropagation();

    tableDragSessionRef.current = {
      rowId: row.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const session = tableDragSessionRef.current;
      if (!session) return;

      const distance = Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY);
      if (!session.active && distance < 4) return;

      if (!session.active) {
        tableDragSessionRef.current = { ...session, active: true };
        setDraggedRowId(session.rowId);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }

      moveEvent.preventDefault();
      updateTableDropTarget(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = () => {
      const session = tableDragSessionRef.current;
      const target = tableDropTargetRef.current;
      tableDragSessionRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      clearTableDragState();

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      if (session?.active && target) {
        void reorderTableRowsFromDropTarget(session.rowId, target);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const setPropertyButtonRef = (propertyId: string, element: HTMLButtonElement | null) => {
    if (element) {
      propertyButtonRefs.current.set(propertyId, element);
    } else {
      propertyButtonRefs.current.delete(propertyId);
    }
  };

  const openRowContextMenu = (event: React.MouseEvent, row: Page) => {
    if (isDatabaseControlTarget(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    closeOpenOverlays();
    setOpenPropertyId(null);
    setTemplateMenuOpen(false);
    setRowContextMenu({
      rowId: row.id,
      ...clampContextMenuPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight, 176, 300),
    });
  };

  const startRowRename = (row: Page) => {
    setRowContextMenu(null);
    setDraftRowTitle(row.title || "Untitled");
    setRenamingRowId(row.id);
  };

  const commitRowRename = async (row: Page) => {
    const nextTitle = normalizePageTitle(draftRowTitle);
    setRenamingRowId(null);
    setDraftRowTitle(nextTitle);

    if (nextTitle !== row.title) {
      await renamePageAction(row.id, nextTitle);
    }
  };

  const cancelRowRename = (row: Page) => {
    setDraftRowTitle(row.title || "Untitled");
    setRenamingRowId(null);
  };

  const handleDuplicateRow = async (row: Page) => {
    setRowContextMenu(null);
    const duplicated = await duplicatePageAction(row.id, { select: false });
    if (duplicated) {
      await reorderPagesAction(databasePage.id, appendedSiblingId(dataRows.map((dataRow) => dataRow.id), duplicated.id));
    }
  };

  const handleDeleteRow = async (row: Page) => {
    setRowContextMenu(null);
    await removePage(row.id);
  };

  const handleToggleRowFavorite = async (row: Page) => {
    setRowContextMenu(null);
    await toggleFavoriteAction(row.id, row.is_favorite !== 1);
  };

  const handleToggleRowTemplate = async (row: Page) => {
    setRowContextMenu(null);
    await toggleTemplateAction(row.id, row.is_template !== 1);
  };

  const handleAddRowSubpage = async (row: Page) => {
    setRowContextMenu(null);
    await addPage("Untitled", row.id);
  };

  return (
    <div className="mb-10 overflow-visible bg-background">
      <DatabaseViewToolbar
        properties={viewProperties}
        schema={schema}
        boardProperty={boardProperty}
        onAddRow={handleAddRow}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
        onViewChange={handleViewChange}
        onBoardPropertyChange={handleBoardPropertyChange}
        onDeleteBoardView={handleDeleteBoardView}
      />
      {schema.view === "board" && boardViewEnabled ? (
        boardProperty ? (
          <div className="flex min-h-64 gap-3 overflow-x-auto py-2">
            {boardColumns.map((column) => (
              <div
                key={column.id}
                className="flex w-64 flex-shrink-0 flex-col rounded-md bg-muted/35"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedRowId) void handleDropBoardRow(draggedRowId, column.id);
                }}
              >
                <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span className="truncate">{column.name}</span>
                  <span>{column.rows.length}</span>
                </div>
                <div className="flex-1 space-y-2 p-2">
                  {column.rows.map((row) => (
                    <div
                      key={row.id}
                      draggable
                      role="button"
                      tabIndex={0}
                      className={`on-liquid-card w-full rounded-md px-3 py-2 text-left text-sm ${
                        draggedRowId === row.id ? "opacity-45" : ""
                      }`}
                      onClick={() => {
                        if (renamingRowId !== row.id) onSelectPage(row.id);
                      }}
                      onContextMenu={(event) => openRowContextMenu(event, row)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", row.id);
                        setDraggedRowId(row.id);
                      }}
                      onDragEnd={handleRowDragEnd}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectPage(row.id);
                        }
                      }}
                    >
                      {renamingRowId === row.id ? (
                        <input
                          ref={rowRenameInputRef}
                          className="w-full rounded-sm bg-transparent px-1 py-0.5 font-medium outline-none focus:bg-muted"
                          value={draftRowTitle}
                          onChange={(event) => setDraftRowTitle(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => void commitRowRename(row)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitRowRename(row);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRowRename(row);
                            }
                          }}
                        />
                      ) : (
                        <div className="truncate font-medium">{row.title || "Untitled"}</div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-b-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => void handleAddBoardRow(column.id)}
                >
                  <PlusCircle className="h-4 w-4" />
                  New
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            Add a select property to use Board view.
          </div>
        )
      ) : (
        <>
          <div
            className="grid min-w-[680px] border-b border-border/80 text-sm font-medium text-muted-foreground"
            style={{ gridTemplateColumns: tableGridTemplateColumns }}
          >
            <div className="flex items-center gap-2 border-r border-border/70 px-3 py-2">
              <span className="text-base leading-none text-muted-foreground/70">Aa</span>
              <span>Name</span>
            </div>
            {schema.properties.map((property) => (
              <div key={property.id} className="border-r border-border/70 px-2 py-1.5 last:border-r-0">
                <button
                  ref={(element) => setPropertyButtonRef(property.id, element)}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-muted hover:text-foreground"
                  onClick={() => setOpenPropertyId((current) => (current === property.id ? null : property.id))}
                >
                  <span className="truncate">{property.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                </button>
                <FloatingPopover
                  anchorElement={propertyButtonRefs.current.get(property.id) ?? null}
                  open={openPropertyId === property.id}
                  width={240}
                  placement="bottom-end"
                  onOpenChange={(open) => {
                    if (!open) setOpenPropertyId(null);
                  }}
                  className="on-popover p-2"
                >
                  <PropertyEditor
                    property={property}
                    onUpdate={(updates) => void handleUpdateProperty(property.id, updates)}
                    onDelete={() => void handleDeleteProperty(property.id)}
                  />
                </FloatingPopover>
              </div>
            ))}
            <div className="flex items-center gap-1 border-r border-border/70 px-2 py-1.5 text-muted-foreground">
              <button
                type="button"
                className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
                title="Add property"
                aria-label="Add property"
                onClick={() => void handleAddProperty()}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md px-1.5 py-1 text-lg leading-none hover:bg-muted hover:text-foreground"
                title="More property options"
                aria-label="More property options"
              >
                ...
              </button>
            </div>
          </div>
          <div className="min-w-[680px]">
            {visibleRows.map((row) => {
              const properties = parseDatabaseProperties(row.properties);
              const isDropBefore = tableDropTarget?.rowId === row.id && tableDropTarget.position === "before";
              const isDropAfter = tableDropTarget?.rowId === row.id && tableDropTarget.position === "after";

              return (
                <div
                  key={row.id}
                  className={`group/row grid min-h-11 border-b border-border/70 ${
                    draggedRowId === row.id ? "opacity-45" : ""
                  } ${isDropBefore ? "border-t-2 border-t-primary" : ""} ${isDropAfter ? "border-b-2 border-b-primary" : ""}`}
                  style={{ gridTemplateColumns: tableGridTemplateColumns }}
                  data-database-row-id={row.id}
                  onContextMenu={(event) => openRowContextMenu(event, row)}
                >
                  <div className="border-r border-border/70 px-2 py-1.5">
                    {renamingRowId === row.id ? (
                      <input
                        ref={rowRenameInputRef}
                        className="w-full rounded-sm bg-transparent px-1 py-1 text-sm outline-none focus:bg-muted"
                        value={draftRowTitle}
                        onChange={(event) => setDraftRowTitle(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => void commitRowRename(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitRowRename(row);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRowRename(row);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="w-full truncate rounded-sm px-1 py-1 text-left text-sm hover:bg-muted hover:text-foreground"
                        onClick={() => onSelectPage(row.id)}
                      >
                        {row.title || "Untitled"}
                      </button>
                    )}
                  </div>
                  {schema.properties.map((property) => (
                    <div key={property.id} className="border-r border-border/70 px-2 py-1.5 last:border-r-0">
                      {property.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          className="mt-2 h-4 w-4"
                          checked={properties[property.id] === true}
                          onChange={(event) => void handlePropertyChange(row, property.id, event.target.checked)}
                        />
                      ) : property.type === "select" ? (
                        <select
                          className="w-full rounded-sm bg-transparent px-1 py-1 text-sm outline-none hover:bg-muted focus:bg-muted"
                          value={String(properties[property.id] ?? "")}
                          onChange={(event) => void handlePropertyChange(row, property.id, event.target.value)}
                        >
                          <option value="">Empty</option>
                          {(property.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={property.type === "date" ? "date" : "text"}
                          className="w-full rounded-sm bg-transparent px-1 py-1 text-sm outline-none hover:bg-muted focus:bg-muted"
                          value={String(properties[property.id] ?? "")}
                          onChange={(event) => void handlePropertyChange(row, property.id, event.target.value)}
                        />
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-center border-r border-border/70">
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover/row:opacity-100 focus:opacity-100 active:cursor-grabbing"
                      title="Drag row"
                      aria-label={`Drag ${row.title || "Untitled"}`}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => handleTableDragHandlePointerDown(event, row)}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              );
            })}
            {visibleRows.length === 0 && (
              <div className="border-b border-border/70 px-3 py-8 text-center text-sm text-muted-foreground">
                No rows match current filter.
              </div>
            )}
            <button
              type="button"
              className="grid min-h-11 w-full text-left text-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground hover:opacity-100 focus:opacity-100"
              style={{ gridTemplateColumns: tableGridTemplateColumns }}
              onClick={() => void handleAddRow()}
            >
              <span className="flex items-center gap-2 border-r border-border/70 px-3 py-2">
                <Plus className="h-4 w-4" />
                New page
              </span>
              {schema.properties.map((property) => (
                <span key={`new-row-empty-${property.id}`} className="border-r border-border/70 last:border-r-0" />
              ))}
              <span className="border-r border-border/70" />
            </button>
          </div>
        </>
      )}
      {rowTemplates.length > 0 && (
        <div className="relative border-t border-border/70">
          <button
            type="button"
            ref={templateMenuButtonRef}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setTemplateMenuOpen((open) => !open)}
          >
            <Copy className="h-4 w-4" />
            New row from template
            <ChevronDown className="ml-auto h-4 w-4" />
          </button>
          <FloatingPopover
            anchorElement={templateMenuButtonRef.current}
            open={templateMenuOpen}
            width={224}
            onOpenChange={setTemplateMenuOpen}
            className="on-popover"
          >
            {rowTemplates.map((template) => (
              <button
                type="button"
                key={template.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => void handleAddRowFromTemplate(template.id)}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{template.title || "Untitled"}</span>
              </button>
            ))}
          </FloatingPopover>
        </div>
      )}
      {rowContextMenu && contextMenuRow && (
        <div
          className="fixed z-[160] w-44 overflow-y-auto on-popover"
          style={{
            left: rowContextMenu.left,
            top: rowContextMenu.top,
            maxHeight: Math.max(120, window.innerHeight - rowContextMenu.top - 12),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => startRowRename(contextMenuRow)}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => {
              setRowContextMenu(null);
              onSelectPage(contextMenuRow.id);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            Open
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => void handleToggleRowFavorite(contextMenuRow)}
          >
            <Star className={`h-3.5 w-3.5 text-muted-foreground ${contextMenuRow.is_favorite === 1 ? "fill-current" : ""}`} />
            {contextMenuRow.is_favorite === 1 ? "Remove from Favorites" : "Add to Favorites"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => void handleDuplicateRow(contextMenuRow)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            Duplicate
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => void handleToggleRowTemplate(contextMenuRow)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {contextMenuRow.is_template === 1 ? "Remove from Templates" : "Use as Template"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => void handleAddRowSubpage(contextMenuRow)}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            New subpage
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            onClick={() => void handleDeleteRow(contextMenuRow)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function DatabaseRowPropertiesPanel({
  databasePage,
  rowPage,
}: {
  databasePage: Page;
  rowPage: Page;
}) {
  const updatePageOptimistically = useAppStore((state) => state.updatePageOptimistically);
  const showError = useAppStore((state) => state.showError);
  const toggleTemplateAction = useAppStore((state) => state.toggleTemplateAction);
  const schema = parseDatabaseSchema(databasePage.database_schema ?? JSON.stringify(defaultDatabaseSchema()));
  const properties = parseDatabaseProperties(rowPage.properties);

  const handlePropertyChange = async (propertyId: string, value: string | boolean) => {
    const nextProperties = updateDatabaseProperty(rowPage.properties, propertyId, value);
    await persistPageFieldUpdate(
      { updatePageOptimistically, showError },
      rowPage.id,
      { properties: nextProperties },
      { properties: rowPage.properties },
    );
  };

  const handleToggleTemplate = async () => {
    await toggleTemplateAction(rowPage.id, rowPage.is_template !== 1);
  };

  return (
    <div className="mb-8 rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{databasePage.title || "Database"} properties</span>
        <button type="button" className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => void handleToggleTemplate()}>
          {rowPage.is_template === 1 ? "Remove row template" : "Use as row template"}
        </button>
      </div>
      <div className="divide-y divide-border">
        {schema.properties.map((property) => (
          <div key={property.id} className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-sm">
            <div className="truncate text-muted-foreground">{property.name}</div>
            <DatabasePropertyValueControl
              property={property}
              value={properties[property.id]}
              onChange={(value) => void handlePropertyChange(property.id, value)}
            />
          </div>
        ))}
        {schema.properties.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground">No properties yet.</div>
        )}
      </div>
    </div>
  );
}

function DatabasePropertyValueControl({
  property,
  value,
  onChange,
}: {
  property: DatabaseProperty;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  if (property.type === "checkbox") {
    return (
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (property.type === "select") {
    return (
      <select
        className="w-full rounded-sm bg-transparent px-1 py-1 text-sm outline-none hover:bg-muted focus:bg-muted"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Empty</option>
        {(property.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={property.type === "date" ? "date" : "text"}
      className="w-full rounded-sm bg-transparent px-1 py-1 text-sm outline-none hover:bg-muted focus:bg-muted"
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function defaultFilterForProperty(property: DatabaseProperty): DatabaseFilter {
  if (property.type === "checkbox") {
    return { propertyId: property.id, operator: "equals", value: true };
  }

  if (property.type === "date") {
    return { propertyId: property.id, operator: "equals", value: "" };
  }

  if (property.type === "select") {
    return { propertyId: property.id, operator: "equals", value: property.options?.[0] ?? "" };
  }

  return { propertyId: property.id, operator: "contains", value: "" };
}

function DatabaseViewToolbar({
  properties,
  schema,
  boardProperty,
  onAddRow,
  onSortChange,
  onFilterChange,
  onViewChange,
  onBoardPropertyChange,
  onDeleteBoardView,
}: {
  properties: DatabaseProperty[];
  schema: DatabaseSchema;
  boardProperty: DatabaseProperty | null;
  onAddRow: () => void;
  onSortChange: (sort: DatabaseSort | null) => void;
  onFilterChange: (filter: DatabaseFilter | null) => void;
  onViewChange: (view: "table" | "board") => void;
  onBoardPropertyChange: (propertyId: string) => void;
  onDeleteBoardView: () => void;
}) {
  const sortProperty = properties.find((property) => property.id === schema.sort?.propertyId);
  const filterProperty = properties.find((property) => property.id === schema.filter?.propertyId);
  const selectProperties = properties.filter((property) => property.type === "select");
  const boardViewEnabled = isBoardViewEnabled(schema);

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`flex items-center gap-2 rounded-full px-3 py-2 font-medium transition-colors ${
            schema.view !== "board" ? "bg-muted text-foreground" : "hover:bg-muted hover:text-foreground"
          }`}
          onClick={() => onViewChange("table")}
        >
          <Table2 className="h-4 w-4" />
          Table
        </button>
        {boardViewEnabled ? (
          <div
            className={`group/view flex items-center rounded-full font-medium transition-colors ${
              schema.view === "board" ? "bg-muted text-foreground" : "hover:bg-muted hover:text-foreground"
            }`}
          >
            <button
              type="button"
              className="flex items-center gap-2 rounded-l-full py-2 pl-3 pr-2"
              onClick={() => onViewChange("board")}
            >
              <Columns3 className="h-4 w-4" />
              Board
            </button>
            <button
              type="button"
              className="mr-1 rounded-full p-1 opacity-0 hover:bg-background/80 group-hover/view:opacity-100 focus:opacity-100"
              aria-label="Delete board view"
              title="Delete board view"
              onClick={onDeleteBoardView}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex items-center gap-2 rounded-full px-3 py-2 font-medium hover:bg-muted hover:text-foreground"
            onClick={() => onViewChange("board")}
          >
            <Plus className="h-4 w-4" />
            Board
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
      {schema.view === "board" && selectProperties.length > 0 && (
        <select
          className="rounded-md bg-transparent px-2 py-1 outline-none hover:bg-muted hover:text-foreground"
          value={boardProperty?.id ?? ""}
          onChange={(event) => onBoardPropertyChange(event.target.value)}
        >
          {selectProperties.map((property) => (
            <option key={property.id} value={property.id}>
              Board by {property.name}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
        <ArrowUpDown className="h-4 w-4" />
        <select
          className="max-w-24 bg-transparent text-sm outline-none"
          value={sortProperty?.id ?? ""}
          aria-label="Sort property"
          onChange={(event) => {
            const property = properties.find((candidate) => candidate.id === event.target.value);
            onSortChange(property ? { propertyId: property.id, direction: schema.sort?.direction ?? "asc" } : null);
          }}
        >
          <option value="">Sort</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      {schema.sort && (
        <>
          <select
            className="rounded-md bg-transparent px-2 py-1 outline-none hover:bg-muted hover:text-foreground"
            value={schema.sort.direction}
            onChange={(event) =>
              onSortChange({
                ...schema.sort!,
                direction: event.target.value as DatabaseSort["direction"],
              })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button type="button" className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => onSortChange(null)}>
            Clear
          </button>
        </>
      )}

      <label className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
        <ListFilter className="h-4 w-4" />
        <select
          className="max-w-24 bg-transparent text-sm outline-none"
          value={filterProperty?.id ?? ""}
          aria-label="Filter property"
          onChange={(event) => {
            const property = properties.find((candidate) => candidate.id === event.target.value);
            onFilterChange(property ? defaultFilterForProperty(property) : null);
          }}
        >
          <option value="">Filter</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      {schema.filter && filterProperty && (
        <>
          <FilterValueControl property={filterProperty} filter={schema.filter} onChange={onFilterChange} />
          <button type="button" className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => onFilterChange(null)}>
            Clear
          </button>
        </>
      )}
        <button
          type="button"
          className="ml-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white shadow-sm hover:bg-blue-500"
          onClick={() => onAddRow()}
        >
          New
          <ChevronDown className="h-4 w-4 border-l border-white/25 pl-1" />
        </button>
      </div>
    </div>
  );
}

function FilterValueControl({
  property,
  filter,
  onChange,
}: {
  property: DatabaseProperty;
  filter: DatabaseFilter;
  onChange: (filter: DatabaseFilter) => void;
}) {
  if (property.type === "checkbox") {
    return (
      <select
        className="rounded-md border border-border bg-background px-2 py-1 outline-none"
        value={filter.value === false ? "false" : "true"}
        onChange={(event) => onChange({ propertyId: property.id, operator: "equals", value: event.target.value === "true" })}
      >
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    );
  }

  if (property.type === "select") {
    return (
      <select
        className="rounded-md border border-border bg-background px-2 py-1 outline-none"
        value={String(filter.value ?? "")}
        onChange={(event) => onChange({ propertyId: property.id, operator: "equals", value: event.target.value })}
      >
        {(property.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === "date") {
    return (
      <>
        <select
          className="rounded-md border border-border bg-background px-2 py-1 outline-none"
          value={filter.operator}
          onChange={(event) =>
            onChange({
              propertyId: property.id,
              operator: event.target.value as DatabaseFilter["operator"],
              value: event.target.value === "is_empty" ? undefined : String(filter.value ?? ""),
            })
          }
        >
          <option value="equals">Exact</option>
          <option value="is_empty">Empty</option>
        </select>
        {filter.operator !== "is_empty" && (
          <input
            type="date"
            className="rounded-md border border-border bg-background px-2 py-1 outline-none"
            value={String(filter.value ?? "")}
            onChange={(event) => onChange({ propertyId: property.id, operator: "equals", value: event.target.value })}
          />
        )}
      </>
    );
  }

  return (
    <input
      className="rounded-md border border-border bg-background px-2 py-1 outline-none"
      placeholder="Contains..."
      value={String(filter.value ?? "")}
      onChange={(event) => onChange({ propertyId: property.id, operator: "contains", value: event.target.value })}
    />
  );
}

function PropertyEditor({
  property,
  onUpdate,
  onDelete,
}: {
  property: DatabaseProperty;
  onUpdate: (updates: Partial<DatabaseProperty>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">
        Name
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
          value={property.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Type
        <select
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
          value={property.type}
          onChange={(event) => onUpdate({ type: event.target.value as DatabasePropertyType })}
        >
          {PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {property.type === "select" && (
        <label className="block text-xs text-muted-foreground">
          Options
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
            value={(property.options ?? []).join(", ")}
            onChange={(event) =>
              onUpdate({
                options: event.target.value
                  .split(",")
                  .map((option) => option.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      )}
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete property
      </button>
    </div>
  );
}
