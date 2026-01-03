import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { 
  DownloadCloud, 
  AlertCircle, 
  FileBox, 
  Check, 
  Settings2,
  AlertTriangle,
  Loader2,
  Cog
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExportFormat, ExportConfig, ExportResult } from '@rapidtool/cad-core';

interface ExportProgressState {
  stage: string;
  progress: number;
  message: string;
}

interface ExportStepContentProps {
  /** Whether a fixture exists */
  hasFixture?: boolean;
  /** Whether cavity cutout has been created (merged fixture mesh exists) */
  hasCavityCutout?: boolean;
  /** Whether this is a multi-section baseplate */
  isMultiSection?: boolean;
  /** Number of sections in multi-section mode */
  sectionCount?: number;
  /** Project name for default export filename */
  projectName?: string;
  /** Callback when export is triggered */
  onExport?: (config: ExportConfig) => void;
  /** Whether export is in progress */
  isExporting?: boolean;
  /** Whether mesh is valid for export */
  meshValid?: boolean;
  /** List of mesh issues */
  meshIssues?: string[];
}

const EXPORT_FORMATS: Array<{
  id: ExportFormat;
  name: string;
  description: string;
  icon: typeof FileBox;
  disabled?: boolean;
  disabledReason?: string;
}> = [
  { id: 'stl', name: 'STL', description: 'Standard Tessellation Language', icon: FileBox },
  { id: '3mf', name: '3MF', description: '3D Manufacturing Format', icon: FileBox, disabled: true, disabledReason: 'Coming soon' },
  { id: 'obj', name: 'OBJ', description: 'Wavefront OBJ', icon: FileBox, disabled: true, disabledReason: 'Coming soon' },
];

