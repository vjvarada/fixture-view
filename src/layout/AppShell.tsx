import React, { forwardRef, ReactNode, useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ViewCube } from "@rapidtool/cad-ui";
import VerticalToolbar from "@/components/VerticalToolbar";
import ThreeDViewer from "@/components/3DViewer";
import { logMemoryUsage } from "@/utils/memoryMonitor";
import { terminateWorkers } from "@rapidtool/cad-core";

// Selection hooks (Phase 7a migration)
import {
  useSelectedPart,
  useSelectedSupport,
  useSelectedClamp,
  useSelectedLabel,
  useSelectedHole,
  useSelectedBaseplateSection,
  useClearSelection,
} from "@/hooks/useSelection";

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
  ExportStepContent
} from "@/components/ContextOptionsPanel/steps";
import { SupportType } from "@/components/ContextOptionsPanel/steps/SupportsStepContent";
import { AnySupport, autoPlaceSupports, AutoPlacementStrategy } from "@/features/supports";
import { PlacedClamp } from "@/features/clamps";
import { PlacedHole, HoleConfig } from "@/features/holes";
import { BasePlateSection } from "@/features/baseplate";
import { CavitySettings, DEFAULT_CAVITY_SETTINGS, getAdaptivePixelsPerUnit, type ExportConfig } from "@rapidtool/cad-core";
import UnitsDialog from "@/modules/FileImport/components/UnitsDialog";
import MeshOptimizationDialog from "@/modules/FileImport/components/MeshOptimizationDialog";
import { useFileProcessing } from "@/modules/FileImport/hooks/useFileProcessing";
import { LARGE_FILE_THRESHOLD } from "@/modules/FileImport/hooks/useFileProcessing";
import { ProcessedFile } from "@/modules/FileImport/types";
import {
  analyzeMesh,
  repairMesh,
  decimateMesh,
  repairAndDecimateMesh,
  initManifoldMeshService as initManifold,
  type MeshAnalysisResult,
  type MeshProcessingProgress,
  DECIMATION_TARGET,
} from "@rapidtool/cad-core";

