import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ProcessedFile } from "@/modules/FileImport/types";
import ThreeDScene from './3DScene';
import * as THREE from 'three';

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
  const [internalFile, setInternalFile] = useState<ProcessedFile | null>(null);
  const [modelTransform, setModelTransform] = useState<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  }>({
    position: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0),
    scale: new THREE.Vector3(1, 1, 1)
  });

  // Listen for file-imported events from the context panel
  useEffect(() => {
    const handleFileImported = (e: CustomEvent<ProcessedFile>) => {
      setInternalFile(e.detail);
    };

    const handleSessionReset = () => {
      setInternalFile(null);
    };

    window.addEventListener('file-imported', handleFileImported as EventListener);
    window.addEventListener('session-reset', handleSessionReset);

    return () => {
      window.removeEventListener('file-imported', handleFileImported as EventListener);
      window.removeEventListener('session-reset', handleSessionReset);
    };
  }, []);

  // Use prop file if provided, otherwise use internal file
  const displayFile = currentFile || internalFile;

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
          currentFile={displayFile}
          modelTransform={modelTransform}
          setModelTransform={setModelTransform}
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
      {!displayFile && !isProcessing && (
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
