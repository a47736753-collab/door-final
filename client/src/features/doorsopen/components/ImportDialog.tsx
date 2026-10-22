import { useRef, useState } from "react";
import { Check, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { EventPlan } from "../types";
import { importTemplate, parseEventFile } from "../import-data";

export function ImportDialog({
  open,
  plan,
  onClose,
  onImported,
}: {
  open: boolean;
  plan: EventPlan;
  onClose: () => void;
  onImported: (plan: EventPlan) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<EventPlan | null>(null);
  const [added, setAdded] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const close = () => {
    setFile(null); setErrors([]); setPreview(null); setAdded(0); onClose();
  };
  const downloadTemplate = () => {
    const blob = new Blob([importTemplate], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "doorsopen-import-template.csv"; anchor.click();
    URL.revokeObjectURL(url);
  };
  const inspectFile = async () => {
    if (!file) return;
    setBusy(true); setErrors([]); setPreview(null);
    try {
      const result = await parseEventFile(file, plan);
      setErrors(result.errors); setPreview(result.plan ?? null); setAdded(result.added);
    } catch {
      setErrors(["We could not read this file. Use a CSV or Excel workbook with a header row in its first worksheet."]);
    } finally { setBusy(false); }
  };
  const applyImport = () => {
    if (!preview) return;
    onImported(preview);
    toast.success(`${added} event record${added === 1 ? "" : "s"} added`, { description: "Checks have been recalculated from the imported records." });
    close();
  };

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="dialog-panel import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-heading"><div className="dialog-icon"><FileSpreadsheet size={19} /></div><div><span className="eyebrow">DATA INTAKE</span><h2 id="import-title">Import event records</h2><p>Load venues, people, equipment, sessions and readiness tasks.</p></div><button className="icon-button" onClick={close} aria-label="Close import dialog"><X size={18} /></button></div>
        <button className="template-download" onClick={downloadTemplate}><Download size={16} /><span><strong>Download the CSV template</strong><small>One header row; records use venue, volunteer, equipment, session or task types.</small></span><span className="download-label">CSV</span></button>
        <input ref={input} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setErrors([]); }} className="sr-only" />
        <button className={`dropzone ${file ? "dropzone-ready" : ""}`} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const next = event.dataTransfer.files[0]; if (next) { setFile(next); setPreview(null); setErrors([]); } }}>
          {file ? <Check size={20} /> : <Upload size={20} />}<strong>{file ? file.name : "Choose a CSV or Excel file"}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KB · ready to validate` : "or drag it here · .csv, .xlsx, .xls"}</span>
        </button>
        <div className="import-format-note"><strong>Required columns depend on record type.</strong> Sessions need name, room, start, end and attendance. Import referenced rooms, volunteers and equipment in the same file or add them first. Nothing is applied until validation passes.</div>
        {errors.length > 0 && <div className="import-errors" role="alert"><strong>{errors.length} validation issue{errors.length === 1 ? "" : "s"}</strong>{errors.slice(0, 6).map((error) => <p key={error}>{error}</p>)}{errors.length > 6 && <p>+{errors.length - 6} more issues</p>}</div>}
        {preview && <div className="import-success"><Check size={16} /><span><strong>{added} records are ready to add.</strong> The event checks will rerun after you confirm.</span></div>}
        <div className="dialog-actions"><button className="button button-quiet" onClick={close}>Cancel</button>{!preview ? <button className="button button-primary" disabled={!file || busy} onClick={inspectFile}>{busy ? "Validating…" : "Validate file"}</button> : <button className="button button-primary" onClick={applyImport}>Add {added} records <Check size={15} /></button>}</div>
      </section>
    </div>
  );
}