// UI threshold for showing optimization dialog (500k triangles)
// This is higher than the actual decimation threshold to avoid unnecessary dialogs
const OPTIMIZATION_DIALOG_THRESHOLD = 500_000;
import * as THREE from 'three';
import {
  Aperture,
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
  Pin,
  Box,
  LogOut,
  Zap
} from "lucide-react";
import { IconIsoFace, IconIsoTop, IconTopFace, IconIsoLeftFace } from "@/components/icons";

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
    const [isContextPanelCollapsed, setIsContextPanelCollapsed] = useState(false);
    const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);
    const [undoStack, setUndoStack] = useState<any[]>([]);
    const [redoStack, setRedoStack] = useState<any[]>([]);
    const [currentBaseplate, setCurrentBaseplate] = useState<{ id: string; type: string; padding?: number; height?: number; depth?: number; sections?: Array<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }> } | null>(null);
    
    // Selection state (Phase 7a - now from Zustand store)
    const [selectedBasePlateSectionId, setSelectedBasePlateSectionId] = useSelectedBaseplateSection();
    const clearSelection = useClearSelection();

    // Multi-section baseplate drawing state
    const [isBaseplateDrawingMode, setIsBaseplateDrawingMode] = useState(false);
    const [drawnBaseplateSections, setDrawnBaseplateSections] = useState<Array<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }>>([]);
    const [currentBaseplateParams, setCurrentBaseplateParams] = useState<{ padding: number; height: number }>({ padding: 5, height: 4 });

    // Workflow State
    const [activeStep, setActiveStep] = useState<WorkflowStep>('import');
    const [completedSteps, setCompletedSteps] = useState<WorkflowStep[]>([]);
    const [skippedSteps, setSkippedSteps] = useState<WorkflowStep[]>([]);

    // File Processing State (moved from FileImport)
    const [importedParts, setImportedParts] = useState<ProcessedFile[]>([]);
    // Selection: Part (Phase 7a - now from Zustand store)
    const [selectedPartId, setSelectedPartId] = useSelectedPart();
    const [partVisibility, setPartVisibility] = useState<Map<string, boolean>>(new Map());
    const [baseplateVisible, setBaseplateVisible] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const [isUnitsDialogOpen, setIsUnitsDialogOpen] = useState(false);
    const [isOptimizationDialogOpen, setIsOptimizationDialogOpen] = useState(false);
    const [meshAnalysis, setMeshAnalysis] = useState<MeshAnalysisResult | null>(null);
    const [meshProgress, setMeshProgress] = useState<MeshProcessingProgress | null>(null);
    const [isMeshProcessing, setIsMeshProcessing] = useState(false);
    const [pendingProcessedFile, setPendingProcessedFile] = useState<ProcessedFile | null>(null);
    const [pendingFileSize, setPendingFileSize] = useState<number | undefined>(undefined);
    
    // Processing results state - shown after repair/optimization completes
    const [processingResult, setProcessingResult] = useState<{
      success: boolean;
      wasRepaired: boolean;
      wasDecimated: boolean;
      originalTriangles: number;
      finalTriangles: number;
      reductionPercent: number;
      actions: string[];
      error?: string;
      processedFile?: ProcessedFile;
    } | null>(null);

    const pendingFileRef = useRef<File | null>(null);
    const { processFile, error: fileProcessingError, clearError } = useFileProcessing();

    // Initialize Manifold3D module early
    useEffect(() => {
      initManifold().then(success => {
        if (success) {
          console.log('[AppShell] Manifold3D pre-initialized');
        }
      });
    }, []);

    // Determine the actual file to use (first imported part for backward compatibility)
    const actualFile = currentFile || (importedParts.length > 0 ? importedParts[0] : null);
    const actualProcessing = externalProcessing || isProcessing;

    // Support placement state
    const [isPlacementMode, setIsPlacementMode] = useState(false);
    const [supports, setSupports] = useState<AnySupport[]>([]);
    const [selectedSupportType, setSelectedSupportType] = useState<SupportType>('cylindrical');
    // Selection: Support (Phase 7a - now from Zustand store)
    const [selectedSupportId, setSelectedSupportId] = useSelectedSupport();

    // Labels state
    const [labels, setLabels] = useState<Array<{
      id: string;
      text: string;
      fontSize: number;
      depth: number;
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
    }>>([]);
    // Selection: Label (Phase 7a - now from Zustand store)
    const [selectedLabelId, setSelectedLabelId] = useSelectedLabel();

    // Clamps state
    const [clamps, setClamps] = useState<PlacedClamp[]>([]);
    // Selection: Clamp (Phase 7a - now from Zustand store)
    const [selectedClampId, setSelectedClampId] = useSelectedClamp();

    // Mounting holes state
    const [mountingHoles, setMountingHoles] = useState<PlacedHole[]>([]);
    // Selection: Hole (Phase 7a - now from Zustand store)
    const [selectedHoleId, setSelectedHoleId] = useSelectedHole();
    const [isHolePlacementMode, setIsHolePlacementMode] = useState(false);
    const [pendingHoleConfig, setPendingHoleConfig] = useState<HoleConfig | null>(null);

    // Model colors state - tracks colors assigned to models in 3D scene
    const [modelColors, setModelColors] = useState<Map<string, string>>(new Map());

    // Cavity state
    const [cavityClearance, setCavityClearance] = useState(0.5);
    const [cavitySettings, setCavitySettings] = useState<CavitySettings>(DEFAULT_CAVITY_SETTINGS);
    const [isCavityProcessing, setIsCavityProcessing] = useState(false);
    const [isApplyingCavity, setIsApplyingCavity] = useState(false);
    const [hasCavityPreview, setHasCavityPreview] = useState(false);
    const [isCavityApplied, setIsCavityApplied] = useState(false);

    // Cavity settings handlers
    const handleCavitySettingsChange = useCallback((settings: CavitySettings) => {
      setCavitySettings(settings);
    }, []);

    const handleGenerateCavityPreview = useCallback(() => {
      setIsCavityProcessing(true);
      window.dispatchEvent(new CustomEvent('generate-offset-mesh-preview', { 
        detail: { settings: cavitySettings } 
      }));
      // Processing state will be cleared by the 3DScene when complete
      // We'll listen for the completion event
      const handleComplete = () => {
        setIsCavityProcessing(false);
        setHasCavityPreview(true);
        window.removeEventListener('offset-mesh-preview-complete', handleComplete);
      };
      window.addEventListener('offset-mesh-preview-complete', handleComplete);
      // Timeout fallback in case the event doesn't fire
      setTimeout(() => setIsCavityProcessing(false), 30000);
    }, [cavitySettings]);

    const handleClearCavityPreview = useCallback(() => {
      window.dispatchEvent(new CustomEvent('clear-offset-mesh-preview'));
      setHasCavityPreview(false);
    }, []);

    const handleExecuteCavity = useCallback(() => {
      setIsCavityProcessing(true);
      setIsApplyingCavity(true);
      window.dispatchEvent(new CustomEvent('execute-cavity-subtraction', { 
        detail: { settings: cavitySettings } 
      }));
      // Listen for completion
      const handleComplete = () => {
        setIsCavityProcessing(false);
        setIsApplyingCavity(false);
        setHasCavityPreview(false);
        setIsCavityApplied(true);
        window.removeEventListener('cavity-subtraction-complete', handleComplete);
      };
      window.addEventListener('cavity-subtraction-complete', handleComplete);
      setTimeout(() => {
        setIsCavityProcessing(false);
        setIsApplyingCavity(false);
      }, 60000);
    }, [cavitySettings]);

    const handleResetCavity = useCallback(() => {
      setIsCavityApplied(false);
      setHasCavityPreview(false);
      window.dispatchEvent(new CustomEvent('reset-cavity'));
    }, []);

    // ─────────────────────────────────────────────────────────────────────────
    // Export Handlers
    // ─────────────────────────────────────────────────────────────────────────

    const [isExporting, setIsExporting] = useState(false);

    const handleExport = useCallback((config: ExportConfig) => {
      setIsExporting(true);
      // Dispatch export event to 3DScene which has the merged fixture mesh
      window.dispatchEvent(new CustomEvent('export-fixture', { detail: { config } }));
      
      // Listen for export completion
      const handleExportComplete = (e: CustomEvent) => {
        setIsExporting(false);
        window.removeEventListener('export-complete', handleExportComplete as EventListener);
      };
      window.addEventListener('export-complete', handleExportComplete as EventListener);
      
      // Timeout fallback
      setTimeout(() => {
        setIsExporting(false);
      }, 30000);
    }, []);

    // ─────────────────────────────────────────────────────────────────────────
    // Mounting Holes Handlers
    // ─────────────────────────────────────────────────────────────────────────

    const handleStartHolePlacement = useCallback((config: HoleConfig) => {
      setPendingHoleConfig(config);
      setIsHolePlacementMode(true);
      // Dispatch event to 3D scene to start placement mode
      // Use depth (thickness in Y) not height (length in Z)
      window.dispatchEvent(new CustomEvent('hole-start-placement', { 
        detail: { config, depth: currentBaseplate?.depth ?? 20 } 
      }));
    }, [currentBaseplate?.depth]);

    const handleCancelHolePlacement = useCallback(() => {
      setPendingHoleConfig(null);
      setIsHolePlacementMode(false);
      window.dispatchEvent(new CustomEvent('hole-cancel-placement'));
    }, []);

    const handleHolePlaced = useCallback((hole: PlacedHole) => {
      setMountingHoles(prev => [...prev, hole]);
      setPendingHoleConfig(null);
      setIsHolePlacementMode(false);
      
      // Mark drill step as completed if not already
      if (!completedSteps.includes('drill')) {
        setCompletedSteps(prev => [...prev, 'drill']);
      }
    }, [completedSteps]);

    const handleHoleUpdate = useCallback((updatedHole: PlacedHole) => {
      setMountingHoles(prev => prev.map(h => h.id === updatedHole.id ? updatedHole : h));
    }, []);

    const handleHoleDelete = useCallback((holeId: string) => {
      setMountingHoles(prev => prev.filter(h => h.id !== holeId));
      if (selectedHoleId === holeId) {
        setSelectedHoleId(null);
      }
      
      // If no holes left, remove drill from completed steps
      setMountingHoles(currentHoles => {
        if (currentHoles.length === 0) {
          setCompletedSteps(prev => prev.filter(s => s !== 'drill'));
        }
        return currentHoles;
      });
    }, [selectedHoleId]);

    // Listen for hole placement events from 3D scene
    useEffect(() => {
      const handleHoleCreated = (e: CustomEvent<PlacedHole>) => {
        handleHolePlaced(e.detail);
      };
      
      const handlePlacementCancelled = () => {
        setPendingHoleConfig(null);
        setIsHolePlacementMode(false);
      };

      const handleHoleSelectRequest = (e: CustomEvent<string>) => {
        setSelectedHoleId(e.detail);
      };

      // Handle hole updates from 3D scene transform controls
      const handleHoleUpdatedFrom3D = (e: CustomEvent<PlacedHole>) => {
        handleHoleUpdate(e.detail);
      };
      
      window.addEventListener('hole-placed', handleHoleCreated as EventListener);
      window.addEventListener('hole-placement-cancelled', handlePlacementCancelled);
      window.addEventListener('hole-select-request', handleHoleSelectRequest as EventListener);
      window.addEventListener('hole-updated', handleHoleUpdatedFrom3D as EventListener);
      
      return () => {
        window.removeEventListener('hole-placed', handleHoleCreated as EventListener);
        window.removeEventListener('hole-placement-cancelled', handlePlacementCancelled);
        window.removeEventListener('hole-select-request', handleHoleSelectRequest as EventListener);
        window.removeEventListener('hole-updated', handleHoleUpdatedFrom3D as EventListener);
      };
    }, [handleHolePlaced, handleHoleUpdate]);

    // Sync mounting holes with 3DScene
    useEffect(() => {
      window.dispatchEvent(new CustomEvent('holes-updated', { detail: mountingHoles }));
    }, [mountingHoles]);

    // Sync selected hole ID with 3DScene
    useEffect(() => {
      window.dispatchEvent(new CustomEvent('hole-selected', { detail: selectedHoleId }));
    }, [selectedHoleId]);

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
      console.log('File selected:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
      pendingFileRef.current = file;
      setPendingFileSize(file.size);
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
          
          // Check if file is large (>5MB) - should be decimated for performance
          const isLargeFile = pendingFileRef.current && pendingFileRef.current.size > LARGE_FILE_THRESHOLD;
          
          // If mesh has issues, needs decimation, or is a large file, show the optimization dialog
          if (analysis.issues.length > 0 || analysis.triangleCount > OPTIMIZATION_DIALOG_THRESHOLD || isLargeFile) {
            setIsProcessing(false);
            setIsOptimizationDialogOpen(true);
            
            if (isLargeFile) {
              console.log(`[Mesh Import] Large file detected (${(pendingFileRef.current!.size / 1024 / 1024).toFixed(2)} MB) - optimization recommended`);
            }
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

    // Finalize the mesh import - add part to array
    const finalizeMeshImport = useCallback((processedFile: ProcessedFile) => {
      // Add to imported parts array
      setImportedParts(prev => [...prev, processedFile]);
      
      // Select the newly imported part
      setSelectedPartId(processedFile.id);
      
      // Calculate part diagonal and set adaptive pixels per unit for cavity settings
      if (processedFile.mesh?.geometry) {
        processedFile.mesh.geometry.computeBoundingBox();
        const box = processedFile.mesh.geometry.boundingBox;
        if (box) {
          const size = box.getSize(new THREE.Vector3());
          const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
          const adaptivePPU = getAdaptivePixelsPerUnit(diagonal);
          
          console.log(`[AppShell] Part diagonal: ${diagonal.toFixed(1)}mm, adaptive px/mm: ${adaptivePPU}`);
          
          // Update cavity settings with adaptive resolution
          setCavitySettings(prev => ({
            ...prev,
            pixelsPerUnit: adaptivePPU
          }));
        }
      }
      
      // Dispatch event for 3D viewer to pick up (with all parts)
      window.dispatchEvent(new CustomEvent('part-imported', { detail: processedFile }));

      setIsProcessing(false);
      setIsOptimizationDialogOpen(false);
      setPendingProcessedFile(null);
      setPendingFileSize(undefined);
      setMeshAnalysis(null);
      setMeshProgress(null);

      // Mark import step as completed and auto-advance to baseplates
      if (!completedSteps.includes('import')) {
        setCompletedSteps(prev => [...prev, 'import']);
      }
    }, [completedSteps]);

    // Handle proceeding with original mesh (with optional repair using Manifold3D)
    const handleProceedWithOriginal = useCallback(async (shouldRepair?: boolean) => {
      if (!pendingProcessedFile) return;

      setIsMeshProcessing(true);
      
      try {
        const hasRepairableIssues = meshAnalysis && meshAnalysis.issues.length > 0 && !meshAnalysis.issues.every(i => i.includes('High triangle count'));
        const doRepair = shouldRepair === true;
        
        console.log('[Mesh Import] ═══════════════════════════════════════════');
        console.log('[Mesh Import] Processing mesh');
        console.log(`[Mesh Import]   Repair requested: ${shouldRepair}`);
        console.log(`[Mesh Import]   Has repairable issues: ${hasRepairableIssues}`);
        console.log(`[Mesh Import]   Will repair: ${doRepair}`);
        
        if (doRepair && hasRepairableIssues) {
          console.log('[Mesh Import] Starting Manifold3D repair...');
          
          // Set initial progress immediately
          setMeshProgress({ 
            stage: 'repairing', 
            progress: 0, 
            message: 'Initializing repair...' 
          });
          
          const result = await repairAndDecimateMesh(
            pendingProcessedFile.mesh.geometry,
            DECIMATION_TARGET,
            { repair: true, decimate: false },
            (p) => setMeshProgress({ 
              stage: p.stage === 'complete' ? 'complete' : 'repairing', 
              progress: p.progress, 
              message: p.message 
            })
          );
          
          if (result.success && result.geometry) {
            console.log('[Mesh Import] ✓ Repair complete');
            console.log(`[Mesh Import]   Was repaired: ${result.wasRepaired}`);
            console.log(`[Mesh Import]   Original triangles: ${result.originalTriangles.toLocaleString()}`);
            console.log(`[Mesh Import]   Final triangles: ${result.finalTriangles.toLocaleString()}`);
            
            const repairedMesh = new THREE.Mesh(
              result.geometry,
              pendingProcessedFile.mesh.material
            );
            repairedMesh.castShadow = true;
            repairedMesh.receiveShadow = true;
            
            const updatedFile: ProcessedFile = {
              ...pendingProcessedFile,
              mesh: repairedMesh,
              metadata: {
                ...pendingProcessedFile.metadata,
                triangles: result.finalTriangles,
              },
            };
            
            finalizeMeshImport(updatedFile);
          } else {
            console.log('[Mesh Import] ✗ Repair failed:', result.error);
            finalizeMeshImport(pendingProcessedFile);
          }
        } else {
          console.log('[Mesh Import] Skipping repair, using original mesh');
          finalizeMeshImport(pendingProcessedFile);
        }
        console.log('[Mesh Import] ═══════════════════════════════════════════');
      } catch (err) {
        console.error('[Mesh Import] Error during mesh repair:', err);
        finalizeMeshImport(pendingProcessedFile);
      } finally {
        setIsMeshProcessing(false);
      }
    }, [pendingProcessedFile, meshAnalysis, finalizeMeshImport]);

    // Handle mesh optimization (decimation only, using fallback method)
    const handleOptimizeMesh = useCallback(async (shouldRepair?: boolean) => {
      if (!pendingProcessedFile) return;

      setIsMeshProcessing(true);
      
      // Set initial progress immediately
      setMeshProgress({ 
        stage: 'decimating', 
        progress: 0, 
        message: 'Initializing optimization...' 
      });
      
      try {
        console.log('[Mesh Import] ═══════════════════════════════════════════');
        console.log('[Mesh Import] Starting mesh optimization');
        console.log(`[Mesh Import]   Repair requested: ${shouldRepair}`);
        
        let currentGeometry = pendingProcessedFile.mesh.geometry;
        
        // Use legacy repair if requested (faster but less robust)
        if (shouldRepair && meshAnalysis && meshAnalysis.issues.length > 0 && !meshAnalysis.issues.every(i => i.includes('High triangle count'))) {
          setMeshProgress({ stage: 'repairing', progress: 0, message: 'Repairing mesh...' });
          const repairResult = await repairMesh(currentGeometry, setMeshProgress);
          
          if (repairResult.success && repairResult.repairedGeometry) {
            console.log('[Mesh Import] ✓ Quick repair complete');
            currentGeometry = repairResult.repairedGeometry;
          }
        }
        
        setMeshProgress({ stage: 'decimating', progress: 0, message: 'Optimizing mesh...' });
        const decimationResult = await decimateMesh(currentGeometry, DECIMATION_TARGET, setMeshProgress);
        
        if (decimationResult.success && decimationResult.decimatedGeometry) {
          console.log('[Mesh Import] ✓ Optimization complete');
          console.log(`[Mesh Import]   Original: ${decimationResult.originalTriangles.toLocaleString()}`);
          console.log(`[Mesh Import]   Final: ${decimationResult.finalTriangles.toLocaleString()}`);
          console.log(`[Mesh Import]   Reduction: ${decimationResult.reductionPercent.toFixed(1)}%`);
          
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
          console.log('[Mesh Import] ✗ Optimization failed:', decimationResult.error);
          setFileError(decimationResult.error || 'Optimization failed');
          finalizeMeshImport(pendingProcessedFile);
        }
        console.log('[Mesh Import] ═══════════════════════════════════════════');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to optimize mesh';
        console.error('[Mesh Import] Error:', errorMessage);
        setFileError(errorMessage);
        finalizeMeshImport(pendingProcessedFile);
      } finally {
        setIsMeshProcessing(false);
      }
    }, [pendingProcessedFile, meshAnalysis, finalizeMeshImport]);

    // Handle combined repair and optimization using Manifold3D (most robust)
    const handleRepairAndOptimize = useCallback(async () => {
      if (!pendingProcessedFile) return;

      console.log('[Mesh Import] handleRepairAndOptimize called');
      console.log('[Mesh Import] Setting isMeshProcessing=true');
      setIsMeshProcessing(true);
      
      // For large files (>5MB), use aggressive decimation target (50K triangles)
      // Otherwise use standard target (500K)
      const isLargeFile = pendingFileSize && pendingFileSize > LARGE_FILE_THRESHOLD;
      const LARGE_FILE_DECIMATION_TARGET = 50_000;
      const effectiveTarget = isLargeFile ? LARGE_FILE_DECIMATION_TARGET : DECIMATION_TARGET;
      
      // Set initial progress immediately
      console.log('[Mesh Import] Setting initial meshProgress');
      setMeshProgress({ 
        stage: 'repairing', 
        progress: 0, 
        message: 'Initializing mesh processing...' 
      });
      
      // IMPORTANT: Allow UI to update before starting heavy processing
      // Without this delay, React can't re-render before the main thread is blocked
      await new Promise(resolve => setTimeout(resolve, 100));
      
      try {
        console.log('[Mesh Import] ═══════════════════════════════════════════');
        console.log('[Mesh Import] Starting ROBUST Repair & Optimize with Manifold3D');
        console.log(`[Mesh Import]   Original triangles: ${pendingProcessedFile.metadata.triangles.toLocaleString()}`);
        console.log(`[Mesh Import]   Target triangles: ${effectiveTarget.toLocaleString()}`);
        console.log(`[Mesh Import]   File size: ${pendingFileSize ? (pendingFileSize / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'}`);
        console.log(`[Mesh Import]   Large file mode (>5MB): ${!!isLargeFile}`);
        
        const result = await repairAndDecimateMesh(
          pendingProcessedFile.mesh.geometry,
          effectiveTarget,
          { 
            repair: true, 
            decimate: true, 
            forceDecimate: !!isLargeFile // Force decimation for large files
          },
          (p) => setMeshProgress({ 
            stage: p.stage === 'complete' ? 'complete' : p.stage === 'repairing' ? 'repairing' : 'decimating', 
            progress: p.progress, 
            message: p.message 
          })
        );
        
        if (result.success && result.geometry) {
          console.log('[Mesh Import] ✓ Repair & Optimize complete');
          console.log(`[Mesh Import]   Was repaired: ${result.wasRepaired}`);
          console.log(`[Mesh Import]   Was decimated: ${result.wasDecimated}`);
          console.log(`[Mesh Import]   Original: ${result.originalTriangles.toLocaleString()}`);
          console.log(`[Mesh Import]   Final: ${result.finalTriangles.toLocaleString()}`);
          console.log(`[Mesh Import]   Reduction: ${result.reductionPercent.toFixed(1)}%`);
          result.actions.forEach(action => console.log(`[Mesh Import]   → ${action}`));
          
          const processedMesh = new THREE.Mesh(
            result.geometry,
            pendingProcessedFile.mesh.material
          );
          processedMesh.castShadow = true;
          processedMesh.receiveShadow = true;
          
          const updatedFile: ProcessedFile = {
            ...pendingProcessedFile,
            mesh: processedMesh,
            metadata: {
              ...pendingProcessedFile.metadata,
              triangles: result.finalTriangles,
            },
          };
          
          // Store results for display - don't auto-close
          setProcessingResult({
            success: true,
            wasRepaired: result.wasRepaired,
            wasDecimated: result.wasDecimated,
            originalTriangles: result.originalTriangles,
            finalTriangles: result.finalTriangles,
            reductionPercent: result.reductionPercent,
            actions: result.actions,
            processedFile: updatedFile,
          });
        } else {
          console.log('[Mesh Import] ✗ Repair & Optimize failed:', result.error);
          setProcessingResult({
            success: false,
            wasRepaired: false,
            wasDecimated: false,
            originalTriangles: pendingProcessedFile.metadata.triangles,
            finalTriangles: pendingProcessedFile.metadata.triangles,
            reductionPercent: 0,
            actions: [],
            error: result.error || 'Processing failed',
            processedFile: pendingProcessedFile,
          });
        }
        console.log('[Mesh Import] ═══════════════════════════════════════════');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to process mesh';
        console.error('[Mesh Import] Error:', errorMessage);
        setProcessingResult({
          success: false,
          wasRepaired: false,
          wasDecimated: false,
          originalTriangles: pendingProcessedFile.metadata.triangles,
          finalTriangles: pendingProcessedFile.metadata.triangles,
          reductionPercent: 0,
          actions: [],
          error: errorMessage,
          processedFile: pendingProcessedFile,
        });
      } finally {
        setIsMeshProcessing(false);
      }
    }, [pendingProcessedFile, finalizeMeshImport]);

    // Handle confirming processing results and finalizing import
    const handleConfirmProcessingResult = useCallback(() => {
      if (processingResult?.processedFile) {
        finalizeMeshImport(processingResult.processedFile);
      }
      setProcessingResult(null);
    }, [processingResult, finalizeMeshImport]);

    // Handle canceling mesh optimization
    const handleCancelOptimization = useCallback(() => {
      setIsOptimizationDialogOpen(false);
      setPendingProcessedFile(null);
      setPendingFileSize(undefined);
      setMeshAnalysis(null);
      setMeshProgress(null);
      setProcessingResult(null);
      setIsProcessing(false);
    }, []);

    // Clear file
    const handleClearFile = useCallback(() => {
      setImportedParts([]);
      setSelectedPartId(null);
      setFileError(null);
      clearError();
      setCompletedSteps(prev => prev.filter(s => s !== 'import'));
      window.dispatchEvent(new CustomEvent('session-reset'));
    }, [clearError]);

    // Handle step change from context panel or toolbar
    const handleStepChange = useCallback((step: WorkflowStep) => {
      // Log memory at step transitions for debugging
      logMemoryUsage(`Step change: ${activeStep} → ${step}`);
      
      setActiveStep(step);
      
      // Cancel placement mode when leaving supports step
      if (step !== 'supports' && isPlacementMode) {
        setIsPlacementMode(false);
        window.dispatchEvent(new Event('supports-cancel-placement'));
      }
      
    }, [isPlacementMode, activeStep]);

    // Listen for highlight-component events from double-click on 3D meshes
    // This is in AppShell (always mounted) to ensure events are handled even if ContextOptionsPanel is collapsed
    useEffect(() => {
      const categoryToStep: Record<string, WorkflowStep> = {
        'part': 'import',
        'baseplate': 'baseplates',
        'support': 'supports',
        'clamp': 'clamps',
        'label': 'labels',
        'hole': 'drill',
        'cavity': 'cavity'
      };

      const handleHighlightComponent = (event: CustomEvent<{ category: string; id: string }>) => {
        const category = event.detail?.category;
        if (!category) return;
        
        const targetStep = categoryToStep[category];
        if (targetStep && targetStep !== activeStep) {
          setActiveStep(targetStep);
        }
      };

      window.addEventListener('highlight-component', handleHighlightComponent as EventListener);
      return () => {
        window.removeEventListener('highlight-component', handleHighlightComponent as EventListener);
      };
    }, [activeStep]);

    const handleResetSession = () => {
      // Log memory before reset
      logMemoryUsage('Session reset - before');
      
      // Terminate all workers to free memory
      terminateWorkers();
      
      // Reset all session state - like starting fresh
      setCurrentBaseplate(null);
      setUndoStack([]);
      setRedoStack([]);
      setImportedParts([]);
      setSelectedPartId(null);
      setFileError(null);
      setActiveStep('import');
      setCompletedSteps([]);
      setSkippedSteps([]);
      setSupports([]);
      setIsPlacementMode(false);
      setSelectedSupportId(null);
      // Reset mounting holes
      setMountingHoles([]);
      setSelectedHoleId(null);
      setIsHolePlacementMode(false);
      setPendingHoleConfig(null);
      
      // Dispatch events to reset the 3D scene and clear the file
      window.dispatchEvent(new CustomEvent('viewer-reset'));
      window.dispatchEvent(new CustomEvent('session-reset'));
      window.dispatchEvent(new Event('supports-cancel-placement'));
      
      // Log memory after reset (delayed to allow GC)
      setTimeout(() => logMemoryUsage('Session reset - after (delayed)'), 1000);
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
      // dimensions.height is the baseplate thickness (depth in Y direction)
      const baseplateDepth = dimensions?.height ?? 4;
      
      // For multi-section, include the drawn sections
      let sections = option === 'multi-section' ? dimensions?.sections : undefined;
      
      // If switching TO multi-section FROM a different existing baseplate type, clear all placed features
      // to prevent errors with existing supports, clamps, labels, holes
      // NOTE: Only clear if there IS a current baseplate AND it's not multi-section
      if (option === 'multi-section' && currentBaseplate && currentBaseplate.type !== 'multi-section') {
        // Clear all features that depend on baseplate geometry
        setSupports([]);
        setClamps([]);
        setLabels([]);
        setMountingHoles([]);
        
        // Dispatch events to notify 3D scene to clear its internal state
        window.dispatchEvent(new Event('supports-clear-all'));
        window.dispatchEvent(new Event('clamps-clear-all'));
        window.dispatchEvent(new Event('labels-clear-all'));
        window.dispatchEvent(new Event('mounting-holes-clear-all'));
      }
      
      // If we're adding to an existing multi-section baseplate, preserve the ID and merge sections
      if (option === 'multi-section' && currentBaseplate?.type === 'multi-section') {
        // Merge existing sections with new ones
        const existingSections = currentBaseplate.sections || [];
        const newSections = sections || [];
        sections = [...existingSections, ...newSections];
        
        setCurrentBaseplate({ 
          id: currentBaseplate.id, // Keep the same ID
          type: option, 
          padding: dimensions?.padding || dimensions?.oversizeXY, 
          height: dimensions?.height,
          depth: baseplateDepth,
          sections
        });
      } else {
        setCurrentBaseplate({ 
          id: baseplateId, 
          type: option, 
          padding: dimensions?.padding || dimensions?.oversizeXY, 
          height: dimensions?.height,
          depth: baseplateDepth,
          sections
        });
      }
      
      // Clear drawn sections after creating the baseplate
      if (option === 'multi-section') {
        setDrawnBaseplateSections([]);
        setIsBaseplateDrawingMode(false);
        
        // Exit drawing mode - notify 3D scene to restore camera and enable orbit controls
        window.dispatchEvent(new CustomEvent('baseplate-drawing-mode-changed', {
          detail: { active: false }
        }));
      }
      
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
      setDrawnBaseplateSections([]);
      setIsBaseplateDrawingMode(false);
      setCompletedSteps(prev => prev.filter(s => s !== 'baseplates'));
      window.dispatchEvent(new CustomEvent('remove-baseplate', { detail: { basePlateId } }));
    };

    // Handle section drawn event from 3D scene
    const handleSectionDrawn = useCallback((e: CustomEvent<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }>) => {
      const section = e.detail;
      setDrawnBaseplateSections(prev => [...prev, section]);
    }, []);

    // Handle section removal
    const handleRemoveSection = useCallback((sectionId: string) => {
      setDrawnBaseplateSections(prev => prev.filter(s => s.id !== sectionId));
    }, []);

    // Handle section removal from created baseplate
    const handleRemoveBaseplateSection = useCallback((sectionId: string) => {
      if (!currentBaseplate || currentBaseplate.type !== 'multi-section') return;
      
      const updatedSections = (currentBaseplate.sections || []).filter(s => s.id !== sectionId);
      
      // If no sections left, remove the entire baseplate
      if (updatedSections.length === 0) {
        handleBaseplateRemoved(currentBaseplate.id);
        return;
      }
      
      // Update the baseplate with remaining sections
      const updatedBaseplate = {
        ...currentBaseplate,
        sections: updatedSections,
      };
      setCurrentBaseplate(updatedBaseplate);
      
      // Dispatch update event to 3D scene
      window.dispatchEvent(new CustomEvent('baseplate-section-removed', {
        detail: { sectionId, sections: updatedSections }
      }));
    }, [currentBaseplate]);

    // Handle baseplate section position update (from drag in 3D scene)
    const handleBasePlateSectionUpdated = useCallback((e: CustomEvent<{
      basePlateId: string;
      sectionId: string;
      newBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    }>) => {
      if (!currentBaseplate || currentBaseplate.type !== 'multi-section') return;
      
      const { sectionId, newBounds } = e.detail;
      
      // Update the section in currentBaseplate
      const updatedSections = (currentBaseplate.sections || []).map(s => 
        s.id === sectionId ? { ...s, ...newBounds } : s
      );
      
      setCurrentBaseplate({
        ...currentBaseplate,
        sections: updatedSections,
      });
    }, [currentBaseplate]);

    // Toggle drawing mode for multi-section baseplate
    const handleToggleDrawingMode = useCallback((active: boolean) => {
      // If activating drawing mode and there's an existing non-multi-section baseplate, clear it
      if (active && currentBaseplate && currentBaseplate.type !== 'multi-section') {
        // Clear the existing baseplate
        handleBaseplateRemoved(currentBaseplate.id);
        
        // Clear all features that depend on baseplate geometry
        setSupports([]);
        setClamps([]);
        setLabels([]);
        setMountingHoles([]);
        
        // Dispatch events to notify 3D scene to clear its internal state
        window.dispatchEvent(new Event('supports-clear-all'));
        window.dispatchEvent(new Event('clamps-clear-all'));
        window.dispatchEvent(new Event('labels-clear-all'));
        window.dispatchEvent(new Event('mounting-holes-clear-all'));
      }
      
      setIsBaseplateDrawingMode(active);
      // Dispatch event to 3D scene to enable/disable drawing mode
      window.dispatchEvent(new CustomEvent('baseplate-drawing-mode-changed', { 
        detail: { 
          active,
          padding: currentBaseplateParams.padding 
        } 
      }));
    }, [currentBaseplateParams, currentBaseplate]);

    // Handle adding more sections to existing multi-section baseplate
    const handleAddBaseplateSection = useCallback(() => {
      if (!currentBaseplate || currentBaseplate.type !== 'multi-section') return;
      
      // Navigate to baseplates step
      setActiveStep('baseplates');
      
      // Enable drawing mode
      handleToggleDrawingMode(true);
    }, [currentBaseplate, handleToggleDrawingMode]);

    const handleBaseplateUpdate = (updates: { padding?: number; height?: number }) => {
      if (!currentBaseplate) return;
      
      const updatedBaseplate = {
        ...currentBaseplate,
        ...updates
      };
      setCurrentBaseplate(updatedBaseplate);
      
      // Dispatch event to update baseplate in 3D scene
      window.dispatchEvent(new CustomEvent('update-baseplate', { 
        detail: { 
          basePlateId: currentBaseplate.id,
          dimensions: {
            padding: updatedBaseplate.padding,
            height: updatedBaseplate.height,
            oversizeXY: updatedBaseplate.padding
          }
        } 
      }));
    };

    // Handle tool selection - now also updates active step
    const handleToolSelect = (toolId: string) => {
      // Update the active step in the context panel
      if (['import', 'baseplates', 'supports', 'cavity', 'clamps', 'labels', 'drill', 'export'].includes(toolId)) {
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
          // Cavity is handled by the CavityStepContent in the context panel
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

    // Listen for baseplate section drawn events
    React.useEffect(() => {
      window.addEventListener('baseplate-section-drawn', handleSectionDrawn as EventListener);
      return () => window.removeEventListener('baseplate-section-drawn', handleSectionDrawn as EventListener);
    }, [handleSectionDrawn]);

    // Listen for baseplate config updates from 3DScene (with merged sections)
    React.useEffect(() => {
      const handleConfigUpdate = (e: CustomEvent<{
        id: string;
        type: string;
        sections?: BasePlateSection[];
        padding?: number;
        height?: number;
        depth?: number;
      }>) => {
        const { id, type, sections, padding, height, depth } = e.detail;
        // Update currentBaseplate with the merged sections from 3DScene
        setCurrentBaseplate({
          id,
          type: type as any,
          sections,
          padding,
          height,
          depth
        });
      };
      
      window.addEventListener('baseplate-config-updated', handleConfigUpdate as EventListener);
      return () => window.removeEventListener('baseplate-config-updated', handleConfigUpdate as EventListener);
    }, []);

    // Listen for baseplate section position updates from 3DScene
    React.useEffect(() => {
      window.addEventListener('baseplate-section-updated', handleBasePlateSectionUpdated as EventListener);
      return () => window.removeEventListener('baseplate-section-updated', handleBasePlateSectionUpdated as EventListener);
    }, [handleBasePlateSectionUpdated]);

    // Listen for baseplate section selection from 3DScene
    React.useEffect(() => {
      const handleSectionSelected = (e: CustomEvent<{ sectionId: string }>) => {
        setSelectedBasePlateSectionId(e.detail.sectionId);
      };
      
      window.addEventListener('baseplate-section-selected', handleSectionSelected as EventListener);
      return () => window.removeEventListener('baseplate-section-selected', handleSectionSelected as EventListener);
    }, []);

    // Listen for supports dialog open event - no longer needed as we use context panel
    // Remove floating panel, placement mode is controlled via context panel

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
        
        // Mark supports step as completed
        if (!completedSteps.includes('supports')) {
          setCompletedSteps(prev => [...prev, 'supports']);
        }
        
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
        setSupports(prev => {
          const newSupports = prev.filter(s => s.id !== supportId);
          // Remove completion if no supports left
          if (newSupports.length === 0) {
            setCompletedSteps(prevSteps => prevSteps.filter(s => s !== 'supports'));
          }
          return newSupports;
        });
        if (selectedSupportId === supportId) {
          setSelectedSupportId(null);
        }
      };

      const onSupportsClearAll = () => {
        setSupports([]);
        setSelectedSupportId(null);
        // Remove supports completion when all cleared
        setCompletedSteps(prev => prev.filter(s => s !== 'supports'));
      };

      const onCancelPlacement = () => {
        setIsPlacementMode(false);
      };

      // Handle batch auto-placement (replaces all supports)
      const onSupportsAutoPlaced = (e: CustomEvent) => {
        const { supports: newSupports } = e.detail as { supports: AnySupport[] };
        if (newSupports && Array.isArray(newSupports)) {
          setSupports(newSupports);
          setSelectedSupportId(null);
          // Mark supports step as completed if we have supports
          if (newSupports.length > 0 && !completedSteps.includes('supports')) {
            setCompletedSteps(prev => [...prev, 'supports']);
          } else if (newSupports.length === 0) {
            setCompletedSteps(prev => prev.filter(s => s !== 'supports'));
          }
          console.log('[AppShell] Auto-placed', newSupports.length, 'supports');
        }
      };

      window.addEventListener('support-created', onSupportCreated as EventListener);
      window.addEventListener('support-updated', onSupportUpdated as EventListener);
      window.addEventListener('support-delete', onSupportDelete as EventListener);
      window.addEventListener('supports-clear-all', onSupportsClearAll);
      window.addEventListener('supports-cancel-placement', onCancelPlacement);
      window.addEventListener('supports-auto-placed', onSupportsAutoPlaced as EventListener);

      return () => {
        window.removeEventListener('support-created', onSupportCreated as EventListener);
        window.removeEventListener('support-updated', onSupportUpdated as EventListener);
        window.removeEventListener('support-delete', onSupportDelete as EventListener);
        window.removeEventListener('supports-clear-all', onSupportsClearAll);
        window.removeEventListener('supports-cancel-placement', onCancelPlacement);
        window.removeEventListener('supports-auto-placed', onSupportsAutoPlaced as EventListener);
      };
    }, [selectedSupportId, completedSteps]);

    // Listen for label events from 3D scene (e.g., when using pivot controls)
    React.useEffect(() => {
      const onLabelUpdate = (e: CustomEvent) => {
        const { labelId, updates } = e.detail as { labelId: string; updates: any };
        setLabels(prev => prev.map(l => l.id === labelId ? { ...l, ...updates } : l));
      };

      const onLabelAdded = (e: CustomEvent) => {
        const label = e.detail;
        if (label && label.id) {
          setLabels(prev => {
            // Avoid duplicates
            if (prev.some(l => l.id === label.id)) return prev;
            return [...prev, label];
          });
          setSelectedLabelId(label.id);
          
          // Mark labels step as completed
          if (!completedSteps.includes('labels')) {
            setCompletedSteps(prev => [...prev, 'labels']);
          }
        }
      };

      const onLabelSelect = (e: CustomEvent) => {
        const labelId = e.detail as string | null;
        setSelectedLabelId(labelId);
      };

      const onLabelDelete = (e: CustomEvent) => {
        const labelId = e.detail as string;
        setLabels(prev => {
          const newLabels = prev.filter(l => l.id !== labelId);
          // Remove completion if no labels left
          if (newLabels.length === 0) {
            setCompletedSteps(prevSteps => prevSteps.filter(s => s !== 'labels'));
          }
          return newLabels;
        });
        if (selectedLabelId === labelId) {
          setSelectedLabelId(null);
        }
      };

      window.addEventListener('label-update', onLabelUpdate as EventListener);
      window.addEventListener('label-added', onLabelAdded as EventListener);
      window.addEventListener('label-selected', onLabelSelect as EventListener);
      window.addEventListener('label-delete', onLabelDelete as EventListener);

      return () => {
        window.removeEventListener('label-update', onLabelUpdate as EventListener);
        window.removeEventListener('label-added', onLabelAdded as EventListener);
        window.removeEventListener('label-selected', onLabelSelect as EventListener);
        window.removeEventListener('label-delete', onLabelDelete as EventListener);
      };
    }, [completedSteps, selectedLabelId]);

    // Listen for clamp events from 3D scene
    React.useEffect(() => {
      const onClampPlaced = (e: CustomEvent) => {
        const clamp = e.detail as PlacedClamp;
        if (clamp && clamp.id) {
          setClamps(prev => {
            // Avoid duplicates
            if (prev.some(c => c.id === clamp.id)) return prev;
            return [...prev, clamp];
          });
          setSelectedClampId(clamp.id);
          
          // Mark clamps step as completed
          if (!completedSteps.includes('clamps')) {
            setCompletedSteps(prev => [...prev, 'clamps']);
          }
        }
      };

      const onClampUpdate = (e: CustomEvent) => {
        const { clampId, updates } = e.detail as { clampId: string; updates: Partial<PlacedClamp> };
        setClamps(prev => prev.map(c => c.id === clampId ? { ...c, ...updates } : c));
      };

      const onClampSelect = (e: CustomEvent) => {
        const clampId = e.detail as string | null;
        setSelectedClampId(clampId);
      };

      const onClampDelete = (e: CustomEvent) => {
        const clampId = e.detail as string;
        setClamps(prev => {
          const newClamps = prev.filter(c => c.id !== clampId);
          // Remove completion if no clamps left
          if (newClamps.length === 0) {
            setCompletedSteps(prevSteps => prevSteps.filter(s => s !== 'clamps'));
          }
          return newClamps;
        });
        if (selectedClampId === clampId) {
          setSelectedClampId(null);
        }
      };

      window.addEventListener('clamp-placed', onClampPlaced as EventListener);
      window.addEventListener('clamp-update', onClampUpdate as EventListener);
      window.addEventListener('clamp-selected', onClampSelect as EventListener);
      window.addEventListener('clamp-delete', onClampDelete as EventListener);

      return () => {
        window.removeEventListener('clamp-placed', onClampPlaced as EventListener);
        window.removeEventListener('clamp-update', onClampUpdate as EventListener);
        window.removeEventListener('clamp-selected', onClampSelect as EventListener);
        window.removeEventListener('clamp-delete', onClampDelete as EventListener);
      };
    }, [selectedClampId, completedSteps]);

    // Handle clamp update from properties panel
    const handleClampUpdate = useCallback((clampId: string, updates: Partial<PlacedClamp>) => {
      setClamps(prev => prev.map(c => c.id === clampId ? { ...c, ...updates } : c));
      // Dispatch to 3D scene
      window.dispatchEvent(new CustomEvent('clamp-update', { detail: { clampId, updates } }));
    }, []);

    // Handle clamp delete from properties panel
    const handleClampDelete = useCallback((clampId: string) => {
      setClamps(prev => prev.filter(c => c.id !== clampId));
      if (selectedClampId === clampId) {
        setSelectedClampId(null);
      }
      // Dispatch to 3D scene
      window.dispatchEvent(new CustomEvent('clamp-delete', { detail: clampId }));
    }, [selectedClampId]);

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
                <Aperture className="w-4 h-4 text-primary" />
              </div>
              <span className="font-tech font-semibold text-sm">RapidTool-Fixture</span>
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
                  skippedSteps={skippedSteps}
                  onSkipStep={(step) => {
                    setSkippedSteps(prev => 
                      prev.includes(step) ? prev : [...prev, step]
                    );
                  }}
                  isProcessing={actualProcessing}
                >
                  {/* Render step-specific content */}
                  {activeStep === 'import' && (
                    <ImportStepContent
                      currentFile={actualFile}
                      parts={importedParts}
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
                        // Store params for drawing mode
                        setCurrentBaseplateParams({ padding: options.padding, height: options.height });
                        
                        window.dispatchEvent(new CustomEvent('create-baseplate', {
                          detail: { 
                            type: 'baseplate',
                            option: type,
                            dimensions: {
                              padding: options.padding,
                              height: options.height,
                              oversizeXY: options.padding, // For convex-hull
                              sections: options.sections // For multi-section
                            }
                          }
                        }));
                      }}
                      onRemoveBaseplate={() => currentBaseplate && handleBaseplateRemoved(currentBaseplate.id)}
                      isDrawingMode={isBaseplateDrawingMode}
                      onToggleDrawingMode={handleToggleDrawingMode}
                      drawnSections={drawnBaseplateSections}
                      onRemoveSection={handleRemoveSection}
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
                      hasSupports={supports.length > 0}
                      supportsCount={supports.length}
                      settings={cavitySettings}
                      onSettingsChange={handleCavitySettingsChange}
                      onGeneratePreview={handleGenerateCavityPreview}
                      onClearPreview={handleClearCavityPreview}
                      onExecuteCavity={handleExecuteCavity}
                      onResetCavity={handleResetCavity}
                      isProcessing={isCavityProcessing}
                      isApplying={isApplyingCavity}
                      hasPreview={hasCavityPreview}
                      isCavityApplied={isCavityApplied}
                    />
                  )}
                  {activeStep === 'clamps' && (
                    <ClampsStepContent
                      hasWorkpiece={!!actualFile}
                      clampsCount={clamps.length}
                    />
                  )}
                  {activeStep === 'labels' && (
                    <LabelsStepContent
                      hasWorkpiece={!!actualFile || !!currentBaseplate}
                      hasBaseplate={!!currentBaseplate}
                      hasSupports={supports.length > 0}
                      labels={labels as any}
                      selectedLabelId={selectedLabelId}
                      currentBaseplate={currentBaseplate}
                      selectedSectionId={selectedBasePlateSectionId}
                      onSectionSelect={(sectionId) => {
                        setSelectedBasePlateSectionId(sectionId);
                        // Dispatch event for 3D scene highlighting
                        window.dispatchEvent(new CustomEvent('baseplate-section-select', { detail: sectionId }));
                      }}
                      onAddLabel={(label) => {
                        setLabels(prev => [...prev, {
                          id: label.id,
                          text: label.text,
                          fontSize: label.fontSize,
                          depth: label.depth,
                          position: { x: label.position.x, y: label.position.y, z: label.position.z },
                          rotation: { x: label.rotation.x, y: label.rotation.y, z: label.rotation.z },
                          sectionId: label.sectionId
                        }]);
                        // Mark labels step as completed
                        if (!completedSteps.includes('labels')) {
                          setCompletedSteps(prev => [...prev, 'labels']);
                        }
                      }}
                      onUpdateLabel={(labelId, updates) => setLabels(prev => prev.map(l => 
                        l.id === labelId ? { ...l, ...updates } as any : l
                      ))}
                      onDeleteLabel={(labelId) => {
                        setLabels(prev => {
                          const newLabels = prev.filter(l => l.id !== labelId);
                          // Remove completion if no labels left
                          if (newLabels.length === 0) {
                            setCompletedSteps(prevSteps => prevSteps.filter(s => s !== 'labels'));
                          }
                          return newLabels;
                        });
                        if (selectedLabelId === labelId) setSelectedLabelId(null);
                        // Dispatch for 3D scene
                        window.dispatchEvent(new CustomEvent('label-delete', { detail: labelId }));
                      }}
                      onSelectLabel={setSelectedLabelId}
                    />
                  )}
                  {activeStep === 'drill' && (
                    <DrillStepContent
                      hasWorkpiece={!!actualFile || !!currentBaseplate}
                      baseplateHeight={currentBaseplate?.depth ?? 20}
                      holes={mountingHoles}
                      isPlacementMode={isHolePlacementMode}
                      onStartPlacement={handleStartHolePlacement}
                      onCancelPlacement={handleCancelHolePlacement}
                    />
                  )}
                  {activeStep === 'export' && (
                    <ExportStepContent
                      hasFixture={!!actualFile || !!currentBaseplate}
                      hasCavityCutout={isCavityApplied}
                      isMultiSection={currentBaseplate?.type === 'multi-section'}
                      sectionCount={currentBaseplate?.sections?.length ?? 1}
                      onExport={handleExport}
                      isExporting={isExporting}
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
              selectedSupportId={selectedSupportId}
              onSupportSelect={setSelectedSupportId}
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
                {/* Part Properties Accordion - File Details, Transform controls, Baseplate, and Supports */}
                <PartPropertiesAccordion 
                  hasModel={importedParts.length > 0} 
                  currentFile={actualFile}
                  importedParts={importedParts}
                  selectedPartId={selectedPartId}
                  onPartSelect={(partId) => {
                    setSelectedPartId(partId);
                    // Also dispatch event for 3D viewer
                    window.dispatchEvent(new CustomEvent('part-selected', { detail: partId }));
                  }}
                  onClearFile={handleClearFile}
                  onRemovePart={(partId) => {
                    setImportedParts(prev => prev.filter(p => p.id !== partId));
                    setPartVisibility(prev => {
                      const newMap = new Map(prev);
                      newMap.delete(partId);
                      return newMap;
                    });
                    if (selectedPartId === partId) {
                      setSelectedPartId(null);
                    }
                    window.dispatchEvent(new CustomEvent('part-removed', { detail: partId }));
                  }}
                  baseplate={currentBaseplate}
                  onRemoveBaseplate={() => currentBaseplate && handleBaseplateRemoved(currentBaseplate.id)}
                  onUpdateBaseplate={handleBaseplateUpdate}
                  onRemoveBaseplateSection={handleRemoveBaseplateSection}
                  onAddBaseplateSection={handleAddBaseplateSection}
                  selectedBasePlateSectionId={selectedBasePlateSectionId}
                  baseplateVisible={baseplateVisible}
                  onBaseplateVisibilityChange={setBaseplateVisible}
                  supports={supports}
                  selectedSupportId={selectedSupportId}
                  onSupportSelect={setSelectedSupportId}
                  onSupportUpdate={handleSupportUpdate}
                  onSupportDelete={handleSupportDelete}
                  modelColor={actualFile ? modelColors.get(actualFile.metadata.name) : undefined}
                  modelColors={modelColors}
                  partVisibility={partVisibility}
                  onPartVisibilityChange={(partId, visible) => {
                    setPartVisibility(prev => new Map(prev).set(partId, visible));
                    // Deselect part if it's being hidden
                    if (!visible && selectedPartId === partId) {
                      setSelectedPartId(null);
                      window.dispatchEvent(new CustomEvent('part-selected', { detail: null }));
                    }
                    // Dispatch event for 3D viewer
                    window.dispatchEvent(new CustomEvent('part-visibility-changed', { 
                      detail: { partId, visible } 
                    }));
                  }}
                  // Cavity settings props (simplified - main controls in CavityStepContent)
                  cavitySettings={cavitySettings}
                  isCavityProcessing={isCavityProcessing}
                  hasCavityPreview={hasCavityPreview}
                  // Labels props
                  labels={labels as any}
                  selectedLabelId={selectedLabelId}
                  onLabelSelect={setSelectedLabelId}
                  onLabelUpdate={(labelId, updates) => {
                    setLabels(prev => prev.map(l => 
                      l.id === labelId ? { ...l, ...updates } : l
                    ));
                    // Dispatch event for 3D scene
                    window.dispatchEvent(new CustomEvent('label-update', { 
                      detail: { labelId, updates } 
                    }));
                  }}
                  onLabelDelete={(labelId) => {
                    setLabels(prev => {
                      const newLabels = prev.filter(l => l.id !== labelId);
                      // Remove completion if no labels left
                      if (newLabels.length === 0) {
                        setCompletedSteps(prevSteps => prevSteps.filter(s => s !== 'labels'));
                      }
                      return newLabels;
                    });
                    if (selectedLabelId === labelId) setSelectedLabelId(null);
                    // Dispatch event for 3D scene
                    window.dispatchEvent(new CustomEvent('label-delete', { detail: labelId }));
                  }}
                  // Clamps props
                  clamps={clamps}
                  selectedClampId={selectedClampId}
                  onClampSelect={setSelectedClampId}
                  onClampUpdate={handleClampUpdate}
                  onClampDelete={handleClampDelete}
                  // Mounting holes props
                  holes={mountingHoles}
                  selectedHoleId={selectedHoleId}
                  onHoleSelect={setSelectedHoleId}
                  onHoleUpdate={handleHoleUpdate}
                  onHoleDelete={handleHoleDelete}
                />
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
          fileSize={pendingFileSize}
          onProceedWithOriginal={handleProceedWithOriginal}
          onOptimizeMesh={handleOptimizeMesh}
          onRepairAndOptimize={handleRepairAndOptimize}
          onCancel={handleCancelOptimization}
          processingResult={processingResult}
          onConfirmResult={handleConfirmProcessingResult}
        />
      </div>
    );
  }
);

AppShell.displayName = "AppShell";

export default AppShell;
