/**
 * FileDropzone
 *
 * Drag-and-drop file upload component for 3D models.
 * Supports file size validation and visual feedback.
 */

import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { SUPPORTED_FORMATS } from '../types';
import { MAX_FILE_SIZE } from '../hooks/useFileProcessing';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FileDropzoneProps {
  /** Callback when a valid file is selected */
  onFileSelected: (file: File) => void;
  /** Whether file processing is in progress */
  isProcessing?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / 1024 / 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/** Formats file size in MB */
const formatFileSizeMB = (bytes: number): string =>
  (bytes / 1024 / 1024).toFixed(2);

/** Creates a file input element and triggers selection */
const triggerFilePicker = (
  accept: string,
  onSelect: (file: File) => void
): void => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = false;
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) onSelect(file);
  };
  input.click();
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface DropzoneIconProps {
  isProcessing: boolean;
  isDragOver: boolean;
}

const DropzoneIcon: React.FC<DropzoneIconProps> = ({ isProcessing, isDragOver }) => (
  <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-muted/20 border border-border flex items-center justify-center">
    {isProcessing ? (
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin-smooth" />
    ) : (
      <Upload
        className={cn(
          'w-8 h-8 transition-colors',
          isDragOver ? 'text-primary' : 'text-muted-foreground'
        )}
      />
    )}
  </div>
);

interface FormatInfoProps {
  fileSizeError: string | null;
}

const FormatInfo: React.FC<FormatInfoProps> = ({ fileSizeError }) => (
  <div className="mt-6 pt-4 border-t border-border">
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground font-tech">
      <FileText className="w-3 h-3" />
      <span>Supported formats: {SUPPORTED_FORMATS.join(', ')}</span>
    </div>
    <div className="flex items-center justify-center gap-2 mt-1 text-xs text-muted-foreground font-tech">
      <AlertCircle className="w-3 h-3" />
      <span>Maximum file size: {MAX_FILE_SIZE_MB} MB</span>
    </div>
    {fileSizeError && (
      <div className="flex items-center justify-center gap-2 mt-2 text-xs text-destructive font-tech">
        <AlertCircle className="w-3 h-3" />
        <span>{fileSizeError}</span>
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const FileDropzone: React.FC<FileDropzoneProps> = ({
  onFileSelected,
  isProcessing = false,
  className = '',
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileSizeError, setFileSizeError] = useState<string | null>(null);

  const validateAndSelectFile = useCallback(
    (file: File) => {
      setFileSizeError(null);

      if (file.size > MAX_FILE_SIZE) {
        const sizeMB = formatFileSizeMB(file.size);
        setFileSizeError(
          `File too large (${sizeMB} MB). Maximum allowed size is ${MAX_FILE_SIZE_MB} MB.`
        );
        return;
      }

      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        validateAndSelectFile(file);
      }
    },
    [validateAndSelectFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only update if leaving the dropzone, not child elements
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const openFilePicker = useCallback(() => {
    setFileSizeError(null);
    triggerFilePicker(SUPPORTED_FORMATS.join(','), validateAndSelectFile);
  }, [validateAndSelectFile]);

  const getHeadingText = (): string => {
    if (isProcessing) return 'Processing...';
    if (isDragOver) return 'Drop your file here';
    return 'Import 3D Model';
  };

  return (
    <Card
      className={cn(
        'relative overflow-hidden tech-glass border-2 transition-all duration-300',
        isDragOver ? 'border-primary bg-primary/5' : 'border-dashed border-border',
        isProcessing ? 'opacity-50 pointer-events-none' : 'hover:border-primary/50',
        className
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="p-8 text-center">
        <DropzoneIcon isProcessing={isProcessing} isDragOver={isDragOver} />

        <div className="space-y-2">
          <h3 className="font-tech font-semibold text-lg">{getHeadingText()}</h3>

          {!isProcessing && (
            <p className="text-sm text-muted-foreground font-tech">
              Drag and drop your file here, or{' '}
              <Button
                variant="link"
                className="p-0 h-auto font-tech text-primary hover:underline"
                onClick={openFilePicker}
              >
                browse files
              </Button>
            </p>
          )}
        </div>

        {!isProcessing && <FormatInfo fileSizeError={fileSizeError} />}

        {isProcessing && (
          <div className="mt-4 text-xs text-primary font-tech">
            Reading and parsing your 3D model...
          </div>
        )}
      </div>

      {/* Drag overlay */}
      {isDragOver && !isProcessing && (
        <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center">
          <div className="text-primary font-tech font-semibold">Release to upload</div>
        </div>
      )}
    </Card>
  );
};

export default FileDropzone;