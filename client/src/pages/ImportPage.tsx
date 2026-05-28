import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContextNew';

type ImportType = 'directorio' | 'convocatorias';

interface ImportReport {
  inserted: number;
  skipped: number;
  errors: number;
  preview: Array<{ nombre?: string; tipo?: string; titulo?: string; url?: string }>;
}

export default function ImportPage() {
  const { token, isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef      = useRef<HTMLDivElement>(null);

  const [importType, setImportType]   = useState<ImportType>('directorio');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging]       = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [report, setReport]           = useState<ImportReport | null>(null);
  const [error, setError]             = useState('');

  if (!isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-surface-container-low">
        <div className="text-center">
          <span className="material-symbols-outlined text-[48px] text-outline-variant block mb-md">lock</span>
          <p className="text-body-lg font-bold text-on-surface">ACCESO RESTRINGIDO</p>
          <p className="text-body-sm text-on-surface-variant mt-xs">Esta sección requiere nivel de autorización ADMIN.</p>
        </div>
      </div>
    );
  }

  function handleFileSelect(file: File) {
    const validExts = ['csv', 'xlsx', 'xls'];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!validExts.includes(ext)) {
      setError('FORMATO NO VÁLIDO · Solo se aceptan archivos CSV, XLSX o XLS.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('ARCHIVO EXCEDE EL LÍMITE · Máximo 10 MB por importación.');
      return;
    }
    setError('');
    setReport(null);
    setSelectedFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  async function handleUpload() {
    if (!selectedFile || !token) return;
    setUploading(true);
    setError('');
    setReport(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('tipo', importType);

    try {
      const res = await fetch('/api/directory/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error en la importación.');
      setReport(data.report);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setError(e.message || 'No se pudo completar la importación.');
    } finally {
      setUploading(false);
    }
  }

  const fileExt = selectedFile?.name.split('.').pop()?.toUpperCase() ?? '';

  return (
    <div className="flex flex-1 max-w-container-max mx-auto w-full">
      <main className="flex-1 p-lg md:p-xl bg-surface-container-low min-h-full">

        {/* Header */}
        <div className="mb-lg">
          <h1 className="text-headline-md font-headline-md text-on-surface">Importación Segura de Datos</h1>
          <p className="text-label-md font-label-md text-on-surface-variant mt-xs uppercase tracking-wider">
            Carga datos oficiales desde portales de transparencia · Protocolo Zero Trust activo
          </p>
        </div>

        {/* Security notice */}
        <div className="mb-lg flex items-start gap-sm px-md py-3 rounded border border-[#e2e8f0] bg-surface-container-lowest text-[12px] font-mono text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px] text-secondary mt-[1px] shrink-0">verified_user</span>
          <span>
            PROTOCOLO DE IMPORTACIÓN SEGURA · Todos los datos serán sanitizados con política Zero Trust antes de
            ser escritos en la base de datos. Los registros no verificados quedarán etiquetados como
            &nbsp;<strong className="text-amber-700">VALIDACIÓN PENDIENTE</strong>&nbsp;hasta su revisión manual.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-lg md:grid-cols-2">

          {/* Left: Config + Upload */}
          <div className="flex flex-col gap-lg">

            {/* Type selector */}
            <div className="border border-outline-variant rounded bg-surface-container-lowest p-md">
              <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-sm">
                Tipo de Datos
              </p>
              <div className="flex gap-sm">
                {(['directorio', 'convocatorias'] as ImportType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => { setImportType(t); setReport(null); setError(''); }}
                    className={`flex-1 h-10 rounded border text-label-sm font-label-sm uppercase tracking-wider transition-colors ${
                      importType === t
                        ? 'bg-secondary text-on-secondary border-secondary'
                        : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:border-secondary hover:text-secondary'
                    }`}
                  >
                    {t === 'directorio' ? 'Directorio' : 'Convocatorias'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-on-surface-variant mt-sm font-mono">
                {importType === 'directorio'
                  ? 'Columnas esperadas: nombre, sigla, tipo, pais, sitio_web, url_convocatorias, telefono, email, alcance'
                  : 'Columnas esperadas: titulo, sector, tipo_financiamiento, monto, url, fecha_cierre, entidad'}
              </p>
            </div>

            {/* Drop zone */}
            <div
              ref={dropRef}
              onDragEnter={() => setDragging(true)}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded p-xl flex flex-col items-center justify-center gap-sm cursor-pointer transition-colors min-h-[200px] ${
                dragging
                  ? 'border-secondary bg-[rgba(0,88,190,0.05)]'
                  : selectedFile
                  ? 'border-emerald-400 bg-[rgba(5,150,105,0.03)]'
                  : 'border-outline-variant bg-surface-container-lowest hover:border-secondary hover:bg-surface-container'
              }`}
            >
              <span className={`material-symbols-outlined text-[40px] ${
                selectedFile ? 'text-emerald-500' : 'text-outline-variant'
              }`}>
                {selectedFile ? 'task' : 'upload_file'}
              </span>
              {selectedFile ? (
                <>
                  <p className="text-body-sm font-bold text-on-surface text-center">{selectedFile.name}</p>
                  <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
                    {fileExt} · {(selectedFile.size / 1024).toFixed(1)} KB
                  </span>
                  <p className="text-[11px] text-on-surface-variant font-mono">
                    Clic para cambiar archivo
                  </p>
                </>
              ) : (
                <>
                  <p className="text-body-sm font-bold text-on-surface text-center">
                    Arrastre el archivo aquí
                  </p>
                  <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">
                    o clic para seleccionar
                  </p>
                  <p className="text-[11px] text-on-surface-variant font-mono mt-xs">
                    CSV · XLSX · XLS · Máx. 10 MB
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={onInputChange}
                className="hidden"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="px-md py-3 rounded bg-[#fff4f4] border border-error text-error text-[12px] font-mono flex items-center gap-sm">
                <span className="material-symbols-outlined text-[16px] shrink-0">warning</span>
                {error}
              </div>
            )}

            {/* Upload button */}
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="h-11 flex items-center justify-center gap-sm bg-secondary text-on-secondary rounded text-label-sm font-label-sm uppercase tracking-wider transition-colors hover:bg-secondary-container disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading
                ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>PROCESANDO…</>
                : <><span className="material-symbols-outlined text-[18px]">upload</span>EJECUTAR IMPORTACIÓN</>
              }
            </button>
          </div>

          {/* Right: Report + Instructions */}
          <div className="flex flex-col gap-lg">

            {/* Report */}
            {report ? (
              <div className="border border-outline-variant rounded bg-surface-container-lowest p-md">
                <div className="flex items-center gap-sm mb-md">
                  <span className="material-symbols-outlined text-[20px] text-emerald-500">check_circle</span>
                  <p className="text-body-sm font-bold text-on-surface uppercase tracking-wider">
                    Importación Completada
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-sm mb-md">
                  {[
                    { label: 'Insertados',  value: report.inserted, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
                    { label: 'Omitidos',    value: report.skipped,  color: 'text-amber-600 bg-amber-50 border-amber-200'       },
                    { label: 'Errores',     value: report.errors,   color: 'text-error bg-[#fff4f4] border-red-200'             },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`rounded border p-sm text-center ${color}`}>
                      <p className="text-headline-lg font-bold leading-none">{value}</p>
                      <p className="text-[10px] font-mono uppercase tracking-wider mt-xs">{label}</p>
                    </div>
                  ))}
                </div>

                {report.preview.length > 0 && (
                  <>
                    <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-sm">
                      Vista previa (primeros {report.preview.length} registros)
                    </p>
                    <div className="flex flex-col gap-xs">
                      {report.preview.map((row, i) => (
                        <div key={i} className="flex items-center gap-xs px-sm py-1.5 rounded bg-surface-container text-[12px] font-mono text-on-surface-variant">
                          <span className="text-[10px] text-outline-variant w-4 shrink-0">#{i + 1}</span>
                          <span className="flex-1 truncate text-on-surface font-medium">
                            {row.nombre || row.titulo || '—'}
                          </span>
                          {(row.tipo || row.url) && (
                            <span className="shrink-0 text-[10px] bg-surface-container-lowest border border-outline-variant rounded px-1.5 py-0.5">
                              {row.tipo || new URL(row.url || 'http://x').hostname}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Instructions panel */
              <div className="border border-outline-variant rounded bg-surface-container-lowest p-md">
                <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-md">
                  Instrucciones de Importación
                </p>
                <div className="flex flex-col gap-md">
                  {[
                    {
                      step: '01',
                      title: 'Obtener datos oficiales',
                      desc: 'Descargue el archivo CSV o Excel directamente desde los portales de transparencia (datos.gov.co, cooperación internacional, SECOP II, etc.)',
                    },
                    {
                      step: '02',
                      title: 'Seleccionar tipo de datos',
                      desc: 'Elija si el archivo contiene entidades del Directorio o Convocatorias de financiamiento. El sistema normaliza los nombres de columnas automáticamente.',
                    },
                    {
                      step: '03',
                      title: 'Cargar y verificar',
                      desc: 'Arrastre el archivo al área de carga. El sistema aplica sanitización Zero Trust y detecta duplicados antes de escribir en la base de datos.',
                    },
                    {
                      step: '04',
                      title: 'Revisar resultados',
                      desc: 'Los registros nuevos se marcan como VALIDACIÓN PENDIENTE. Los duplicados son omitidos automáticamente. Revise el reporte de importación.',
                    },
                  ].map(({ step, title, desc }) => (
                    <div key={step} className="flex gap-sm">
                      <span className="text-[11px] font-mono font-bold text-secondary w-6 shrink-0 mt-0.5">{step}</span>
                      <div>
                        <p className="text-body-sm font-bold text-on-surface">{title}</p>
                        <p className="text-[12px] text-on-surface-variant mt-xs leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Accepted sources */}
            <div className="border border-outline-variant rounded bg-surface-container-lowest p-md">
              <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-sm">
                Fuentes Oficiales Recomendadas
              </p>
              <div className="flex flex-col gap-xs">
                {[
                  { label: 'datos.gov.co',               desc: 'Portal de Datos Abiertos Colombia'     },
                  { label: 'secop.gov.co',                desc: 'SECOP II · Contratación pública'       },
                  { label: 'apccolombia.gov.co',          desc: 'Cooperación Internacional APC'         },
                  { label: 'minciencias.gov.co',          desc: 'Convocatorias Ciencia y Tecnología'     },
                  { label: 'projects.worldbank.org',      desc: 'Banco Mundial · Proyectos activos'     },
                ].map(({ label, desc }) => (
                  <div key={label} className="flex items-center gap-sm text-[12px] font-mono py-1 border-b border-[#f2f4f6] last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0" />
                    <span className="text-secondary font-medium">{label}</span>
                    <span className="text-on-surface-variant ml-auto">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
