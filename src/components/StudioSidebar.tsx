import { FileText, Loader2, Upload } from "lucide-react";
import { StudioDocument } from "../lib/studio";
import { recentStudioDocuments, remainingStudioDocuments, studioDocumentMetadata } from "../lib/studioDocuments";

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
      <div className="flex min-w-0 items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 text-left">
          <span className="block truncate">{document.title}</span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">
            {studioDocumentMetadata(document)}
          </span>
        </span>
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
  const recent = recentStudioDocuments(documents, 4);
  const remaining = remainingStudioDocuments(documents, recent);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2">
        <button type="button" className="on-studio-import-button" onClick={onImport}>
          <Upload className="h-4 w-4" />
          <span>Import PDF</span>
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-20">
        {isLoading && (
          <div className="mx-1 flex items-center gap-2 rounded-xl border border-border/60 bg-background/35 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading Studio documents...
          </div>
        )}
        {!isLoading && documents.length === 0 && (
          <div className="mx-1 rounded-xl border border-dashed border-border/70 bg-background/35 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground/80">No Studio documents</div>
            <div className="mt-1">Import a PDF to create a linked note.</div>
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
        {remaining.length > 0 && (
          <section>
            <div className="on-section-label mb-1">Tutti i documenti</div>
            {remaining.map((document) => (
              <StudioDocumentRow
                key={`all-${document.id}`}
                document={document}
                active={document.id === currentDocumentId}
                onSelect={() => onSelectDocument(document.id)}
              />
            ))}
          </section>
        )}
        {!isLoading && documents.length > 0 && remaining.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Tutti i documenti sono gia in Recenti.
          </div>
        )}
      </div>
    </div>
  );
}
