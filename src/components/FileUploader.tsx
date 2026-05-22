import { useState, useCallback, useRef } from 'react';
import { Upload, X, FileText, Image, Table, File, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { processFile, type FileProcessResult, sanitizeFileName, createMultimodalPayload } from '../services/storage/fileReader';
import geminiService from '../services/ai/geminiService';
import type { AITask } from '../services/ai/types';
import './FileUploader.css';

interface FileUploaderProps {
  onFilesProcessed?: (results: FileProcessResult[]) => void;
  onMultimodalResponse?: (response: string, context: string) => void;
  taskType?: AITask['type'];
  maxFiles?: number;
}

interface ProcessedFile extends FileProcessResult {
  originalFile: File;
}

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function FileUploader({ 
  onFilesProcessed,
  onMultimodalResponse,
  taskType = 'general',
  maxFiles = 5
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFiles = useCallback((files: FileList | File[]): { valid: File[]; errors: string[] } => {
    const validFiles: File[] = [];
    const errors: string[] = [];
    
    Array.from(files).forEach(file => {
      const ext = '.' + file.name.toLowerCase().split('.').pop();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`Extensión no permitida: ${file.name}`);
        return;
      }
      
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`Archivo demasiado grande: ${file.name} (max 10MB)`);
        return;
      }
      
      validFiles.push(file);
    });
    
    return { valid: validFiles, errors };
  }, []);

  const processFiles = useCallback(async (files: File[]) => {
    setError(null);
    setIsProcessing(true);
    
    const results: ProcessedFile[] = [];
    
    for (const file of files) {
      try {
        const result = await processFile(file);
        results.push({ ...result, originalFile: file });
      } catch (err) {
        results.push({
          success: false,
          error: err instanceof Error ? err.message : 'Error desconocido',
          originalFile: file,
        });
      }
    }
    
    setProcessedFiles(prev => [...prev, ...results].slice(-maxFiles));
    onFilesProcessed?.(results);
    setIsProcessing(false);
  }, [maxFiles, onFilesProcessed]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const { valid, errors } = validateFiles(e.dataTransfer.files);
    
    if (errors.length > 0) {
      setError(errors.join('. '));
    }
    
    if (valid.length > 0) {
      processFiles(valid);
    }
  }, [validateFiles, processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const { valid, errors } = validateFiles(files);
    
    if (errors.length > 0) {
      setError(errors.join('. '));
    }
    
    if (valid.length > 0) {
      processFiles(valid);
    }
    
    e.target.value = '';
  }, [validateFiles, processFiles]);

  const handleRemoveFile = useCallback((index: number) => {
    setProcessedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSendToAI = useCallback(async (userPrompt: string) => {
    const successfulFiles = processedFiles.filter(f => f.success && f.data);
    
    if (successfulFiles.length === 0) {
      setError('No hay archivos válidos para procesar');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const fileResults: FileProcessResult[] = successfulFiles.map(f => ({
        success: f.success,
        data: f.data,
        mimeType: f.mimeType,
        fileName: f.fileName,
        fileSize: f.fileSize,
      }));
      
      const { parts, context } = createMultimodalPayload(fileResults, userPrompt);
      
      const result = await geminiService.processMultimodalTask(
        parts,
        taskType,
        userPrompt
      );
      
      if (result.success && result.result) {
        onMultimodalResponse?.(result.result, context);
      } else {
        setError(result.error || 'Error al procesar con IA');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar a la IA');
    } finally {
      setIsProcessing(false);
    }
  }, [processedFiles, taskType, onMultimodalResponse]);

  const getFileIcon = (mimeType?: string) => {
    if (!mimeType) return <File size={16} />;
    if (mimeType.startsWith('image/')) return <Image size={16} />;
    if (mimeType.includes('spreadsheet') || mimeType === 'text/csv') return <Table size={16} />;
    if (mimeType === 'application/pdf') return <FileText size={16} />;
    return <File size={16} />;
  };

  return (
    <div className="file-uploader">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${processedFiles.length > 0 ? 'has-files' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        
        <div className="drop-zone-content">
          <Upload size={32} className="upload-icon" />
          <p className="drop-zone-text">
            {isDragging 
              ? 'Suelta los archivos aquí' 
              : 'Arrastra archivos o haz clic para seleccionar'}
          </p>
          <p className="drop-zone-hint">
            PDF, DOCX, XLSX, CSV, JPG, PNG (max 10MB)
          </p>
        </div>
      </div>
      
      {error && (
        <div className="upload-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="error-dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      
      {processedFiles.length > 0 && (
        <div className="file-list">
          {processedFiles.map((file, index) => (
            <div key={index} className={`file-item ${file.success ? 'success' : 'error'}`}>
              <div className="file-icon">
                {getFileIcon(file.mimeType)}
              </div>
              <div className="file-info">
                <span className="file-name">{sanitizeFileName(file.fileName || file.originalFile.name)}</span>
                <span className="file-size">
                  {file.fileSize 
                    ? `${(file.fileSize / 1024).toFixed(1)} KB` 
                    : file.success 
                      ? 'Procesado' 
                      : file.error}
                </span>
              </div>
              <div className="file-status">
                {file.success ? (
                  <CheckCircle size={16} className="status-success" />
                ) : (
                  <AlertCircle size={16} className="status-error" />
                )}
              </div>
              <button 
                className="file-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveFile(index);
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      
      {isProcessing && (
        <div className="processing-indicator">
          <Loader2 size={16} className="spin" />
          <span>Procesando archivos...</span>
        </div>
      )}
    </div>
  );
}

interface FileUploaderWithPromptProps extends FileUploaderProps {
  onSubmit: (prompt: string) => void;
}

export function FileUploaderWithPrompt(props: FileUploaderWithPromptProps) {
  const [prompt, setPrompt] = useState('');
  const [localProcessing, setLocalProcessing] = useState(false);
  
  const handleSubmit = async () => {
    if (prompt.trim()) {
      setLocalProcessing(true);
      await props.onSubmit(prompt);
      setLocalProcessing(false);
    }
  };
  
  return (
    <div className="file-uploader-with-prompt">
      <FileUploader {...props} />
      <div className="prompt-input">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="¿Qué deseas analizar de estos archivos?"
          rows={3}
        />
        <button 
          onClick={handleSubmit}
          disabled={!prompt.trim() || localProcessing}
          className="submit-btn"
        >
          {localProcessing ? 'Enviando...' : 'Enviar a IA'}
        </button>
      </div>
    </div>
  );
}