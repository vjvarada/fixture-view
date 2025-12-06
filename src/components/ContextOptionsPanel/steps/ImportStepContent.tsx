import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { AlertCircle, Check } from 'lucide-react';
import FileDropzone from '@/modules/FileImport/components/FileDropzone';
import { ProcessedFile } from '@/modules/FileImport/types';

interface ImportStepContentProps {
  currentFile?: ProcessedFile | null;
  isProcessing?: boolean;
  error?: string | null;
  onFileSelected: (file: File) => void;
}

const ImportStepContent: React.FC<ImportStepContentProps> = ({
  currentFile,
  isProcessing = false,
  error,
  onFileSelected
}) => {
  const hasFile = !!currentFile;

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
              File imported successfully!
            </span>
          </div>
          
          {/* Info about file location */}
          <p className="text-xs text-muted-foreground font-tech">
            View file details in the <span className="text-primary">Properties Panel</span> on the right.
          </p>
          
          {/* Additional file upload */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-tech">
              Import additional workpieces:
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
          </div>
        </Card>
      )}
    </div>
  );
};

export default ImportStepContent;
