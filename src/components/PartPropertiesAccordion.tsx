import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RotateCcw, Move, RotateCw, Box, Info, ToggleLeft, ToggleRight, X } from 'lucide-react';
import * as THREE from 'three';
import { ProcessedFile } from '@/modules/FileImport/types';
import SupportsAccordion from './Supports/SupportsAccordion';
import { AnySupport } from './Supports/types';
import PartThumbnail from './PartThumbnail';

interface PartTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // in degrees for UI
}

type PositioningMode = 'absolute' | 'incremental';

interface PartPropertiesAccordionProps {
  hasModel: boolean;
  currentFile?: ProcessedFile | null;
  onClearFile?: () => void;
  supports?: AnySupport[];
  selectedSupportId?: string | null;
  onSupportSelect?: (id: string | null) => void;
  onSupportUpdate?: (support: AnySupport) => void;
  onSupportDelete?: (id: string) => void;
  modelColor?: string;
}

const PartPropertiesAccordion: React.FC<PartPropertiesAccordionProps> = ({ 
  hasModel, 
  currentFile,
  onClearFile,
  supports = [],
  selectedSupportId = null,
  onSupportSelect,
  onSupportUpdate,
  onSupportDelete,
  modelColor
}) => {
  // Current transform (what's displayed in the UI)
  const [transform, setTransform] = useState<PartTransform>({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });

  // Positioning mode: absolute (wrt original) or incremental (wrt last position)
  const [positioningMode, setPositioningMode] = useState<PositioningMode>('absolute');

  // Original transform - captured when model is first loaded
  const originalTransformRef = useRef<PartTransform>({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });
  
  // Last incremental position - updated when switching to incremental mode or after restore
  const lastIncrementalTransformRef = useRef<PartTransform>({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });
  
  // Flag to track if we've captured the original transform
  const hasOriginalTransformRef = useRef(false);

  // Convert radians to degrees for display
  const radToDeg = (rad: number) => (rad * 180) / Math.PI;
  // Convert degrees to radians for internal use
  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  // CAD Convention mapping: 
  // - CAD X = Three.js X (horizontal)
  // - CAD Y = Three.js Z (depth) 
  // - CAD Z = Three.js Y (vertical/up)
  // So in UI we display: X, Y (internally Z), Z (internally Y)
  
  // Get CAD-style position for display (swap Y and Z)
  const getCadPosition = () => ({
    x: transform.position.x,
    y: transform.position.z,  // CAD Y = Three.js Z
    z: transform.position.y,  // CAD Z = Three.js Y
  });
  
  // Get CAD-style rotation for display (swap Y and Z)
  const getCadRotation = () => ({
    x: transform.rotation.x,
    y: transform.rotation.z,  // CAD Y = Three.js Z
    z: transform.rotation.y,  // CAD Z = Three.js Y
  });

  // Listen for transform updates from the 3D scene
  useEffect(() => {
    const handleTransformUpdate = (e: CustomEvent) => {
      const { position, rotation } = e.detail;
      const newTransform = {
        position: {
          x: parseFloat(position.x.toFixed(2)),
          y: parseFloat(position.y.toFixed(2)),
          z: parseFloat(position.z.toFixed(2)),
        },
        rotation: {
          x: parseFloat(radToDeg(rotation.x).toFixed(1)),
          y: parseFloat(radToDeg(rotation.y).toFixed(1)),
          z: parseFloat(radToDeg(rotation.z).toFixed(1)),
        },
      };
      
      // Capture original transform on first update
      if (!hasOriginalTransformRef.current) {
        originalTransformRef.current = { ...newTransform };
        lastIncrementalTransformRef.current = { ...newTransform };
        hasOriginalTransformRef.current = true;
      }
      
      setTransform(newTransform);
    };

    window.addEventListener('model-transform-updated', handleTransformUpdate as EventListener);
    
    // Request initial transform state
    window.dispatchEvent(new CustomEvent('request-model-transform'));

    return () => {
      window.removeEventListener('model-transform-updated', handleTransformUpdate as EventListener);
    };
  }, []);

  // Reset original transform when file changes
  useEffect(() => {
    if (currentFile) {
      hasOriginalTransformRef.current = false;
    }
  }, [currentFile]);

  // Dispatch transform change to 3D scene
  const dispatchTransformChange = useCallback((newTransform: PartTransform) => {
    window.dispatchEvent(
      new CustomEvent('set-model-transform', {
        detail: {
          position: new THREE.Vector3(
            newTransform.position.x,
            newTransform.position.y,
            newTransform.position.z
          ),
          rotation: new THREE.Euler(
            degToRad(newTransform.rotation.x),
            degToRad(newTransform.rotation.y),
            degToRad(newTransform.rotation.z)
          ),
        },
      })
    );
  }, []);

  // Handle position change - cadAxis is what UI shows, map to Three.js axis
  const handlePositionChange = (cadAxis: 'x' | 'y' | 'z', value: string) => {
    const numValue = parseFloat(value) || 0;
    // Map CAD axis to Three.js axis: X->X, Y->Z, Z->Y
    const threeAxis = cadAxis === 'y' ? 'z' : cadAxis === 'z' ? 'y' : 'x';
    const newTransform = {
      ...transform,
      position: { ...transform.position, [threeAxis]: numValue },
    };
    setTransform(newTransform);
    dispatchTransformChange(newTransform);
  };

  // Handle rotation change - cadAxis is what UI shows, map to Three.js axis
  const handleRotationChange = (cadAxis: 'x' | 'y' | 'z', value: string) => {
    const numValue = parseFloat(value) || 0;
    // Map CAD axis to Three.js axis: X->X, Y->Z, Z->Y
    const threeAxis = cadAxis === 'y' ? 'z' : cadAxis === 'z' ? 'y' : 'x';
    const newTransform = {
      ...transform,
      rotation: { ...transform.rotation, [threeAxis]: numValue },
    };
    setTransform(newTransform);
    dispatchTransformChange(newTransform);
  };

  // Reset position to origin (0, 0, 0)
  const handleResetPosition = () => {
    const resetPosition = { x: 0, y: 0, z: 0 };
    const newTransform = {
      ...transform,
      position: resetPosition,
    };
    setTransform(newTransform);
    dispatchTransformChange(newTransform);
  };

  // Reset rotation to zero (0, 0, 0)
  const handleResetRotation = () => {
    const resetRotation = { x: 0, y: 0, z: 0 };
    const newTransform = {
      ...transform,
      rotation: resetRotation,
    };
    setTransform(newTransform);
    dispatchTransformChange(newTransform);
  };

  // Handle mode toggle
  const handleModeToggle = () => {
    if (positioningMode === 'absolute') {
      // Switching to incremental: save current position as the new baseline
      lastIncrementalTransformRef.current = { ...transform };
      setPositioningMode('incremental');
    } else {
      // Switching to absolute
      setPositioningMode('absolute');
    }
  };

  // Restore based on mode - dispatches restore event to 3D scene
  const handleRestore = () => {
    let targetTransform: PartTransform;
    
    if (positioningMode === 'absolute') {
      // Restore to original transform (0,0,0 since that's the initial state)
      targetTransform = originalTransformRef.current;
    } else {
      // Restore to last incremental position
      targetTransform = lastIncrementalTransformRef.current;
    }
    
    // Dispatch restore event with THREE.js types
    window.dispatchEvent(
      new CustomEvent('restore-model-transform', {
        detail: {
          position: new THREE.Vector3(
            targetTransform.position.x,
            targetTransform.position.y,
            targetTransform.position.z
          ),
          rotation: new THREE.Euler(
            degToRad(targetTransform.rotation.x),
            degToRad(targetTransform.rotation.y),
            degToRad(targetTransform.rotation.z)
          ),
        },
      })
    );
  };

  // Get display values based on mode
  const getDisplayPosition = () => {
    const cadPos = getCadPosition();
    if (positioningMode === 'incremental') {
      // Show delta from last incremental position
      // lastIncrementalTransformRef stores in Three.js coordinates, we need to convert to CAD
      const lastPos = lastIncrementalTransformRef.current.position;
      const lastCadPos = {
        x: lastPos.x,
        y: lastPos.z,  // CAD Y = Three.js Z
        z: lastPos.y,  // CAD Z = Three.js Y
      };
      return {
        x: parseFloat((cadPos.x - lastCadPos.x).toFixed(2)),
        y: parseFloat((cadPos.y - lastCadPos.y).toFixed(2)),
        z: parseFloat((cadPos.z - lastCadPos.z).toFixed(2)),
      };
    }
    return cadPos;
  };

  const getDisplayRotation = () => {
    const cadRot = getCadRotation();
    if (positioningMode === 'incremental') {
      // Show delta from last incremental rotation
      const lastRot = lastIncrementalTransformRef.current.rotation;
      const lastCadRot = {
        x: lastRot.x,
        y: lastRot.z,  // CAD Y = Three.js Z
        z: lastRot.y,  // CAD Z = Three.js Y
      };
      return {
        x: parseFloat((cadRot.x - lastCadRot.x).toFixed(1)),
        y: parseFloat((cadRot.y - lastCadRot.y).toFixed(1)),
        z: parseFloat((cadRot.z - lastCadRot.z).toFixed(1)),
      };
    }
    return cadRot;
  };

  // Handle position change with mode awareness
  const handlePositionChangeWithMode = (cadAxis: 'x' | 'y' | 'z', value: string) => {
    const numValue = parseFloat(value) || 0;
    
    if (positioningMode === 'incremental') {
      // Value is delta from last position, calculate absolute
      const lastPos = lastIncrementalTransformRef.current.position;
      // Convert last position to CAD coordinates first
      const lastCadPos = {
        x: lastPos.x,
        y: lastPos.z,  // CAD Y = Three.js Z
        z: lastPos.y,  // CAD Z = Three.js Y
      };
      
      // Calculate new CAD position
      const newCadPos = { ...getCadPosition() };
      newCadPos[cadAxis] = lastCadPos[cadAxis] + numValue;
      
      // Convert back to Three.js coordinates
      const newTransform = {
        ...transform,
        position: {
          x: newCadPos.x,
          y: newCadPos.z,  // Three.js Y = CAD Z
          z: newCadPos.y,  // Three.js Z = CAD Y
        },
      };
      setTransform(newTransform);
      dispatchTransformChange(newTransform);
    } else {
      // Absolute mode - use existing handler
      handlePositionChange(cadAxis, value);
    }
  };

  // Handle rotation change with mode awareness
  const handleRotationChangeWithMode = (cadAxis: 'x' | 'y' | 'z', value: string) => {
    const numValue = parseFloat(value) || 0;
    
    if (positioningMode === 'incremental') {
      // Value is delta from last rotation, calculate absolute
      const lastRot = lastIncrementalTransformRef.current.rotation;
      // Convert last rotation to CAD coordinates first
      const lastCadRot = {
        x: lastRot.x,
        y: lastRot.z,  // CAD Y = Three.js Z
        z: lastRot.y,  // CAD Z = Three.js Y
      };
      
      // Calculate new CAD rotation
      const newCadRot = { ...getCadRotation() };
      newCadRot[cadAxis] = lastCadRot[cadAxis] + numValue;
      
      // Convert back to Three.js coordinates
      const newTransform = {
        ...transform,
        rotation: {
          x: newCadRot.x,
          y: newCadRot.z,  // Three.js Y = CAD Z
          z: newCadRot.y,  // Three.js Z = CAD Y
        },
      };
      setTransform(newTransform);
      dispatchTransformChange(newTransform);
    } else {
      // Absolute mode - use existing handler
      handleRotationChange(cadAxis, value);
    }
  };

  if (!hasModel) {
    return null;
  }

  // Helper function to format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Helper function to format dimensions
  const formatDimension = (value: number) => value.toFixed(2);

  return (
    <Accordion type="single" collapsible defaultValue="parts" className="w-full">
      {/* Parts Accordion */}
      {currentFile && (
        <AccordionItem value="parts" className="border-border/50">
          <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
            <div className="flex items-center gap-2">
              <Box className="w-3.5 h-3.5 text-primary" />
              Parts
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2">
            {/* Nested Accordion for each part */}
            <Accordion type="single" collapsible defaultValue={`part-${currentFile.metadata.name}`} className="space-y-1">
              <AccordionItem 
                value={`part-${currentFile.metadata.name}`}
                className="border rounded-md border-border/30"
              >
                <AccordionTrigger className="py-1.5 px-2 text-xs font-tech hover:no-underline">
                  <div className="flex items-center gap-2 flex-1">
                    <PartThumbnail 
                      mesh={currentFile.mesh} 
                      size={28} 
                      className="flex-shrink-0 border border-border/30"
                      color={modelColor}
                    />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-tech font-medium text-[10px] truncate" title={currentFile.metadata.name}>
                        {currentFile.metadata.name}
                      </p>
                      <p className="text-[8px] text-muted-foreground">
                        {currentFile.metadata.triangles?.toLocaleString()} tri • {currentFile.metadata.units}
                      </p>
                    </div>
                    {onClearFile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClearFile();
                        }}
                        className="w-6 h-6 p-0 text-muted-foreground hover:text-destructive"
                        title="Remove part"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-2 pb-2">
                  {/* Part Info */}
                  <div className="text-[8px] text-muted-foreground font-tech mb-3 p-2 rounded bg-muted/30">
                    <span>Size: </span>
                    <span className="font-mono">
                      {currentFile.metadata.dimensions.x.toFixed(1)} ×{' '}
                      {currentFile.metadata.dimensions.z.toFixed(1)} ×{' '}
                      {currentFile.metadata.dimensions.y.toFixed(1)} {currentFile.metadata.units}
                    </span>
                  </div>

                  {/* Position & Rotation Controls */}
                  <div className="space-y-3">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between border-b border-border/30 pb-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleModeToggle}
                          className="h-5 px-1.5 text-[8px] gap-1"
                          title={`Switch to ${positioningMode === 'absolute' ? 'incremental' : 'absolute'} mode`}
                        >
                          {positioningMode === 'absolute' ? (
                            <ToggleLeft className="w-3.5 h-3.5" />
                          ) : (
                            <ToggleRight className="w-3.5 h-3.5 text-primary" />
                          )}
                          <span className={positioningMode === 'incremental' ? 'text-primary font-medium' : ''}>
                            {positioningMode === 'absolute' ? 'Absolute' : 'Incremental'}
                          </span>
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRestore}
                        className="h-5 px-1.5 text-[8px] gap-1"
                        title={positioningMode === 'absolute' 
                          ? 'Restore to original position' 
                          : 'Restore to last incremental position'}
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Restore
                      </Button>
                    </div>

                    {/* Position Controls */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
                          <Move className="w-2.5 h-2.5" />
                          Position (mm){positioningMode === 'incremental' && ' Δ'}
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleResetPosition}
                          className="h-5 px-1.5 text-[8px]"
                          title="Reset position to zero"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pl-1">
                        <div className="space-y-1">
                          <Label className="text-[8px] text-red-500 font-mono">X</Label>
                          <Input
                            type="number"
                            value={getDisplayPosition().x}
                            onChange={(e) => handlePositionChangeWithMode('x', e.target.value)}
                            className="h-7 !text-[10px] font-mono"
                            step="0.1"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-green-500 font-mono">Y</Label>
                          <Input
                            type="number"
                            value={getDisplayPosition().y}
                            onChange={(e) => handlePositionChangeWithMode('y', e.target.value)}
                            className="h-7 !text-[10px] font-mono"
                            step="0.1"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-blue-500 font-mono">Z</Label>
                          <Input
                            type="number"
                            value={getDisplayPosition().z}
                            onChange={(e) => handlePositionChangeWithMode('z', e.target.value)}
                            className="h-7 !text-[10px] font-mono"
                            step="0.1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rotation Controls */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
                          <RotateCw className="w-2.5 h-2.5" />
                          Rotation (°){positioningMode === 'incremental' && ' Δ'}
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleResetRotation}
                          className="h-5 px-1.5 text-[8px]"
                          title="Reset rotation to zero"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pl-1">
                        <div className="space-y-1">
                          <Label className="text-[8px] text-red-500 font-mono">X</Label>
                          <Input
                            type="number"
                            value={getDisplayRotation().x}
                            onChange={(e) => handleRotationChangeWithMode('x', e.target.value)}
                            className="h-7 !text-[10px] font-mono"
                            step="1"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-green-500 font-mono">Y</Label>
                          <Input
                            type="number"
                            value={getDisplayRotation().y}
                            onChange={(e) => handleRotationChangeWithMode('y', e.target.value)}
                            className="h-7 !text-[10px] font-mono"
                            step="1"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-blue-500 font-mono">Z</Label>
                          <Input
                            type="number"
                            value={getDisplayRotation().z}
                            onChange={(e) => handleRotationChangeWithMode('z', e.target.value)}
                            className="h-7 !text-[10px] font-mono"
                            step="1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Supports Accordion */}
      <SupportsAccordion
        supports={supports}
        selectedSupportId={selectedSupportId}
        onSupportSelect={onSupportSelect || (() => {})}
        onSupportUpdate={onSupportUpdate || (() => {})}
        onSupportDelete={onSupportDelete || (() => {})}
      />
    </Accordion>
  );
};

export default PartPropertiesAccordion;
