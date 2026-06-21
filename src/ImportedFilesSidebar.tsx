import type { StoredFile } from "./fileStore";
import type { ExportSource } from "./types";

function formatImportedAt(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceLabel(source: ExportSource): string {
  if (source === "devin") return "Devin";
  if (source === "cursor-analytics") return "Cursor analytics";
  return "Cursor";
}

type ImportedFilesSidebarProps = {
  open: boolean;
  files: StoredFile[];
  onClose: () => void;
  onImportClick: () => void;
  onDelete: (id: string) => void;
};

export default function ImportedFilesSidebar({
  open,
  files,
  onClose,
  onImportClick,
  onDelete,
}: ImportedFilesSidebarProps) {
  return (
    <>
      <button
        type="button"
        className={open ? "sidebar-backdrop is-visible" : "sidebar-backdrop"}
        aria-label="Close imported files panel"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside
        className={open ? "import-sidebar is-open" : "import-sidebar"}
        aria-hidden={!open}
        aria-label="Imported files"
      >
        <div className="import-sidebar-header">
          <div>
            <h2 className="import-sidebar-title">Imported files</h2>
            <p className="import-sidebar-desc">
              Files are saved locally in your browser. All imported files are combined in the
              dashboard.
            </p>
          </div>
          <button type="button" className="import-sidebar-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="import-sidebar-actions">
          <button type="button" className="import-sidebar-add" onClick={onImportClick}>
            Add CSV files
          </button>
        </div>

        {files.length === 0 ? (
          <p className="import-sidebar-empty">No files imported yet.</p>
        ) : (
          <ul className="import-sidebar-list">
            {files.map((file) => (
              <li key={file.id} className="import-sidebar-item">
                <div className="import-sidebar-item-main">
                  <span className="import-sidebar-item-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="import-sidebar-item-meta">
                    <span className="import-sidebar-badge">{sourceLabel(file.source)}</span>
                    <span>
                      {file.rowCount.toLocaleString()} rows · {formatImportedAt(file.importedAt)}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  className="import-sidebar-delete"
                  aria-label={`Delete ${file.name}`}
                  title="Delete file"
                  onClick={() => onDelete(file.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}
