import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  TriangleAlert,
  Cpu,
  Minimize2,
  Box,
  Wrench,
  Sparkles,
  FileWarning,
} from 'lucide-react';
import {
  MeshAnalysisResult,
  MeshProcessingProgress,
  DECIMATION_THRESHOLD,
  DECIMATION_TARGET,
} from '../services/meshAnalysis';

/** Files larger than 5MB should be auto-optimized */
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

export interface ProcessingResult {
  success: boolean;
  wasRepaired: boolean;
  wasDecimated: boolean;
  originalTriangles: number;
  finalTriangles: number;
  reductionPercent: number;
  actions: string[];
  error?: string;
}

interface MeshOptimizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: MeshAnalysisResult | null;
  progress: MeshProcessingProgress | null;
  isProcessing: boolean;
  fileSize?: number; // File size in bytes
  processingResult?: ProcessingResult | null; // Results after processing
  onProceedWithOriginal: (shouldRepair?: boolean) => void;
  onOptimizeMesh: (shouldRepair?: boolean) => void;
  onRepairAndOptimize?: () => void;
  onConfirmResult?: () => void; // Confirm and continue after viewing results
  onCancel: () => void;
}

const formatNumber = (num: number): string => {
  return num.toLocaleString();
};

const MeshOptimizationDialog: React.FC<MeshOptimizationDialogProps> = ({
  open,
  onOpenChange,
  analysis,
  progress,
  isProcessing,
  fileSize,
  processingResult,
  onProceedWithOriginal,
  onOptimizeMesh,
  onRepairAndOptimize,
  onConfirmResult,
  onCancel,
}) => {
  // Local state to prevent dialog from closing when action is triggered
  const [actionTriggered, setActionTriggered] = useState(false);
  
  // Reset actionTriggered when dialog closes or when we have results
  useEffect(() => {
    if (!open) {
      setActionTriggered(false);
    }
  }, [open]);
  
  // Reset actionTriggered when results are available
  useEffect(() => {
    if (processingResult) {
      setActionTriggered(false);
    }
  }, [processingResult]);
  
  // Prevent closing while processing OR while action is being triggered (but not when showing results)
  const preventClose = (isProcessing || actionTriggered) && !processingResult;
  
  const needsDecimation = analysis && analysis.triangleCount > DECIMATION_THRESHOLD;
  const isMandatoryOptimization = needsDecimation; // >500K triangles = mandatory optimization
  const hasIssues = analysis && analysis.issues.length > 0;
  const hasRepairableIssues = hasIssues && !analysis?.issues.every(i => i.includes('High triangle count'));
  const isLargeFile = fileSize && fileSize > LARGE_FILE_THRESHOLD;
  
  const getStageIcon = () => {
    if (!progress) return null;
    
    switch (progress.stage) {
      case 'analyzing':
        return <Cpu className="w-4 h-4 animate-pulse" />;
      case 'repairing':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'decimating':
        return <Minimize2 className="w-4 h-4 animate-pulse" />;
      case 'complete':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      default:
        return null;
    }
  };
  
  // Determine dialog title and description based on state
  const getDialogTitle = () => {
    if (processingResult) {
      return processingResult.success ? 'Processing Complete' : 'Processing Failed';
    }
    if (isProcessing) return 'Processing Mesh...';
    return 'Mesh Analysis';
  };
  
  const getDialogDescription = () => {
    if (processingResult) {
      return processingResult.success 
        ? 'Your mesh has been processed. Review the results below.'
        : 'There was an issue processing your mesh.';
    }
    if (isProcessing) {
      return 'Please wait while the mesh is being processed. This may take a moment for large files.';
    }
    return 'Review the mesh analysis results and decide how to proceed.';
  };

  return (
    <Dialog open={open} onOpenChange={preventClose ? undefined : onOpenChange}>
      <DialogContent 
        className="sm:max-w-[500px]" 
        onPointerDownOutside={preventClose ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={preventClose ? (e) => e.preventDefault() : undefined}
        onInteractOutside={preventClose ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {processingResult?.success ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : processingResult && !processingResult.success ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : (
              <Box className="w-5 h-5" />
            )}
            {getDialogTitle()}
          </DialogTitle>
          <DialogDescription>
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>

        {/* Results Section - shown after processing completes */}
        {processingResult && (
          <div className="space-y-4">
            {processingResult.success ? (
              <>
                {/* Success Summary */}
                <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span className="font-medium text-green-700 dark:text-green-400">
                      Optimization Successful
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-2 bg-background/50 rounded">
                      <div className="text-muted-foreground text-xs">Original</div>
                      <div className="font-mono font-medium">{formatNumber(processingResult.originalTriangles)} triangles</div>
                    </div>
                    <div className="p-2 bg-background/50 rounded">
                      <div className="text-muted-foreground text-xs">Optimized</div>
                      <div className="font-mono font-medium">{formatNumber(processingResult.finalTriangles)} triangles</div>
                    </div>
                  </div>
                  
                  {processingResult.reductionPercent > 0 && (
                    <div className="mt-3 p-2 bg-background/50 rounded text-center">
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {processingResult.reductionPercent.toFixed(1)}% reduction
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Actions taken */}
                {processingResult.actions.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Actions Performed:</div>
                    <div className="space-y-1">
                      {processingResult.actions.map((action, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                          <span>{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Status badges */}
                <div className="flex gap-2 flex-wrap">
                  {processingResult.wasRepaired && (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      <Wrench className="w-3 h-3 mr-1" />
                      Repaired
                    </Badge>
                  )}
                  {processingResult.wasDecimated && (
                    <Badge variant="outline" className="text-blue-600 border-blue-600">
                      <Minimize2 className="w-3 h-3 mr-1" />
                      Decimated
                    </Badge>
                  )}
                </div>
              </>
            ) : (
              /* Error display */
              <Alert variant="destructive">
                <XCircle className="w-4 h-4" />
                <AlertDescription className="ml-2">
                  <strong>Processing failed</strong>
                  <br />
                  <span className="text-sm">{processingResult.error}</span>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Progress Section - shown during processing */}
        {isProcessing && !processingResult && (
          <div className="space-y-4 py-4 border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              {getStageIcon()}
              <span className="text-sm font-medium capitalize">{progress?.stage || 'Processing'}</span>
            </div>
            <Progress value={progress?.progress || 0} className="h-3" />
            <p className="text-sm text-muted-foreground text-center">{progress?.message || 'Processing mesh...'}</p>
            <p className="text-xs text-muted-foreground text-center italic">
              Do not close this dialog while processing is in progress.
            </p>
          </div>
        )}

        {/* Analysis Results - shown when we have analysis and no processing result yet */}
        {analysis && !processingResult && (
          <div className="space-y-4">
            {/* Triangle Count */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Triangle Count</span>
              </div>
              <Badge variant={needsDecimation ? 'destructive' : 'secondary'}>
                {formatNumber(analysis.triangleCount)}
              </Badge>
            </div>

            {/* Vertex Count */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Vertex Count</span>
              </div>
              <Badge variant="secondary">
                {formatNumber(analysis.vertexCount)}
              </Badge>
            </div>

            {/* Manifold Status */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Mesh Status</span>
              </div>
              {analysis.isManifold ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Manifold
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Non-Manifold
                </Badge>
              )}
            </div>

            {/* Bounding Box */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <span className="text-sm font-medium">Bounding Box</span>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>X: {analysis.boundingBox.size.x.toFixed(2)}</div>
                <div>Y: {analysis.boundingBox.size.y.toFixed(2)}</div>
                <div>Z: {analysis.boundingBox.size.z.toFixed(2)}</div>
              </div>
            </div>

            <Separator />

            {/* Issues Section */}
            {hasIssues && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm font-medium">Issues Detected</span>
                </div>
                <div className="space-y-1">
                  {analysis.issues.map((issue, index) => (
                    <Alert key={index} variant="default" className="py-2">
                      <AlertDescription className="text-xs">
                        {issue}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            {/* Large File Warning */}
            {isLargeFile && !needsDecimation && (
              <Alert>
                <FileWarning className="w-4 h-4 text-blue-500" />
                <AlertDescription className="ml-2">
                  <strong>Large file detected</strong>
                  <br />
                  <span className="text-xs">
                    File size: {(fileSize! / 1024 / 1024).toFixed(2)} MB. 
                    Consider optimizing for better performance.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {/* High Triangle Count Warning */}
            {needsDecimation && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription className="ml-2">
                  <strong>Optimization Required</strong>
                  <br />
                  <span className="text-xs">
                    This mesh has {formatNumber(analysis.triangleCount)} triangles, 
                    which exceeds the maximum allowed threshold of {formatNumber(DECIMATION_THRESHOLD)}.
                    <br /><br />
                    <strong>Optimization is mandatory</strong> for meshes with more than 500,000 triangles 
                    to ensure acceptable performance.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {/* No Issues */}
            {!hasIssues && !needsDecimation && !isLargeFile && (
              <Alert>
                <CheckCircle className="w-4 h-4 text-green-500" />
                <AlertDescription className="ml-2">
                  Mesh looks good! No issues detected.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="flex flex-wrap gap-2 sm:gap-2">
          {/* When showing results, show only Continue button */}
          {processingResult ? (
            <Button
              onClick={onConfirmResult}
              className="w-full sm:w-auto"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Continue to 3D Viewer
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={preventClose}
              >
                Cancel
              </Button>
          
              {/* Case 1: High triangle count (>500K) - optimization is MANDATORY, no skip option */}
              {needsDecimation && !isProcessing && (
                <>
                  {/* If mesh also has issues, show Repair & Optimize as primary action */}
                  {hasRepairableIssues && onRepairAndOptimize ? (
                    <Button
                      onClick={() => {
                        setActionTriggered(true);
                    onRepairAndOptimize();
                  }}
                  disabled={preventClose}
                >
                  {preventClose ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Repair & Optimize
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setActionTriggered(true);
                    onOptimizeMesh(false);
                  }}
                  disabled={preventClose}
                >
                  {preventClose ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    <>
                      <Minimize2 className="w-4 h-4 mr-2" />
                      Optimize Mesh
                    </>
                  )}
                </Button>
              )}
            </>
          )}
          
          {/* Case 2: Has issues but not high triangle count - show Skip Repair + Repair options */}
          {!needsDecimation && !isLargeFile && hasRepairableIssues && !isProcessing && (
            <>
              <Button
                variant="secondary"
                onClick={() => onProceedWithOriginal(false)}
                disabled={preventClose}
              >
                Skip Repair
              </Button>
              <Button
                onClick={() => {
                  setActionTriggered(true);
                  onProceedWithOriginal(true);
                }}
                disabled={preventClose}
              >
                {preventClose ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Repairing...
                  </>
                ) : (
                  <>
                    <Wrench className="w-4 h-4 mr-2" />
                    Repair Mesh
                  </>
                )}
              </Button>
            </>
          )}
          
          {/* Case 3: Large file but not high triangle count - offer optimization */}
          {!needsDecimation && isLargeFile && !isProcessing && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  if (hasRepairableIssues) setActionTriggered(true);
                  onProceedWithOriginal(hasRepairableIssues);
                }}
                disabled={preventClose}
              >
                {hasRepairableIssues ? 'Repair Only' : 'Use Original'}
              </Button>
              
              {hasRepairableIssues && onRepairAndOptimize ? (
                <Button
                  onClick={() => {
                    setActionTriggered(true);
                    onRepairAndOptimize();
                  }}
                  disabled={preventClose}
                >
                  {preventClose ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Repair & Optimize
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setActionTriggered(true);
                    onOptimizeMesh(false);
                  }}
                  disabled={preventClose}
                >
                  {preventClose ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    <>
                      <Minimize2 className="w-4 h-4 mr-2" />
                      Optimize Mesh
                    </>
                  )}
                </Button>
              )}
            </>
          )}
          
          {/* Case 4: No issues, no decimation needed, not large - simple Continue */}
          {!needsDecimation && !hasRepairableIssues && !isLargeFile && !isProcessing && (
            <Button
              onClick={() => onProceedWithOriginal(false)}
              disabled={preventClose}
            >
              Continue
            </Button>
          )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MeshOptimizationDialog;
