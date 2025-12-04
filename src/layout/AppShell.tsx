import React, { forwardRef, ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import ViewCube from "@/components/ViewCube";
import VerticalToolbar from "@/components/VerticalToolbar";
import ThreeDViewer from "@/components/3DViewer";
import BaseplateDialog from "@/components/BaseplateDialog";
import SupportsPanel from "@/components/Supports/SupportsPanel";
import BooleanOperationsPanel from "@/components/BooleanOperationsPanel";
import PartPropertiesAccordion from "@/components/PartPropertiesAccordion";
import { ProcessedFile } from "@/modules/FileImport/types";
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
  ({ children, onLogout, onToggleDesignMode, designMode = false, isProcessing = false, fileStats, currentFile }, ref) => {
    const [isBaseplateDialogOpen, setIsBaseplateDialogOpen] = useState(false);
    const [isSupportsOpen, setIsSupportsOpen] = useState(false);
    const [isCavityOpen, setIsCavityOpen] = useState(false);
    const [isFileImportCollapsed, setIsFileImportCollapsed] = useState(false);
    const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);
    const [undoStack, setUndoStack] = useState<any[]>([]);
    const [redoStack, setRedoStack] = useState<any[]>([]);
    const [currentBaseplate, setCurrentBaseplate] = useState<{ id: string; type: string } | null>(null);
    const [cavityBaseMesh, setCavityBaseMesh] = useState<any | null>(null);
    const [cavityTools, setCavityTools] = useState<any[]>([]);

    const handleOpenFilePicker = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.stl,.obj,.glb,.gltf';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const event = new CustomEvent('filepicker-selected', { detail: file });
          window.dispatchEvent(event);
        }
      };
      input.click();
    };

    const handleResetSession = () => {
      // Reset all session state - like starting fresh
      setCurrentBaseplate(null);
      setUndoStack([]);
      setRedoStack([]);
      setCavityBaseMesh(null);
      setCavityTools([]);
      setIsCavityOpen(false);
      setIsSupportsOpen(false);
      
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
      const { option } = e.detail;
      const baseplateId = `baseplate-${Date.now()}`;
      setCurrentBaseplate({ id: baseplateId, type: option });
      // Also cancel any ongoing supports placement and close panel
      setIsSupportsOpen(false);
      window.dispatchEvent(new Event('supports-cancel-placement'));
    };

    const handleBaseplateRemoved = (basePlateId: string) => {
      setCurrentBaseplate(null);
      window.dispatchEvent(new CustomEvent('remove-baseplate', { detail: { basePlateId } }));
    };

    const handleToolSelect = (toolId: string) => {
      switch (toolId) {
        case 'import':
          handleOpenFilePicker();
          return;
        case 'baseplates':
          setIsBaseplateDialogOpen(true);
          // Close supports and cancel placement if active
          setIsSupportsOpen(false);
          window.dispatchEvent(new Event('supports-cancel-placement'));
          return;
        case 'supports':
          setIsSupportsOpen(true);
          window.dispatchEvent(new CustomEvent('open-supports-dialog'));
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

    // Listen for supports dialog open event
    React.useEffect(() => {
      const onOpenSupports = () => setIsSupportsOpen(true);
      window.addEventListener('open-supports-dialog', onOpenSupports as EventListener);
      return () => window.removeEventListener('open-supports-dialog', onOpenSupports as EventListener);
    }, []);

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

    // Record support creations to undo stack
    React.useEffect(() => {
      const onSupportCreated = (e: CustomEvent) => {
        const support = e.detail;
        const state = { type: 'support-created', support };
        setUndoStack(prev => [...prev, state]);
        setRedoStack([]);
      };
      window.addEventListener('support-created', onSupportCreated as EventListener);
      return () => window.removeEventListener('support-created', onSupportCreated as EventListener);
    }, []);

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
                disabled={isProcessing}
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
            {fileStats?.name && (
              <div className="flex items-center gap-3 text-xs font-tech">
                <div className="flex items-center gap-1">
                  <Box className="w-3 h-3 text-muted-foreground" />
                  <span className="text-foreground">{fileStats.name}</span>
                </div>
                {fileStats.triangles && (
                  <Badge variant="secondary" className="font-tech text-xs">
                    {fileStats.triangles.toLocaleString()} tri
                  </Badge>
                )}
                {fileStats.size && (
                  <span className="text-muted-foreground">{fileStats.size}</span>
                )}
              </div>
            )}

            {isProcessing && (
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
                disabled={isProcessing}
                title="Front View"
              >
                <IconIsoFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('back')}
                className="tech-transition px-2"
                disabled={isProcessing}
                title="Back View"
              >
                <IconIsoFace className="w-4 h-4 rotate-180" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('left')}
                className="tech-transition px-2"
                disabled={isProcessing}
                title="Left View"
              >
                <IconIsoLeftFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('right')}
                className="tech-transition px-2"
                disabled={isProcessing}
                title="Right View"
              >
                <IconIsoFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('top')}
                className="tech-transition px-2"
                disabled={isProcessing}
                title="Top View"
              >
                <IconTopFace className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSetOrientation('iso')}
                className="tech-transition px-2"
                disabled={isProcessing}
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
            <VerticalToolbar onToolSelect={handleToolSelect} />
          </aside>

          {/* Collapsible File Import Section */}
          <aside 
            className="border-r border-border/50 tech-glass flex flex-col overflow-hidden flex-shrink-0"
            style={{ 
              width: isFileImportCollapsed ? 48 : 320,
              transition: 'width 300ms ease-in-out'
            }}
          >
            <div className="p-2 border-b border-border/50 flex items-center justify-between flex-shrink-0">
              {!isFileImportCollapsed && (
                <h3 className="font-tech font-semibold text-sm whitespace-nowrap">File Import</h3>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = !isFileImportCollapsed;
                  setIsFileImportCollapsed(next);
                  setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    window.dispatchEvent(new CustomEvent('viewer-resize'));
                  }, 320);
                }}
                className={`w-8 h-8 p-0 tech-transition hover:bg-primary/10 hover:text-primary flex-shrink-0 ${isFileImportCollapsed ? 'mx-auto' : ''}`}
                title={isFileImportCollapsed ? 'Expand File Import' : 'Collapse File Import'}
              >
                {isFileImportCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            </div>

            {!isFileImportCollapsed && (
              <div className="flex-1 overflow-auto">
                {children && React.cloneElement(children as React.ReactElement, {
                  isInCollapsiblePanel: true
                })}
              </div>
            )}
          </aside>

          {/* Main Viewport - this is the only flex element */}
          <main className="flex-1 relative min-w-0">
            <ThreeDViewer
              currentFile={currentFile}
              isProcessing={isProcessing}
              onComponentPlaced={handleComponentPlaced}
            />

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
              width: isPropertiesCollapsed ? 48 : 250,
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
                {/* Part Properties Accordion - File Details and Transform controls */}
                <PartPropertiesAccordion hasModel={!!currentFile} currentFile={currentFile} />

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

        {/* Baseplate Selection Dialog */}
        <BaseplateDialog
          isOpen={isBaseplateDialogOpen}
          onOpenChange={setIsBaseplateDialogOpen}
          onBaseplateSelect={(type, option) => {
            window.dispatchEvent(new CustomEvent('create-baseplate', {
              detail: {
                type,
                option,
                dimensions: { padding: 10, height: 10 }
              }
            }));
            setIsBaseplateDialogOpen(false);
          }}
          currentBaseplate={currentBaseplate}
          onRemoveBaseplate={handleBaseplateRemoved}
        />

        {/* Supports Panel */}
        <SupportsPanel
          open={isSupportsOpen}
          onClose={() => {
            setIsSupportsOpen(false);
            window.dispatchEvent(new Event('supports-cancel-placement'));
          }}
        />
      </div>
    );
  }
);

AppShell.displayName = "AppShell";

export default AppShell;
