import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { AlertCircle, Check, X, FileBox } from 'lucide-react';
import FileDropzone from '@/modules/FileImport/components/FileDropzone';
import { ProcessedFile } from '@/modules/FileImport/types';
import { Button } from '@/components/ui/button';

interface ImportStepContentProps {
  currentFile?: ProcessedFile | null;
  parts?: ProcessedFile[];
  isProcessing?: boolean;
  error?: string | null;
  onFileSelected: (file: File) => void;
  onRemovePart?: (partId: string) => void;
}

const ImportStepContent: React.FC<ImportStepContentProps> = ({
  currentFile,
  parts = [],
  isProcessing = false,
  error,
  onFileSelected,
  onRemovePart
}) => {
  const hasFile = !!currentFile || parts.length > 0;
  const displayParts = parts.length > 0 ? parts : (currentFile ? [currentFile] : []);

  return (
    <div className="p-4 space-y-4">
      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {/* File Upload */}
      {!hasFile ? (
        <FileDropzone
          onFileSelected={onFileSelected}
          isProcessing={isProcessing}
          className="min-h-[180px]"
        />
      ) : (
        <div className="space-y-4">
          {/* Success message */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <Check className="w-5 h-5 text-green-500" />
            <span className="text-sm font-tech text-green-600">
              {displayParts.length} part{displayParts.length !== 1 ? 's' : ''} imported successfully!
            </span>
          </div>
          
          {/* Imported parts list */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-tech font-semibold">
              Imported Parts:
            </p>
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {displayParts.map((part) => (
                <div 
                  key={part.id}
                  className="flex items-center justify-between gap-2 p-2 rounded bg-muted/30 border border-border"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileBox className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-xs font-tech truncate">
                      {part.metadata.name}
                    </span>
                  </div>
                  {onRemovePart && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-destructive/20"
                      onClick={() => onRemovePart(part.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Info about file location */}
          <p className="text-xs text-muted-foreground font-tech">
            View part details in the <span className="text-primary">Properties Panel</span> on the right.
          </p>
          
          {/* Additional file upload - one at a time */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-tech">
              Import additional workpiece:
            </p>
            <FileDropzone
              onFileSelected={onFileSelected}
              isProcessing={isProcessing}
              className="min-h-[80px]"
            />
          </div>
        </div>
      )}

      {/* Quick info when no file */}
      {!hasFile && !isProcessing && (
        <Card className="tech-glass">
          <div className="p-4 text-xs text-muted-foreground font-tech space-y-2">
            <p className="font-semibold text-foreground">Supported formats:</p>
            <div className="flex flex-wrap gap-2">
              {['STL', 'OBJ', 'GLTF', 'GLB'].map(fmt => (
                <span key={fmt} className="px-2 py-0.5 bg-muted/50 rounded text-xs">
                  {fmt}
                </span>
              ))}
            </div>
            <p className="text-muted-foreground/80 mt-2">
              Import one file at a time for mesh analysis and optimization.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};

export default ImportStepContent;
