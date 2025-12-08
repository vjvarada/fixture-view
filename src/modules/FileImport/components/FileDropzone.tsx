import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { SUPPORTED_FORMATS } from "../types";
import { MAX_FILE_SIZE } from "../hooks/useFileProcessingRefactored";

interface FileDropzoneProps {
  onFileSelected: (file: File) => void;
  isProcessing?: boolean;
  className?: string;
}

const FileDropzone = ({ onFileSelected, isProcessing = false, className = "" }: FileDropzoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileSizeError, setFileSizeError] = useState<string | null>(null);

  const validateAndSelectFile = useCallback((file: File) => {
    setFileSizeError(null);
    
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      setFileSizeError(`File too large (${sizeMB} MB). Maximum allowed size is 100 MB.`);
      return;
    }
    
    onFileSelected(file);
  }, [onFileSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    // Only take the first file - one at a time for mesh analysis
    const file = files[0];

    if (file) {
      console.log('File dropped:', file.name, 'Size:', file.size, 'Type:', file.type);
      validateAndSelectFile(file);
    } else {
      console.log('No file dropped');
    }
  }, [validateAndSelectFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only set to false if we're leaving the dropzone itself, not child elements
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('File selected via input:', file.name, 'Size:', file.size, 'Type:', file.type);
      validateAndSelectFile(file);
    } else {
      console.log('No file selected via input');
    }
    // Reset input value to allow selecting the same file again
    e.target.value = '';
  }, [validateAndSelectFile]);

  const openFilePicker = useCallback(() => {
    console.log('Opening file picker...');
    setFileSizeError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SUPPORTED_FORMATS.join(',');
    // Single file selection - one at a time for mesh analysis
    input.multiple = false;
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        console.log('File picked via picker:', file.name, 'Size:', file.size, 'Type:', file.type);
        validateAndSelectFile(file);
      } else {
        console.log('No file picked via picker');
      }
    };
    input.click();
  }, [validateAndSelectFile]);

  return (
    <Card
      className={`
        relative overflow-hidden tech-glass border-2 transition-all duration-300
        ${isDragOver ? 'border-primary bg-primary/5' : 'border-dashed border-border'}
        ${isProcessing ? 'opacity-50 pointer-events-none' : 'hover:border-primary/50'}
        ${className}
      `}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="p-8 text-center">
        {/* Icon */}
        <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-muted/20 border border-border flex items-center justify-center">
          {isProcessing ? (
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin-smooth" />
          ) : (
            <Upload className={`w-8 h-8 transition-colors ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          )}
        </div>

        {/* Content */}
        <div className="space-y-2">
          <h3 className="font-tech font-semibold text-lg">
            {isProcessing ? 'Processing...' : isDragOver ? 'Drop your file here' : 'Import 3D Model'}
          </h3>
          
          {!isProcessing && (
            <p className="text-sm text-muted-foreground font-tech">
              Drag and drop your file here, or{" "}
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

        {/* Supported formats */}
        {!isProcessing && (
          <div className="mt-6 pt-4 border-t border-border">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground font-tech">
              <FileText className="w-3 h-3" />
              <span>Supported formats: {SUPPORTED_FORMATS.join(', ')}</span>
            </div>
            <div className="flex items-center justify-center gap-2 mt-1 text-xs text-muted-foreground font-tech">
              <AlertCircle className="w-3 h-3" />
              <span>Maximum file size: 100 MB</span>
            </div>
            {fileSizeError && (
              <div className="flex items-center justify-center gap-2 mt-2 text-xs text-destructive font-tech">
                <AlertCircle className="w-3 h-3" />
                <span>{fileSizeError}</span>
              </div>
            )}
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="mt-4 text-xs text-primary font-tech">
            Reading and parsing your 3D model...
          </div>
        )}
      </div>

      {/* Drag overlay */}
      {isDragOver && !isProcessing && (
        <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center">
          <div className="text-primary font-tech font-semibold">
            Release to upload
          </div>
        </div>
      )}
    </Card>
  );
};

export default FileDropzone;