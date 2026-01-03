import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ProcessedFile } from "@/modules/FileImport/types";
import ThreeDScene from './3DScene';
import { Canvas3DErrorBoundary } from './ErrorBoundary';
import { useTheme } from 'next-themes';
import { 
  initPerformanceSettings, 
  getPerformanceSettings, 
  PerformanceSettings 
} from '@/utils/performanceSettings';
import { NavigationHelp } from '@rapidtool/cad-ui';

interface ThreeDViewerProps {
  currentFile: ProcessedFile | null;
  isProcessing: boolean;
  onComponentPlaced?: (component: any, position: any) => void;
  onModelColorAssigned?: (modelId: string, color: string) => void;
  selectedSupportId?: string | null;
  onSupportSelect?: (supportId: string | null) => void;
  isCavityApplied?: boolean;
}

const ThreeDViewer: React.FC<ThreeDViewerProps> = ({
  currentFile,
  isProcessing,
  onComponentPlaced,
  onModelColorAssigned,
  selectedSupportId,
  onSupportSelect,
  isCavityApplied = false,
}) => {
  // Theme for 3D viewer background
  const { resolvedTheme } = useTheme();
  
  // Performance settings for device optimization
  const [perfSettings, setPerfSettings] = useState<PerformanceSettings>(() => 
    initPerformanceSettings('auto')
  );
  
  // Store multiple imported parts
  const [importedParts, setImportedParts] = useState<ProcessedFile[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [partVisibility, setPartVisibility] = useState<Map<string, boolean>>(new Map());
  const [baseplateVisible, setBaseplateVisible] = useState(true);

  // Listen for part-imported events from the context panel (new multi-part system)
  useEffect(() => {
    const handlePartImported = (e: CustomEvent<ProcessedFile>) => {
      setImportedParts(prev => [...prev, e.detail]);
      setSelectedPartId(e.detail.id);
    };

    // Legacy single-file import support
    const handleFileImported = (e: CustomEvent<ProcessedFile>) => {
      // Only use this if the file doesn't have an ID (legacy)
      if (!e.detail.id) {
        const legacyPart = {
          ...e.detail,
          id: `legacy-${Date.now()}`
        };
        setImportedParts([legacyPart]);
        setSelectedPartId(legacyPart.id);
      }
    };

    const handleSessionReset = () => {
      setImportedParts([]);
      setSelectedPartId(null);
      setPartVisibility(new Map());
    };

    const handlePartSelected = (e: CustomEvent<string>) => {
      setSelectedPartId(e.detail);
    };

    const handlePartRemoved = (e: CustomEvent<string>) => {
      const removedPartId = e.detail;
      setImportedParts(prev => prev.filter(p => p.id !== removedPartId));
      setSelectedPartId(prev => prev === removedPartId ? null : prev);
      setPartVisibility(prev => {
        const newMap = new Map(prev);
        newMap.delete(removedPartId);
        return newMap;
      });
    };

    const handlePartVisibilityChanged = (e: CustomEvent<{ partId: string; visible: boolean }>) => {
      const { partId, visible } = e.detail;
      setPartVisibility(prev => new Map(prev).set(partId, visible));
    };

    const handleBaseplateVisibilityChanged = (e: CustomEvent<{ visible: boolean }>) => {
      setBaseplateVisible(e.detail.visible);
    };

    const handlePerformanceChanged = (e: CustomEvent<{ settings: PerformanceSettings }>) => {
      setPerfSettings(e.detail.settings);
    };

    window.addEventListener('part-imported', handlePartImported as EventListener);
    window.addEventListener('file-imported', handleFileImported as EventListener);
    window.addEventListener('session-reset', handleSessionReset);
    window.addEventListener('part-selected', handlePartSelected as EventListener);
    window.addEventListener('part-removed', handlePartRemoved as EventListener);
    window.addEventListener('part-visibility-changed', handlePartVisibilityChanged as EventListener);
    window.addEventListener('baseplate-visibility-changed', handleBaseplateVisibilityChanged as EventListener);
    window.addEventListener('performance-settings-changed', handlePerformanceChanged as EventListener);

    return () => {
      window.removeEventListener('part-imported', handlePartImported as EventListener);
      window.removeEventListener('file-imported', handleFileImported as EventListener);
      window.removeEventListener('session-reset', handleSessionReset);
      window.removeEventListener('part-selected', handlePartSelected as EventListener);
      window.removeEventListener('part-removed', handlePartRemoved as EventListener);
      window.removeEventListener('part-visibility-changed', handlePartVisibilityChanged as EventListener);
      window.removeEventListener('baseplate-visibility-changed', handleBaseplateVisibilityChanged as EventListener);
      window.removeEventListener('performance-settings-changed', handlePerformanceChanged as EventListener);
    };
  }, []);

  // Always use importedParts from event-based state for multi-part support
  const displayParts = importedParts;
  
  // Dark/light theme colors for the 3D viewer background
  const viewerBackground = resolvedTheme === 'dark' ? '#1a1a2e' : '#ffffff';

  return (
    <div className="w-full h-full relative" onContextMenu={(e) => e.preventDefault()}>
      <Canvas3DErrorBoundary name="3DViewer">
        <Canvas
          orthographic
          camera={{
            position: [8, 8, 8], // Default isometric orthographic view
            zoom: 38,
            near: 0.1,
            far: 5000
          }}
          dpr={perfSettings.pixelRatio}
          frameloop={perfSettings.frameRateLimit ? 'demand' : 'always'}
          gl={{
            antialias: perfSettings.antialias,
            alpha: true,
            powerPreference: perfSettings.pixelRatio < 1.5 ? "low-power" : "high-performance"
          }}
          shadows={perfSettings.shadowsEnabled}
          style={{ background: viewerBackground }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <ThreeDScene
            importedParts={displayParts}
            selectedPartId={selectedPartId}
            onPartSelected={setSelectedPartId}
            onModelColorAssigned={onModelColorAssigned}
            partVisibility={partVisibility}
            baseplateVisible={baseplateVisible}
            isDarkMode={resolvedTheme === 'dark'}
            selectedSupportId={selectedSupportId}
            onSupportSelect={onSupportSelect}
            performanceSettings={perfSettings}
            isCavityApplied={isCavityApplied}
          />
        </Canvas>
      </Canvas3DErrorBoundary>

      {/* Processing overlay */}
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

      {/* Empty state */}
      {displayParts.length === 0 && !isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center tech-glass p-6 rounded-lg border border-border/50">
            <h3 className="font-tech font-semibold text-lg mb-2">3D Viewer</h3>
            <p className="text-sm text-muted-foreground font-tech">
              Upload a 3D model to start designing fixtures
            </p>
          </div>
        </div>
      )}

      {/* Navigation help tooltip */}
      <NavigationHelp storageKey="fixture-view-nav-tooltip-dismissed" />
    </div>
  );
};

export default ThreeDViewer;
