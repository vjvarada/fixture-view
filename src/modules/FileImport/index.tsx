import React, { useRef, useState, useCallback, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import FileDropzone from "./components/FileDropzone";
import { useFileProcessing } from "./hooks/useFileProcessing";
import { useViewer } from "./hooks/useViewer";
import UnitsDialog from "./components/UnitsDialog";
import MeshOptimizationDialog from "./components/MeshOptimizationDialog";
import LoadingOverlay from "@/components/loading/LoadingOverlay";
import { ProcessedFile } from "./types";
import {
  analyzeMesh,
  repairMesh,
  decimateMesh,
  MeshAnalysisResult,
  MeshProcessingProgress,
  DECIMATION_THRESHOLD,
  DECIMATION_TARGET,
} from "@rapidtool/cad-core";
import * as THREE from 'three';
import { createLogger } from '@/utils/logger';

const logger = createLogger('FileImport');

interface FileImportProps {
  onFileLoaded: (file: ProcessedFile | null) => void;
  isInCollapsiblePanel?: boolean;
}

const FileImport: React.FC<FileImportProps> = ({ onFileLoaded, isInCollapsiblePanel = false }) => {
  const [currentFile, setCurrentFile] = useState<ProcessedFile | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnitsDialogOpen, setIsUnitsDialogOpen] = useState(false);
  const [isOptimizationDialogOpen, setIsOptimizationDialogOpen] = useState(false);
  const [meshAnalysis, setMeshAnalysis] = useState<MeshAnalysisResult | null>(null);
  const [meshProgress, setMeshProgress] = useState<MeshProcessingProgress | null>(null);
  const [isMeshProcessing, setIsMeshProcessing] = useState(false);
  const [pendingProcessedFile, setPendingProcessedFile] = useState<ProcessedFile | null>(null);
  const [loadingState, setLoadingState] = useState<{
    isLoading: boolean;
    type?: 'file-processing' | 'model-loading';
    message?: string;
    progress?: number;
    details?: string;
  }>({ isLoading: false });

  const pendingFileRef = useRef<File | null>(null);
  const pendingArrayBufferRef = useRef<ArrayBuffer | null>(null);
  const { processFile, isProcessing: fileProcessing, error: fileError, clearError } = useFileProcessing();

  // Listen for session reset to clear internal state
  useEffect(() => {
    const handleSessionReset = () => {
      setCurrentFile(null);
      setIsProcessing(false);
      setError(null);
      setIsUnitsDialogOpen(false);
      setIsOptimizationDialogOpen(false);
      setMeshAnalysis(null);
      setMeshProgress(null);
      setIsMeshProcessing(false);
      setPendingProcessedFile(null);
      pendingFileRef.current = null;
      pendingArrayBufferRef.current = null;
    };

    window.addEventListener('session-reset', handleSessionReset);
    return () => window.removeEventListener('session-reset', handleSessionReset);
  }, []);

  // Remove viewer when in collapsible panel mode
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewer = isInCollapsiblePanel ? {
    isReady: false,
    addMesh: () => {},
    removeMesh: () => {},
    clearBaseplate: () => {},
    resetView: () => {}
  } : useViewer(viewerContainerRef);

  // Handle file selection - read file data immediately to avoid NotReadableError
  const handleFileSelected = useCallback(async (file: File) => {
    logger.info('File selected:', file.name);
    try {
      // Read file data immediately to avoid stale file reference issues
      const arrayBuffer = await file.arrayBuffer();
      pendingFileRef.current = file;
      pendingArrayBufferRef.current = arrayBuffer;
      setIsUnitsDialogOpen(true);
    } catch (err) {
      logger.error('Error reading file:', err);
      setError('Failed to read file. Please try selecting the file again.');
    }
  }, []);

  // Handle units selection
  const handleUnitsSelected = useCallback(async (units: string) => {
    if (!pendingFileRef.current || !pendingArrayBufferRef.current) return;

    setIsUnitsDialogOpen(false);
    setIsProcessing(true);
    setError(null);

    try {
      // Use the pre-loaded ArrayBuffer to avoid stale file reference issues
      const processedFile = await processFile(pendingFileRef.current, units, pendingArrayBufferRef.current);

      if (processedFile) {
        // Run mesh analysis
        setMeshProgress({ stage: 'analyzing', progress: 0, message: 'Analyzing mesh...' });
        const analysis = await analyzeMesh(processedFile.mesh.geometry, setMeshProgress);
        setMeshAnalysis(analysis);
        
        // Store the processed file for later use
        setPendingProcessedFile(processedFile);
        
        // If mesh has issues or needs decimation, show the optimization dialog
        if (analysis.issues.length > 0 || analysis.triangleCount > DECIMATION_THRESHOLD) {
          setIsProcessing(false);
          setIsOptimizationDialogOpen(true);
        } else {
          // Mesh is fine, proceed directly
          finalizeMeshImport(processedFile);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process file';
      setError(errorMessage);
      logger.error('Error processing file:', err);
      setIsProcessing(false);
    }
  }, [processFile, onFileLoaded, isInCollapsiblePanel, viewer]);

  // Finalize the mesh import (add to viewer and notify parent)
  const finalizeMeshImport = useCallback((processedFile: ProcessedFile) => {
    setCurrentFile(processedFile);
    onFileLoaded(processedFile);

    // Add mesh to viewer if not in collapsible panel
    if (!isInCollapsiblePanel && viewer.isReady) {
      viewer.addMesh(processedFile.mesh);
      viewer.resetView();
    }

    setIsProcessing(false);
    setIsOptimizationDialogOpen(false);
    setPendingProcessedFile(null);
    setMeshAnalysis(null);
    setMeshProgress(null);
  }, [onFileLoaded, isInCollapsiblePanel, viewer]);

  // Handle proceeding with original mesh (no optimization)
  const handleProceedWithOriginal = useCallback(async () => {
    if (!pendingProcessedFile) return;

    setIsMeshProcessing(true);
    
    try {
      // If there are issues, do a basic repair
      if (meshAnalysis && meshAnalysis.issues.length > 0 && !meshAnalysis.issues.every(i => i.includes('High triangle count'))) {
        setMeshProgress({ stage: 'repairing', progress: 0, message: 'Repairing mesh...' });
        const repairResult = await repairMesh(pendingProcessedFile.mesh.geometry, setMeshProgress);
        
        if (repairResult.success && repairResult.repairedGeometry) {
          // Create new mesh with repaired geometry
          const repairedMesh = new THREE.Mesh(
            repairResult.repairedGeometry,
            pendingProcessedFile.mesh.material
          );
          repairedMesh.castShadow = true;
          repairedMesh.receiveShadow = true;
          
          const updatedFile: ProcessedFile = {
            ...pendingProcessedFile,
            mesh: repairedMesh,
            metadata: {
              ...pendingProcessedFile.metadata,
              triangles: repairResult.triangleCount,
            },
          };
          
          finalizeMeshImport(updatedFile);
        } else {
          finalizeMeshImport(pendingProcessedFile);
        }
      } else {
        finalizeMeshImport(pendingProcessedFile);
      }
    } catch (err) {
      logger.error('Error during mesh repair:', err);
      finalizeMeshImport(pendingProcessedFile);
    } finally {
      setIsMeshProcessing(false);
    }
  }, [pendingProcessedFile, meshAnalysis, finalizeMeshImport]);

  // Handle mesh optimization (decimation)
  const handleOptimizeMesh = useCallback(async () => {
    if (!pendingProcessedFile) return;

    setIsMeshProcessing(true);
    
    try {
      // First repair if needed
      let currentGeometry = pendingProcessedFile.mesh.geometry;
      
      if (meshAnalysis && meshAnalysis.issues.length > 0 && !meshAnalysis.issues.every(i => i.includes('High triangle count'))) {
        setMeshProgress({ stage: 'repairing', progress: 0, message: 'Repairing mesh...' });
        const repairResult = await repairMesh(currentGeometry, setMeshProgress);
        
        if (repairResult.success && repairResult.repairedGeometry) {
          currentGeometry = repairResult.repairedGeometry;
        }
      }
      
      // Then decimate
      setMeshProgress({ stage: 'decimating', progress: 0, message: 'Decimating mesh...' });
      const decimationResult = await decimateMesh(currentGeometry, DECIMATION_TARGET, setMeshProgress);
      
      if (decimationResult.success && decimationResult.decimatedGeometry) {
        // Create new mesh with decimated geometry
        const decimatedMesh = new THREE.Mesh(
          decimationResult.decimatedGeometry,
          pendingProcessedFile.mesh.material
        );
        decimatedMesh.castShadow = true;
        decimatedMesh.receiveShadow = true;
        
        const updatedFile: ProcessedFile = {
          ...pendingProcessedFile,
          mesh: decimatedMesh,
          metadata: {
            ...pendingProcessedFile.metadata,
            triangles: decimationResult.finalTriangles,
          },
        };
        
        logger.info(`Mesh decimated: ${decimationResult.originalTriangles} -> ${decimationResult.finalTriangles} triangles (${decimationResult.reductionPercent.toFixed(1)}% reduction)`);
        
        finalizeMeshImport(updatedFile);
      } else {
        setError(decimationResult.error || 'Decimation failed');
        finalizeMeshImport(pendingProcessedFile);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to optimize mesh';
      setError(errorMessage);
      logger.error('Error during mesh optimization:', err);
      finalizeMeshImport(pendingProcessedFile);
    } finally {
      setIsMeshProcessing(false);
    }
  }, [pendingProcessedFile, meshAnalysis, finalizeMeshImport]);

  // Handle canceling mesh optimization
  const handleCancelOptimization = useCallback(() => {
    setIsOptimizationDialogOpen(false);
    setPendingProcessedFile(null);
    setMeshAnalysis(null);
    setMeshProgress(null);
    setIsProcessing(false);
  }, []);

  // Handle file reset
  const handleReset = useCallback(() => {
    setCurrentFile(null);
    setError(null);
    setIsProcessing(false);
    clearError();

    // Clear viewer if not in collapsible panel
    if (!isInCollapsiblePanel && viewer.isReady) {
      viewer.removeMesh();
      viewer.clearBaseplate();
      viewer.resetView();
    }

    onFileLoaded(null);
  }, [clearError, onFileLoaded, isInCollapsiblePanel, viewer]);

  // Listen for file picker events from app shell
  useEffect(() => {
    const handleFilePickerEvent = (e: CustomEvent) => {
      handleFileSelected(e.detail);
    };

    window.addEventListener('filepicker-selected', handleFilePickerEvent as EventListener);

    return () => {
      window.removeEventListener('filepicker-selected', handleFilePickerEvent as EventListener);
    };
  }, [handleFileSelected]);

  const hasContent = currentFile || isProcessing;

  return (
    <div className="h-full flex">
      {/* Left Panel - File Import UI (always shown when in collapsible panel) */}
      <div className={`${isInCollapsiblePanel ? 'w-full' : 'w-80'} border-r border-border/50 tech-glass flex flex-col`}>
        <div className="p-4 border-b border-border/50">
          <h2 className="font-tech font-semibold text-lg mb-1">File Import</h2>
          <p className="text-xs text-muted-foreground font-tech">
            Upload and view 3D models
          </p>
        </div>

        <div className="flex-1 p-4 space-y-4">
          {/* Error Display */}
          {error && (
            <Alert variant="destructive" className="font-tech">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {/* File Upload */}
          <FileDropzone
            onFileSelected={handleFileSelected}
            isProcessing={isProcessing}
            className="min-h-[200px]"
          />

          {/* Help Text */}
          {!hasContent && (
            <Card className="tech-glass">
              <div className="p-4 text-xs text-muted-foreground font-tech space-y-2">
                <p><strong>Getting Started:</strong></p>
                <ul className="space-y-1 ml-2 list-disc list-inside">
                  <li>Drag & drop STL files</li>
                  <li>Use mouse to orbit view</li>
                  <li>Scroll to zoom in/out</li>
                  <li>Try orientation presets in toolbar</li>
                </ul>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Right Panel - 3D Viewer (when not in collapsible panel) */}
      {!isInCollapsiblePanel && (
        <div className="flex-1 relative">
          <div
            ref={viewerContainerRef}
            className="absolute inset-0 w-full h-full"
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              position: 'relative'
            }}
          />

          {/* Debug info overlay */}
          <div className="absolute top-4 left-4 bg-black/50 text-white text-xs p-2 rounded z-50">
            <div>Viewer Ready: {viewer.isReady ? 'Yes' : 'No'}</div>
            <div>Container: {viewerContainerRef.current ? 'Available' : 'Not Available'}</div>
            <div>Processing: {isProcessing ? 'Yes' : 'No'}</div>
            <div>File: {currentFile?.metadata.name || 'None'}</div>
          </div>

          {/* Viewer Overlay Info */}
          {!hasContent && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center tech-glass p-6 rounded-lg border border-border/50">
                <h3 className="font-tech font-semibold text-lg mb-2">3D Viewer</h3>
                <p className="text-sm text-muted-foreground font-tech">
                  Upload a 3D model to start viewing
                </p>
              </div>
            </div>
          )}

          {/* Processing Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-background/20 backdrop-blur-sm flex items-center justify-center">
              <div className="tech-glass p-6 rounded-lg border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin-smooth" />
                  <span className="font-tech text-sm">Processing 3D model...</span>
                </div>
              </div>
            </div>
          )}

          {/* Loading Overlay */}
          <LoadingOverlay
            isOpen={loadingState.isLoading}
            type={loadingState.type || 'file-processing'}
            message={loadingState.message}
            progress={loadingState.progress}
            details={loadingState.details}
          />

          {/* Units Selection Dialog */}
          <UnitsDialog
            isOpen={isUnitsDialogOpen}
            onOpenChange={setIsUnitsDialogOpen}
            onUnitsSelect={handleUnitsSelected}
            fileName={pendingFileRef.current?.name || ''}
            fileSize={pendingFileRef.current ? `${(pendingFileRef.current.size / 1024 / 1024).toFixed(2)} MB` : ''}
          />
        </div>
      )}

      {/* Units Dialog (only when in collapsible panel) */}
      {isInCollapsiblePanel && (
        <UnitsDialog
          isOpen={isUnitsDialogOpen}
          onOpenChange={setIsUnitsDialogOpen}
          onUnitsSelect={handleUnitsSelected}
          fileName={pendingFileRef.current?.name || ''}
          fileSize={pendingFileRef.current ? `${(pendingFileRef.current.size / 1024 / 1024).toFixed(2)} MB` : ''}
        />
      )}

      {/* Mesh Optimization Dialog */}
      <MeshOptimizationDialog
        open={isOptimizationDialogOpen}
        onOpenChange={setIsOptimizationDialogOpen}
        analysis={meshAnalysis}
        progress={meshProgress}
        isProcessing={isMeshProcessing}
        onProceedWithOriginal={handleProceedWithOriginal}
        onOptimizeMesh={handleOptimizeMesh}
        onCancel={handleCancelOptimization}
      />
    </div>
  );
};

export default FileImport;
