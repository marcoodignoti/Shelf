import { FileText, Upload } from "lucide-react";
import { StudioDocument } from "../lib/studio";
import { allStudioDocuments, recentStudioDocuments } from "../lib/studioDocuments";

type StudioSidebarProps = {
  documents: StudioDocument[];
  currentDocumentId: string | null;
  isLoading: boolean;
  onImport: () => void;
  onSelectDocument: (id: string) => void;
};

function StudioDocumentRow({
  document,
  active,
  onSelect,
}: {
  document: StudioDocument;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`on-shell-row on-sidebar-page-row mb-[1px] justify-between py-[3px] text-[13px] ${active ? "on-shell-row-active" : ""}`}
      onClick={onSelect}
      title={document.original_filename}
    >
      <div className="flex min-w-0 items-center">
        <FileText className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{document.title}</span>
      </div>
    </button>
  );
}

export function StudioSidebar({
  documents,
  currentDocumentId,
  isLoading,
  onImport,
  onSelectDocument,
}: StudioSidebarProps) {
  const recent = recentStudioDocuments(documents);
  const all = allStudioDocuments(documents);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2">
        <button type="button" className="on-studio-import-button" onClick={onImport}>
          <Upload className="h-4 w-4" />
          <span>Import PDF</span>
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-20">
        {isLoading && <div className="px-3 py-4 text-xs text-muted-foreground">Loading Studio...</div>}
        {!isLoading && documents.length === 0 && (
          <div className="mx-1 rounded-xl border border-dashed border-border/70 bg-background/35 p-3 text-xs text-muted-foreground">
            Import a PDF to start Studio notes.
          </div>
        )}
        {recent.length > 0 && (
          <section className="mb-4">
            <div className="on-section-label mb-1">Recenti</div>
            {recent.map((document) => (
              <StudioDocumentRow
                key={`recent-${document.id}`}
                document={document}
                active={document.id === currentDocumentId}
                onSelect={() => onSelectDocument(document.id)}
              />
            ))}
          </section>
        )}
        {all.length > 0 && (
          <section>
            <div className="on-section-label mb-1">Tutti i documenti</div>
            {all.map((document) => (
              <StudioDocumentRow
                key={`all-${document.id}`}
                document={document}
                active={document.id === currentDocumentId}
                onSelect={() => onSelectDocument(document.id)}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