const ExportStepContent: React.FC<ExportStepContentProps> = ({
  hasFixture = false,
  hasCavityCutout = false,
  isMultiSection = false,
  sectionCount = 1,
  projectName = 'Fixture',
  onExport,
  isExporting = false,
  meshValid = true,
  meshIssues = []
}) => {
  const [format, setFormat] = useState<ExportFormat>('stl');
  const [binary, setBinary] = useState(true);
  const [splitParts, setSplitParts] = useState(true); // Default to split for multi-section
  const [showFilenameDialog, setShowFilenameDialog] = useState(false);
  const [filename, setFilename] = useState(projectName);
  const [filenameError, setFilenameError] = useState<string | null>(null);
  
  // Export progress state
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);

  // Listen for export progress events
  useEffect(() => {
    const handleExportProgress = (e: CustomEvent<ExportProgressState>) => {
      setExportProgress(e.detail);
    };

    const handleExportComplete = () => {
      // Clear progress after a short delay to show 100%
      setTimeout(() => setExportProgress(null), 500);
    };

    window.addEventListener('export-progress', handleExportProgress as EventListener);
    window.addEventListener('export-complete', handleExportComplete);
    
    return () => {
      window.removeEventListener('export-progress', handleExportProgress as EventListener);
      window.removeEventListener('export-complete', handleExportComplete);
    };
  }, []);

  // Listen for export dialog open event
  useEffect(() => {
    const handleOpenExportDialog = () => {
      // Only show dialog if export is allowed
      if (hasFixture && hasCavityCutout) {
        setShowFilenameDialog(true);
      }
    };

    window.addEventListener('open-export-dialog', handleOpenExportDialog);
    return () => window.removeEventListener('open-export-dialog', handleOpenExportDialog);
  }, [hasFixture, hasCavityCutout]);

  // Update filename when project name changes
  useEffect(() => {
    setFilename(projectName);
  }, [projectName]);

  // Validate filename
  const validateFilename = useCallback((name: string): boolean => {
    if (!name.trim()) {
      setFilenameError('Filename is required');
      return false;
    }
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      setFilenameError('Filename contains invalid characters');
      return false;
    }
    setFilenameError(null);
    return true;
  }, []);

  const handleFilenameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFilename(value);
    validateFilename(value);
  };

  const handleExportClick = () => {
    if (!hasCavityCutout) {
      return; // Should not happen, button should be disabled
    }
    setShowFilenameDialog(true);
  };

  const handleConfirmExport = () => {
    if (!validateFilename(filename)) {
      return;
    }

    const config: ExportConfig = {
      filename: filename.trim(),
      format,
      splitParts: isMultiSection ? splitParts : false,
      options: format === 'stl' ? { binary } : undefined,
    };

    onExport?.(config);
    setShowFilenameDialog(false);
  };

  // Show message if no fixture exists
  if (!hasFixture) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Create a fixture design first to export for 3D printing.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show message if cavity cutout hasn't been created
  if (!hasCavityCutout) {
    return (
      <div className="p-4 space-y-4">
        <Alert className="font-tech border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          <AlertDescription className="text-xs text-yellow-600 dark:text-yellow-400">
            <span className="font-medium">Create cavity cutout first</span>
            <br />
            Use the Cavity tool to cut the workpiece cavities into the supports 
            before exporting the fixture for 3D printing.
          </AlertDescription>
        </Alert>

        <Card className="tech-glass p-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center">
              <DownloadCloud className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-tech font-medium text-muted-foreground">
                Export Disabled
              </p>
              <p className="text-xs text-muted-foreground font-tech">
                Complete the cavity cutout step first
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Mesh Validation Status */}
      <Card className={`tech-glass p-3 ${meshValid ? 'border-green-500/30' : 'border-yellow-500/30'}`}>
        <div className="flex items-center gap-3">
          {meshValid ? (
            <div className="w-8 h-8 rounded-md bg-green-500/10 flex items-center justify-center">
              <Check className="w-4 h-4 text-green-500" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-md bg-yellow-500/10 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm font-tech font-medium">
              {meshValid ? 'Fixture Ready' : 'Mesh Has Issues'}
            </p>
            <p className="text-xs text-muted-foreground font-tech">
              {meshValid 
                ? `Ready for export${isMultiSection ? ` • ${sectionCount} section${sectionCount > 1 ? 's' : ''}` : ''}` 
                : `${meshIssues.length} issue(s) detected`}
            </p>
          </div>
          {!meshValid && (
            <Button variant="outline" size="sm" className="font-tech text-xs">
              Repair
            </Button>
          )}
        </div>
        
        {!meshValid && meshIssues.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <ul className="text-xs text-yellow-600 dark:text-yellow-400 font-tech space-y-1">
              {meshIssues.map((issue, i) => (
                <li key={i}>• {issue}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Export Format Selection */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Export Format
        </Label>
        
        <RadioGroup value={format} onValueChange={(v) => setFormat(v as typeof format)}>
          <div className="space-y-2">
            {EXPORT_FORMATS.map((fmt) => (
              <Card
                key={fmt.id}
                className={`
                  tech-glass p-3 transition-all
                  ${fmt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50'}
                  ${format === fmt.id && !fmt.disabled ? 'border-primary bg-primary/5' : ''}
                `}
                onClick={() => !fmt.disabled && setFormat(fmt.id)}
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem 
                    value={fmt.id} 
                    id={fmt.id} 
                    disabled={fmt.disabled}
                  />
                  <div className="flex-1">
                    <Label 
                      htmlFor={fmt.id} 
                      className={`text-sm font-tech font-medium ${fmt.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {fmt.name}
                    </Label>
                    <p className="text-xs text-muted-foreground font-tech">
                      {fmt.disabled ? fmt.disabledReason : fmt.description}
                    </p>
                  </div>
                  {format === fmt.id && !fmt.disabled && (
                    <Badge variant="default" className="text-xs">
                      Selected
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </RadioGroup>
      </div>

      {/* Export Options */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Settings2 className="w-3 h-3" />
          Options
        </Label>
        
        <div className="space-y-2">
          {format === 'stl' && (
            <Card className="tech-glass p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-tech font-medium">Binary Format</p>
                  <p className="text-xs text-muted-foreground font-tech">
                    Smaller file size (recommended)
                  </p>
                </div>
                <Switch
                  checked={binary}
                  onCheckedChange={setBinary}
                />
              </div>
            </Card>
          )}

          {/* Split Parts - Only show for multi-section baseplates */}
          {isMultiSection && (
            <Card className="tech-glass p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-tech font-medium">Export Parts Individually</p>
                  <p className="text-xs text-muted-foreground font-tech">
                    Create separate file for each baseplate section
                  </p>
                </div>
                <Switch
                  checked={splitParts}
                  onCheckedChange={setSplitParts}
                />
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Export Progress Indicator */}
      {(isExporting || exportProgress) && (
        <Card className="tech-glass p-4 border-primary/30 bg-primary/5">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Cog className="w-4 h-4 text-primary animate-spin" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-tech font-medium text-primary">
                  {exportProgress?.stage === 'manifold' ? 'Creating Manifold Geometry' :
                   exportProgress?.stage === 'exporting' ? 'Generating STL' :
                   exportProgress?.stage === 'complete' ? 'Export Complete!' :
                   'Preparing Export...'}
                </p>
                <p className="text-xs text-muted-foreground font-tech">
                  {exportProgress?.message || 'Initializing...'}
                </p>
              </div>
            </div>
            
            <Progress 
              value={exportProgress?.progress ?? 0} 
              className="h-2"
            />
            
            <p className="text-xs text-muted-foreground font-tech text-center">
              {Math.round(exportProgress?.progress ?? 0)}% complete
            </p>
          </div>
        </Card>
      )}

      {/* Export Button */}
      <Button
        variant="default"
        size="sm"
        className="w-full font-tech"
        onClick={handleExportClick}
        disabled={isExporting || !meshValid || !!exportProgress}
      >
        {isExporting || exportProgress ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {exportProgress?.stage === 'manifold' ? 'Processing...' : 'Exporting...'}
          </>
        ) : (
          <>
            <DownloadCloud className="w-4 h-4 mr-2" />
            Export {format.toUpperCase()}
          </>
        )}
      </Button>

      {/* Info */}
      <Card className="tech-glass">
        <div className="p-3 text-xs text-muted-foreground font-tech">
          <p>
            {isMultiSection && splitParts
              ? `Export will create ${sectionCount} separate STL file${sectionCount > 1 ? 's' : ''}, one for each baseplate section.`
              : 'Export your fixture design for 3D printing. Files follow the naming convention: Filename_RapidTool.stl'
            }
          </p>
        </div>
      </Card>

      {/* Filename Dialog */}
      <Dialog open={showFilenameDialog} onOpenChange={setShowFilenameDialog}>
        <DialogContent className="sm:max-w-md tech-glass">
          <DialogHeader>
            <DialogTitle className="font-tech">Export Fixture</DialogTitle>
            <DialogDescription className="font-tech text-xs">
              Enter a filename for your exported fixture.
              {isMultiSection && splitParts && (
                <span className="block mt-1 text-primary">
                  Section numbers will be appended automatically.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="filename" className="text-xs font-tech">
                Filename
              </Label>
              <Input
                id="filename"
                value={filename}
                onChange={handleFilenameChange}
                placeholder="Enter filename"
                className="font-tech"
                autoFocus
              />
              {filenameError && (
                <p className="text-xs text-red-500 font-tech">{filenameError}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs font-tech text-muted-foreground">
                Preview
              </Label>
              <div className="bg-muted/50 rounded-md p-2 space-y-1">
                {isMultiSection && splitParts ? (
                  Array.from({ length: Math.min(sectionCount, 3) }, (_, i) => (
                    <p key={i} className="text-xs font-mono text-muted-foreground">
                      {filename || 'Fixture'}_Section{i + 1}_RapidTool.{format}
                    </p>
                  ))
                ) : (
                  <p className="text-xs font-mono text-muted-foreground">
                    {filename || 'Fixture'}_RapidTool.{format}
                  </p>
                )}
                {isMultiSection && splitParts && sectionCount > 3 && (
                  <p className="text-xs font-mono text-muted-foreground">
                    ... and {sectionCount - 3} more
                  </p>
                )}
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilenameDialog(false)}
              className="font-tech"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmExport}
              disabled={!!filenameError || !filename.trim()}
              className="font-tech"
            >
              <DownloadCloud className="w-4 h-4 mr-2" />
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ExportStepContent;

