import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ProcessedFile } from "@/modules/FileImport/types";
import ThreeDScene from './3DScene';

interface ThreeDViewerProps {
  currentFile: ProcessedFile | null;
  isProcessing: boolean;
  onComponentPlaced?: (component: any, position: any) => void;
  onModelColorAssigned?: (modelId: string, color: string) => void;
}

const ThreeDViewer: React.FC<ThreeDViewerProps> = ({
  currentFile,
  isProcessing,
  onComponentPlaced,
  onModelColorAssigned,
}) => {
  // Store multiple imported parts
  const [importedParts, setImportedParts] = useState<ProcessedFile[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

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
    };

    const handlePartSelected = (e: CustomEvent<string>) => {
      setSelectedPartId(e.detail);
    };

    const handlePartRemoved = (e: CustomEvent<string>) => {
      const removedPartId = e.detail;
      setImportedParts(prev => prev.filter(p => p.id !== removedPartId));
      setSelectedPartId(prev => prev === removedPartId ? null : prev);
    };

    window.addEventListener('part-imported', handlePartImported as EventListener);
    window.addEventListener('file-imported', handleFileImported as EventListener);
    window.addEventListener('session-reset', handleSessionReset);
    window.addEventListener('part-selected', handlePartSelected as EventListener);
    window.addEventListener('part-removed', handlePartRemoved as EventListener);

    return () => {
      window.removeEventListener('part-imported', handlePartImported as EventListener);
      window.removeEventListener('file-imported', handleFileImported as EventListener);
      window.removeEventListener('session-reset', handleSessionReset);
      window.removeEventListener('part-selected', handlePartSelected as EventListener);
      window.removeEventListener('part-removed', handlePartRemoved as EventListener);
    };
  }, []);

  // Always use importedParts from event-based state for multi-part support
  const displayParts = importedParts;

  return (
    <div className="w-full h-full relative" onContextMenu={(e) => e.preventDefault()}>
      <Canvas
        orthographic
        camera={{
          position: [8, 8, 8], // Default isometric orthographic view
          zoom: 38,
          near: 0.1,
          far: 5000
        }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance"
        }}
        style={{ background: 'white' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <ThreeDScene
          importedParts={displayParts}
          selectedPartId={selectedPartId}
          onPartSelected={setSelectedPartId}
          onModelColorAssigned={onModelColorAssigned}
        />
      </Canvas>

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
    </div>
  );
};

export default ThreeDViewer;
