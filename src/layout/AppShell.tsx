import React, { forwardRef, ReactNode, useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import ViewCube from "@/components/ViewCube";
import VerticalToolbar from "@/components/VerticalToolbar";
import ThreeDViewer from "@/components/3DViewer";
import BooleanOperationsPanel from "@/components/BooleanOperationsPanel";
import PartPropertiesAccordion from "@/components/PartPropertiesAccordion";
import ContextOptionsPanel, { WorkflowStep, WORKFLOW_STEPS } from "@/components/ContextOptionsPanel";
import {
  ImportStepContent,
  BaseplatesStepContent,
  SupportsStepContent,
  CavityStepContent,
  ClampsStepContent,
  LabelsStepContent,
  DrillStepContent,
  OptimizeStepContent,
  ExportStepContent
} from "@/components/ContextOptionsPanel/steps";
import { SupportType } from "@/components/ContextOptionsPanel/steps/SupportsStepContent";
import { AnySupport } from "@/components/Supports/types";
import UnitsDialog from "@/modules/FileImport/components/UnitsDialog";
import MeshOptimizationDialog from "@/modules/FileImport/components/MeshOptimizationDialog";
import { useFileProcessing } from "@/modules/FileImport/hooks/useFileProcessing";
import { ProcessedFile } from "@/modules/FileImport/types";
import {
  analyzeMesh,
  repairMesh,
  decimateMesh,
  MeshAnalysisResult,
  MeshProcessingProgress,
  DECIMATION_THRESHOLD,
  DECIMATION_TARGET,
} from "@/modules/FileImport/services/meshAnalysis";
import * as THREE from 'three';
import {
  Cpu,
  Upload,
  Settings,
  Eye,
  Ruler,
  Grid3X3,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Scale,
  GitMerge,
  Move,
  Undo2,
  Redo2,
  Wrench,
  Box,
  LogOut,
  Zap
} from "lucide-react";

// Small perspective cube icons matching the reference style
const IconIsoFace: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* top diamond */}
    <polygon points="12,4 19,8 12,12 5,8" fill="none" />
    {/* left face */}
    <polygon points="5,8 12,12 12,20 5,16" fill="none" />
    {/* right face (filled) */}
    <polygon points="19,8 12,12 12,20 19,16" fill="currentColor" />
    {/* edges */}
    <polyline points="5,8 12,12 19,8" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);

const IconIsoTop: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* top diamond (filled) */}
    <polygon points="12,4 19,8 12,12 5,8" fill="currentColor" />
    {/* side outlines */}
    <polygon points="5,8 12,12 12,20 5,16" fill="none" />
    <polygon points="19,8 12,12 12,20 19,16" fill="none" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);

const IconTopFace: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="12,6 18,10 12,14 6,10" fill="currentColor" />
    <polygon points="6,10 12,14 18,10 12,6 6,10" fill="none" />
  </svg>
);

// Left face filled variant
const IconIsoLeftFace: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="12,4 19,8 12,12 5,8" fill="none" />
    <polygon points="5,8 12,12 12,20 5,16" fill="currentColor" />
    <polygon points="19,8 12,12 12,20 19,16" fill="none" />
    <polyline points="5,8 12,12 19,8" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);

export interface AppShellHandle {
  openFilePicker: () => void;
  resetView: () => void;
  setViewOrientation: (orientation: string) => void;
}

interface AppShellProps {
  children: ReactNode;
  onLogout: () => void;
  onToggleDesignMode?: () => void;
  designMode?: boolean;
  isProcessing?: boolean;
  fileStats?: {
    name?: string;
    triangles?: number;
    size?: string;
  };
  currentFile?: ProcessedFile | null;
}

const AppShell = forwardRef<AppShellHandle, AppShellProps>(
  ({ children, onLogout, onToggleDesignMode, designMode = false, isProcessing: externalProcessing = false, fileStats, currentFile }, ref) => {
    // UI State
    const [isCavityOpen, setIsCavityOpen] = useState(false);
    const [isContextPanelCollapsed, setIsContextPanelCollapsed] = useState(false);
    const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);
    const [undoStack, setUndoStack] = useState<any[]>([]);
    const [redoStack, setRedoStack] = useState<any[]>([]);
    const [currentBaseplate, setCurrentBaseplate] = useState<{ id: string; type: string; padding?: number; height?: number } | null>(null);
    const [cavityBaseMesh, setCavityBaseMesh] = useState<any | null>(null);
    const [cavityTools, setCavityTools] = useState<any[]>([]);

    // Workflow State
    const [activeStep, setActiveStep] = useState<WorkflowStep>('import');
    const [completedSteps, setCompletedSteps] = useState<WorkflowStep[]>([]);

    // File Processing State (moved from FileImport)
    const [internalFile, setInternalFile] = useState<ProcessedFile | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const [isUnitsDialogOpen, setIsUnitsDialogOpen] = useState(false);
    const [isOptimizationDialogOpen, setIsOptimizationDialogOpen] = useState(false);
    const [meshAnalysis, setMeshAnalysis] = useState<MeshAnalysisResult | null>(null);
    const [meshProgress, setMeshProgress] = useState<MeshProcessingProgress | null>(null);
    const [isMeshProcessing, setIsMeshProcessing] = useState(false);
    const [pendingProcessedFile, setPendingProcessedFile] = useState<ProcessedFile | null>(null);

    const pendingFileRef = useRef<File | null>(null);
    const { processFile, error: fileProcessingError, clearError } = useFileProcessing();

    // Determine the actual file to use (prop or internal)
    const actualFile = currentFile || internalFile;
    const actualProcessing = externalProcessing || isProcessing;

    // Support placement state
    const [isPlacementMode, setIsPlacementMode] = useState(false);
    const [supports, setSupports] = useState<AnySupport[]>([]);
    const [selectedSupportType, setSelectedSupportType] = useState<SupportType>('cylindrical');
    const [selectedSupportId, setSelectedSupportId] = useState<string | null>(null);

    // Model colors state - tracks colors assigned to models in 3D scene
    const [modelColors, setModelColors] = useState<Map<string, string>>(new Map());

    // Cavity state
    const [cavityClearance, setCavityClearance] = useState(0.5);

    const handleOpenFilePicker = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.stl,.obj,.glb,.gltf';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          handleFileSelected(file);
        }
      };
      input.click();
    };

    // Handle file selection - show units dialog
    const handleFileSelected = useCallback((file: File) => {
      console.log('File selected:', file.name);
      pendingFileRef.current = file;
      setIsUnitsDialogOpen(true);
    }, []);

    // Handle units selection and process file
    const handleUnitsSelected = useCallback(async (units: string) => {
      if (!pendingFileRef.current) return;

      setIsUnitsDialogOpen(false);
      setIsProcessing(true);
      setFileError(null);

      try {
        const processedFile = await processFile(pendingFileRef.current, units);

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
        setFileError(errorMessage);
        console.error('Error processing file:', err);
        setIsProcessing(false);
      }
    }, [processFile]);

    // Finalize the mesh import
    const finalizeMeshImport = useCallback((processedFile: ProcessedFile) => {
      setInternalFile(processedFile);
      
      // Dispatch event for 3D viewer to pick up
      window.dispatchEvent(new CustomEvent('file-imported', { detail: processedFile }));

      setIsProcessing(false);
      setIsOptimizationDialogOpen(false);
      setPendingProcessedFile(null);
      setMeshAnalysis(null);
      setMeshProgress(null);

      // Mark import step as completed and auto-advance to baseplates
      if (!completedSteps.includes('import')) {
        setCompletedSteps(prev => [...prev, 'import']);
      }
    }, [completedSteps]);

    // Handle proceeding with original mesh (no optimization)
    const handleProceedWithOriginal = useCallback(async () => {
      if (!pendingProcessedFile) return;

      setIsMeshProcessing(true);
      
      try {
        if (meshAnalysis && meshAnalysis.issues.length > 0 && !meshAnalysis.issues.every(i => i.includes('High triangle count'))) {
          setMeshProgress({ stage: 'repairing', progress: 0, message: 'Repairing mesh...' });
          const repairResult = await repairMesh(pendingProcessedFile.mesh.geometry, setMeshProgress);
          
          if (repairResult.success && repairResult.repairedGeometry) {
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
        console.error('Error during mesh repair:', err);
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
        let currentGeometry = pendingProcessedFile.mesh.geometry;
        
        if (meshAnalysis && meshAnalysis.issues.length > 0 && !meshAnalysis.issues.every(i => i.includes('High triangle count'))) {
          setMeshProgress({ stage: 'repairing', progress: 0, message: 'Repairing mesh...' });
          const repairResult = await repairMesh(currentGeometry, setMeshProgress);
          
          if (repairResult.success && repairResult.repairedGeometry) {
            currentGeometry = repairResult.repairedGeometry;
          }
        }
        
        setMeshProgress({ stage: 'decimating', progress: 0, message: 'Decimating mesh...' });
        const decimationResult = await decimateMesh(currentGeometry, DECIMATION_TARGET, setMeshProgress);
        
        if (decimationResult.success && decimationResult.decimatedGeometry) {
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
          
          finalizeMeshImport(updatedFile);
        } else {
          setFileError(decimationResult.error || 'Decimation failed');
          finalizeMeshImport(pendingProcessedFile);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to optimize mesh';
        setFileError(errorMessage);
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

    // Clear file
    const handleClearFile = useCallback(() => {
      setInternalFile(null);
      setFileError(null);
      clearError();
      setCompletedSteps(prev => prev.filter(s => s !== 'import'));
      window.dispatchEvent(new CustomEvent('session-reset'));
    }, [clearError]);

    // Handle step change from context panel or toolbar
    const handleStepChange = useCallback((step: WorkflowStep) => {
      setActiveStep(step);
      
      // Close any open panels when changing steps
      setIsCavityOpen(false);
      
      // Cancel placement mode when leaving supports step
      if (step !== 'supports' && isPlacementMode) {
        setIsPlacementMode(false);
        window.dispatchEvent(new Event('supports-cancel-placement'));
      }
      
      // Trigger step-specific events
      switch (step) {
        case 'cavity':
          window.dispatchEvent(new CustomEvent('open-cavity-dialog'));
          setTimeout(() => window.dispatchEvent(new CustomEvent('request-cavity-context')), 0);
          break;
      }
    }, [isPlacementMode]);

    const handleResetSession = () => {
      // Reset all session state - like starting fresh
      setCurrentBaseplate(null);
      setUndoStack([]);
      setRedoStack([]);
      setCavityBaseMesh(null);
      setCavityTools([]);
      setIsCavityOpen(false);
      setInternalFile(null);
      setFileError(null);
      setActiveStep('import');
      setCompletedSteps([]);
      setSupports([]);
      setIsPlacementMode(false);
      setSelectedSupportId(null);
      
      // Dispatch events to reset the 3D scene and clear the file
      window.dispatchEvent(new CustomEvent('viewer-reset'));
      window.dispatchEvent(new CustomEvent('session-reset'));
      window.dispatchEvent(new Event('supports-cancel-placement'));
    };

    const handleSetOrientation = (orientation: string) => {
      const event = new CustomEvent('viewer-orientation', { detail: orientation });
      window.dispatchEvent(event);
    };

    const handleUndo = () => {
      if (undoStack.length > 0) {
        const lastState = undoStack[undoStack.length - 1];
        setRedoStack(prev => [lastState, ...prev]);
        setUndoStack(prev => prev.slice(0, -1));
        window.dispatchEvent(new CustomEvent('viewer-undo', { detail: lastState }));
      }
    };

    const handleRedo = () => {
      if (redoStack.length > 0) {
        const nextState = redoStack[0];
        setUndoStack(prev => [...prev, nextState]);
        setRedoStack(prev => prev.slice(1));
        window.dispatchEvent(new CustomEvent('viewer-redo', { detail: nextState }));
      }
    };

    const handleComponentPlaced = (component: any, position: any) => {
      const state = { component, position, timestamp: Date.now() };
      setUndoStack(prev => [...prev, state]);
      setRedoStack([]);
    };

    const handleBaseplateCreated = (e: CustomEvent) => {
      const { option, dimensions } = e.detail;
      const baseplateId = `baseplate-${Date.now()}`;
      setCurrentBaseplate({ 
        id: baseplateId, 
        type: option, 
        padding: dimensions?.padding || dimensions?.oversizeXY, 
        height: dimensions?.height 
      });
      // Mark baseplates step as completed
      if (!completedSteps.includes('baseplates')) {
        setCompletedSteps(prev => [...prev, 'baseplates']);
      }
      // Cancel any ongoing supports placement
      if (isPlacementMode) {
        setIsPlacementMode(false);
        window.dispatchEvent(new Event('supports-cancel-placement'));
      }
    };

    const handleBaseplateRemoved = (basePlateId: string) => {
      setCurrentBaseplate(null);
      setCompletedSteps(prev => prev.filter(s => s !== 'baseplates'));
      window.dispatchEvent(new CustomEvent('remove-baseplate', { detail: { basePlateId } }));
    };

    // Handle tool selection - now also updates active step
    const handleToolSelect = (toolId: string) => {
      // Update the active step in the context panel
      if (['import', 'baseplates', 'supports', 'cavity', 'clamps', 'labels', 'drill', 'optimize', 'export'].includes(toolId)) {
        setActiveStep(toolId as WorkflowStep);
      }

      // Cancel placement mode when leaving supports
      if (toolId !== 'supports' && isPlacementMode) {
        setIsPlacementMode(false);
        window.dispatchEvent(new Event('supports-cancel-placement'));
      }

      switch (toolId) {
        case 'import':
          // Just switch to import step, don't open file picker automatically
          return;
        case 'baseplates':
          return;
        case 'supports':
          // Supports is now handled by context panel, no floating dialog needed
          return;
        case 'cavity':
          window.dispatchEvent(new CustomEvent('open-cavity-dialog'));
          // ask scene to provide current meshes for cavity
          setTimeout(() => window.dispatchEvent(new CustomEvent('request-cavity-context')), 0);
          return;
        case 'clamps':
          window.dispatchEvent(new CustomEvent('open-clamps-dialog'));
          return;
        case 'labels':
          window.dispatchEvent(new CustomEvent('open-labels-dialog'));
          return;
        case 'drill':
          window.dispatchEvent(new CustomEvent('open-drill-dialog'));
          return;
        case 'optimize':
          window.dispatchEvent(new CustomEvent('optimize-material'));
          return;
        case 'export':
          window.dispatchEvent(new CustomEvent('open-export-dialog'));
          return;
        default:
          console.log('Unhandled tool:', toolId);
      }
    };

    // Listen for base plate events
    React.useEffect(() => {
      window.addEventListener('create-baseplate', handleBaseplateCreated as EventListener);
      return () => window.removeEventListener('create-baseplate', handleBaseplateCreated as EventListener);
    }, []);

    // Listen for supports dialog open event - no longer needed as we use context panel
    // Remove floating panel, placement mode is controlled via context panel

    // Listen for cavity (boolean ops) open event
    React.useEffect(() => {
      const onOpenCavity = () => setIsCavityOpen(true);
      window.addEventListener('open-cavity-dialog', onOpenCavity as EventListener);
      return () => window.removeEventListener('open-cavity-dialog', onOpenCavity as EventListener);
    }, []);

    // Listen for cavity context from scene
    React.useEffect(() => {
      const onCavityContext = (e: CustomEvent) => {
        const { baseMesh, fixtureComponents } = e.detail || {};
        setCavityBaseMesh(baseMesh || null);
        setCavityTools(Array.isArray(fixtureComponents) ? fixtureComponents : []);
      };
      window.addEventListener('cavity-context', onCavityContext as EventListener);
      return () => window.removeEventListener('cavity-context', onCavityContext as EventListener);
    }, []);

    // Sync supports from 3D scene - listen for support-created and support-updated events
    React.useEffect(() => {
      const onSupportCreated = (e: CustomEvent) => {
        const support = e.detail as AnySupport;
        setSupports(prev => {
          // Check if it's an update (existing ID)
          const existingIndex = prev.findIndex(s => s.id === support.id);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = support;
            return updated;
          }
          return [...prev, support];
        });
        
        // Record to undo stack
        const state = { type: 'support-created', support };
        setUndoStack(prev => [...prev, state]);
        setRedoStack([]);
        
        // Exit placement mode after creating a support (so user can create another by clicking a type)
        setIsPlacementMode(false);
      };

      const onSupportUpdated = (e: CustomEvent) => {
        const support = e.detail as AnySupport;
        setSupports(prev => prev.map(s => s.id === support.id ? support : s));
      };

      const onSupportDelete = (e: CustomEvent) => {
        const supportId = e.detail as string;
        setSupports(prev => prev.filter(s => s.id !== supportId));
        if (selectedSupportId === supportId) {
          setSelectedSupportId(null);
        }
      };

      const onSupportsClearAll = () => {
        setSupports([]);
        setSelectedSupportId(null);
      };

      const onCancelPlacement = () => {
        setIsPlacementMode(false);
      };

      window.addEventListener('support-created', onSupportCreated as EventListener);
      window.addEventListener('support-updated', onSupportUpdated as EventListener);
      window.addEventListener('support-delete', onSupportDelete as EventListener);
      window.addEventListener('supports-clear-all', onSupportsClearAll);
      window.addEventListener('supports-cancel-placement', onCancelPlacement);

      return () => {
        window.removeEventListener('support-created', onSupportCreated as EventListener);
        window.removeEventListener('support-updated', onSupportUpdated as EventListener);
        window.removeEventListener('support-delete', onSupportDelete as EventListener);
        window.removeEventListener('supports-clear-all', onSupportsClearAll);
        window.removeEventListener('supports-cancel-placement', onCancelPlacement);
      };
    }, [selectedSupportId]);

    // Handle support update from properties panel
    const handleSupportUpdate = useCallback((support: AnySupport) => {
      setSupports(prev => prev.map(s => s.id === support.id ? support : s));
      // Dispatch to 3D scene
      window.dispatchEvent(new CustomEvent('support-updated', { detail: support }));
    }, []);

    // Handle support delete from properties panel
    const handleSupportDelete = useCallback((id: string) => {
      setSupports(prev => prev.filter(s => s.id !== id));
      if (selectedSupportId === id) {
        setSelectedSupportId(null);
      }
      // Dispatch to 3D scene
      window.dispatchEvent(new CustomEvent('support-delete', { detail: id }));
    }, [selectedSupportId]);

    // Expose methods via ref
    React.useImperativeHandle(ref, () => ({
      openFilePicker: handleOpenFilePicker,
      resetView: handleResetSession,
      setViewOrientation: handleSetOrientation,
    }));


    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-border/50 tech-glass flex items-center justify-between px-4 z-50">
          {/* Left Section - Logo & File Actions */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-primary" />
              </div>
              <span className="font-tech font-semibold text-sm">FixtureMate</span>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetSession}
                className="tech-transition"
                disabled={actualProcessing}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset
              </Button>

              <Separator orientation="vertical" className="h-6" />

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndo}
                  className="tech-transition px-2"
                  disabled={undoStack.length === 0}
                  title="Undo"
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRedo}
                  className="tech-transition px-2"
                  disabled={redoStack.length === 0}
                  title="Redo"
                >
                  <Redo2 className="w-4 h-4" />
                </Button>
              </div>

              <Separator orientation="vertical" className="h-6" />

              {/* Transform is now via double-click on model - no toolbar button needed */}
            </div>
          </div>

          {/* Center Section - File Info */}
          <div className="flex items-center gap-4">
            {(fileStats?.name || actualFile?.metadata?.name) && (
              <div className="flex items-center gap-3 text-xs font-tech">
                <div className="flex items-center gap-1">
                  <Box className="w-3 h-3 text-muted-foreground" />
                  <span className="text-foreground">{fileStats?.name || actualFile?.metadata?.name}</span>
                </div>
                {(fileStats?.triangles || actualFile?.metadata?.triangles) && (
                  <Badge variant="secondary" className="font-tech text-xs">
                    {(fileStats?.triangles || actualFile?.metadata?.triangles)?.toLocaleString()} tri
                  </Badge>
                )}
                {(fileStats?.size || actualFile?.metadata?.dimensions) && (
                  <span className="text-muted-foreground">
                    {fileStats?.size || 
                      `${actualFile?.metadata?.dimensions?.x.toFixed(1)}×${actualFile?.metadata?.dimensions?.y.toFixed(1)}×${actualFile?.metadata?.dimensions?.z.toFixed(1)} ${actualFile?.metadata?.units || ''}`}
                  </span>
                )}
              </div>
            )}

            {actualProcessing && (
              <div className="flex items-center gap-2 text-xs font-tech text-primary">
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin-smooth" />
                <span className="text-primary">Processing...</span>
              </div>
            )}
          </div>

          {/* Right Section - View Controls & User */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('front')}
                className="tech-transition px-2"
                disabled={actualProcessing}
                title="Front View"
              >
                <IconIsoFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('back')}
                className="tech-transition px-2"
                disabled={actualProcessing}
                title="Back View"
              >
                <IconIsoFace className="w-4 h-4 rotate-180" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('left')}
                className="tech-transition px-2"
                disabled={actualProcessing}
                title="Left View"
              >
                <IconIsoLeftFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('right')}
                className="tech-transition px-2"
                disabled={actualProcessing}
                title="Right View"
              >
                <IconIsoFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('top')}
                className="tech-transition px-2"
                disabled={actualProcessing}
                title="Top View"
              >
                <IconTopFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('iso')}
                className="tech-transition px-2"
                disabled={actualProcessing}
                title="Isometric View"
              >
                <IconIsoTop className="w-4 h-4" />
              </Button>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={onLogout}
                className="tech-transition text-destructive hover:text-destructive"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Static Vertical Toolbar */}
          <aside className="w-14 flex-shrink-0 border-r border-border/50 tech-glass flex flex-col justify-center">
            <VerticalToolbar onToolSelect={handleToolSelect} activeTool={activeStep} />
          </aside>

          {/* Collapsible Context Options Panel */}
          <aside 
            className="border-r border-border/50 tech-glass flex flex-col overflow-hidden flex-shrink-0"
            style={{ 
              width: isContextPanelCollapsed ? 48 : 320,
              transition: 'width 300ms ease-in-out'
            }}
          >
            <div className="p-2 border-b border-border/50 flex items-center justify-between flex-shrink-0">
              {!isContextPanelCollapsed && (
                <h3 className="font-tech font-semibold text-sm whitespace-nowrap">Context Options</h3>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = !isContextPanelCollapsed;
                  setIsContextPanelCollapsed(next);
                  setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    window.dispatchEvent(new CustomEvent('viewer-resize'));
                  }, 320);
                }}
                className={`w-8 h-8 p-0 tech-transition hover:bg-primary/10 hover:text-primary flex-shrink-0 ${isContextPanelCollapsed ? 'mx-auto' : ''}`}
                title={isContextPanelCollapsed ? 'Expand Panel' : 'Collapse Panel'}
              >
                {isContextPanelCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            </div>

            {!isContextPanelCollapsed && (
              <div className="flex-1 overflow-hidden">
                <ContextOptionsPanel
                  currentFile={actualFile}
                  activeStep={activeStep}
                  onStepChange={handleStepChange}
                  completedSteps={completedSteps}
                  isProcessing={actualProcessing}
                >
                  {/* Render step-specific content */}
                  {activeStep === 'import' && (
                    <ImportStepContent
                      currentFile={actualFile}
                      isProcessing={actualProcessing}
                      error={fileError}
                      onFileSelected={handleFileSelected}
                    />
                  )}
                  {activeStep === 'baseplates' && (
                    <BaseplatesStepContent
                      hasWorkpiece={!!actualFile}
                      currentBaseplate={currentBaseplate}
                      onSelectBaseplate={(type, options) => {
                        window.dispatchEvent(new CustomEvent('create-baseplate', {
                          detail: { 
                            type: 'baseplate',
                            option: type,
                            dimensions: {
                              padding: options.padding,
                              height: options.height,
                              oversizeXY: options.padding // For convex-hull
                            }
                          }
                        }));
                      }}
                      onRemoveBaseplate={() => currentBaseplate && handleBaseplateRemoved(currentBaseplate.id)}
                    />
                  )}
                  {activeStep === 'supports' && (
                    <SupportsStepContent
                      hasBaseplate={!!currentBaseplate}
                      supportsCount={supports.length}
                      isPlacementMode={isPlacementMode}
                      onStartPlacement={(type) => {
                        setSelectedSupportType(type);
                        setIsPlacementMode(true);
                      }}
                      onCancelPlacement={() => {
                        setIsPlacementMode(false);
                      }}
                      selectedSupportType={selectedSupportType}
                      onSupportTypeChange={setSelectedSupportType}
                    />
                  )}
                  {activeStep === 'cavity' && (
                    <CavityStepContent
                      hasWorkpiece={!!actualFile}
                      hasBaseplate={!!currentBaseplate}
                      clearance={cavityClearance}
                      onClearanceChange={setCavityClearance}
                      onExecuteSubtract={() => {
                        window.dispatchEvent(new CustomEvent('cavity-execute', { detail: { clearance: cavityClearance } }));
                      }}
                      onPreview={() => {
                        window.dispatchEvent(new CustomEvent('cavity-preview', { detail: { clearance: cavityClearance } }));
                      }}
                    />
                  )}
                  {activeStep === 'clamps' && (
                    <ClampsStepContent
                      hasWorkpiece={!!actualFile}
                    />
                  )}
                  {activeStep === 'labels' && (
                    <LabelsStepContent
                      hasWorkpiece={!!actualFile || !!currentBaseplate}
                    />
                  )}
                  {activeStep === 'drill' && (
                    <DrillStepContent
                      hasWorkpiece={!!actualFile || !!currentBaseplate}
                    />
                  )}
                  {activeStep === 'optimize' && (
                    <OptimizeStepContent
                      hasFixture={!!currentBaseplate}
                    />
                  )}
                  {activeStep === 'export' && (
                    <ExportStepContent
                      hasFixture={!!actualFile || !!currentBaseplate}
                    />
                  )}
                </ContextOptionsPanel>
              </div>
            )}
          </aside>

          {/* Main Viewport - this is the only flex element */}
          <main className="flex-1 relative min-w-0">
            <ThreeDViewer
              currentFile={actualFile}
              isProcessing={actualProcessing}
              onComponentPlaced={handleComponentPlaced}
              onModelColorAssigned={(modelId, color) => {
                setModelColors(prev => {
                  const newMap = new Map(prev);
                  newMap.set(modelId, color);
                  return newMap;
                });
              }}
            />

            {/* Floating Tips Overlay */}
            {(() => {
              const currentStepConfig = WORKFLOW_STEPS.find(s => s.id === activeStep);
              return currentStepConfig?.helpText?.length ? (
                <div className="absolute top-4 left-4 z-10 max-w-xs">
                  <div className="tech-glass rounded-lg p-3 text-xs text-muted-foreground font-tech space-y-1.5 bg-background/80 backdrop-blur-sm border border-border/50 shadow-lg">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <span>💡</span> Tips
                    </p>
                    <ul className="space-y-1 ml-1">
                      {currentStepConfig.helpText.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null;
            })()}

            {/* ViewCube temporarily disabled
            <div className="absolute top-4 right-4 z-10">
              <ViewCube
                onViewChange={handleSetOrientation}
                className=""
                size={150}
              />
            </div>
            */}

            {/* Cavity panel moved under Properties pane */}
          </main>

          {/* Right Properties Panel - Fixed to right side */}
          <aside 
            className="border-l border-border/50 tech-glass flex flex-col overflow-hidden flex-shrink-0"
            style={{ 
              width: isPropertiesCollapsed ? 48 : 280,
              transition: 'width 300ms ease-in-out'
            }}
          >
            <div className="p-2 border-b border-border/50 flex items-center justify-between flex-shrink-0">
              {!isPropertiesCollapsed && (
                <h3 className="font-tech font-semibold text-sm whitespace-nowrap">Properties</h3>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = !isPropertiesCollapsed;
                  setIsPropertiesCollapsed(next);
                  setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    window.dispatchEvent(new CustomEvent('viewer-resize'));
                  }, 320);
                }}
                className={`w-8 h-8 p-0 tech-transition hover:bg-primary/10 hover:text-primary flex-shrink-0 ${isPropertiesCollapsed ? 'mx-auto' : ''}`}
                title={isPropertiesCollapsed ? 'Expand Properties' : 'Collapse Properties'}
              >
                {isPropertiesCollapsed ? (
                  <ChevronLeft className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </Button>
            </div>

            {!isPropertiesCollapsed && (
              <div className="p-4 flex-1 overflow-auto">
                {/* Part Properties Accordion - File Details, Transform controls, and Supports */}
                <PartPropertiesAccordion 
                  hasModel={!!actualFile} 
                  currentFile={actualFile}
                  onClearFile={handleClearFile}
                  supports={supports}
                  selectedSupportId={selectedSupportId}
                  onSupportSelect={setSelectedSupportId}
                  onSupportUpdate={handleSupportUpdate}
                  onSupportDelete={handleSupportDelete}
                  modelColor={actualFile ? modelColors.get(actualFile.metadata.name) : undefined}
                />

                {/* Subtract Workpieces panel anchored here */}
                {isCavityOpen && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-tech text-sm font-semibold">Subtract Workpieces</div>
                      <Button size="sm" variant="ghost" onClick={() => setIsCavityOpen(false)} className="w-8 h-8 p-0">×</Button>
                    </div>
                    <BooleanOperationsPanel
                      baseMesh={cavityBaseMesh}
                      fixtureComponents={cavityTools}
                      onOperationComplete={(mesh:any) => {
                        // Forward to scene as preview/apply result
                        window.dispatchEvent(new CustomEvent('cavity-operation-result', { detail: { mesh, mode: 'preview' } }));
                      }}
                      onNegativeCreate={() => { /* history UI already in panel */ }}
                    />
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>

        {/* Status Bar */}
        <footer className="h-6 border-t border-border/50 tech-glass flex items-center justify-between px-4 text-xs font-tech text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>Ready</span>
            <span>•</span>
            <span>WebGL 2.0</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3" />
            <span>Powered by Three.js</span>
          </div>
        </footer>

        {/* Units Selection Dialog */}
        <UnitsDialog
          isOpen={isUnitsDialogOpen}
          onOpenChange={setIsUnitsDialogOpen}
          onUnitsSelect={handleUnitsSelected}
          fileName={pendingFileRef.current?.name || ''}
          fileSize={pendingFileRef.current ? `${(pendingFileRef.current.size / 1024 / 1024).toFixed(2)} MB` : ''}
        />

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
  }
);

AppShell.displayName = "AppShell";

export default AppShell;
