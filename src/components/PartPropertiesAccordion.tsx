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
import { Badge } from '@/components/ui/badge';
import { RotateCcw, Move, RotateCw, Box, X } from 'lucide-react';
import * as THREE from 'three';
import { ProcessedFile } from '@/modules/FileImport/types';
import SupportsAccordion from './Supports/SupportsAccordion';
import { AnySupport } from './Supports/types';
import PartThumbnail from './PartThumbnail';

interface PartTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // in degrees for UI
}

interface PartPropertiesAccordionProps {
  hasModel: boolean;
  currentFile?: ProcessedFile | null;
  importedParts?: ProcessedFile[];
  selectedPartId?: string | null;
  onPartSelect?: (partId: string | null) => void;
  onRemovePart?: (partId: string) => void;
  onClearFile?: () => void;
  supports?: AnySupport[];
  selectedSupportId?: string | null;
  onSupportSelect?: (id: string | null) => void;
  onSupportUpdate?: (support: AnySupport) => void;
  onSupportDelete?: (id: string) => void;
  modelColor?: string;
  modelColors?: Map<string, string>;
}

const PartPropertiesAccordion: React.FC<PartPropertiesAccordionProps> = ({ 
  hasModel, 
  currentFile,
  importedParts = [],
  selectedPartId,
  onPartSelect,
  onRemovePart,
  onClearFile,
  supports = [],
  selectedSupportId = null,
  onSupportSelect,
  onSupportUpdate,
  onSupportDelete,
  modelColor,
  modelColors = new Map()
}) => {
  // Map of partId -> transform (stores transforms for ALL parts)
  const [partTransforms, setPartTransforms] = useState<Map<string, PartTransform>>(new Map());
  
  // Track which parts we've initialized (to prevent re-requesting on every render)
  const initializedPartsRef = useRef<Set<string>>(new Set());

  // Convert radians to degrees for display
  const radToDeg = (rad: number) => (rad * 180) / Math.PI;
  // Convert degrees to radians for internal use
  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  // CAD Convention mapping: 
  // - CAD X = Three.js X (horizontal)
  // - CAD Y = Three.js Z (depth) 
  // - CAD Z = Three.js Y (vertical/up)
  
  // Get transform for a specific part (or return default)
  const getPartTransform = useCallback((partId: string): PartTransform => {
    return partTransforms.get(partId) || {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
  }, [partTransforms]);

  // Get CAD-style position for display (swap Y and Z)
  const getCadPosition = useCallback((partId: string) => {
    const transform = getPartTransform(partId);
    return {
      x: transform.position.x,
      y: transform.position.z,  // CAD Y = Three.js Z
      z: transform.position.y,  // CAD Z = Three.js Y
    };
  }, [getPartTransform]);
  
  // Get CAD-style rotation for display (swap Y and Z)
  const getCadRotation = useCallback((partId: string) => {
    const transform = getPartTransform(partId);
    return {
      x: transform.rotation.x,
      y: transform.rotation.z,  // CAD Y = Three.js Z
      z: transform.rotation.y,  // CAD Z = Three.js Y
    };
  }, [getPartTransform]);

  // Listen for transform updates from the 3D scene (handles ALL parts via partId)
  useEffect(() => {
    const handleTransformUpdate = (e: CustomEvent) => {
      const { position, rotation, partId } = e.detail;
      
      // If no partId in event, ignore (should not happen with proper emit)
      if (!partId || !position) return;
      
      const newTransform = {
        position: {
          x: parseFloat(position.x.toFixed(2)),
          y: parseFloat(position.y.toFixed(2)),
          z: parseFloat(position.z.toFixed(2)),
        },
        rotation: {
          x: parseFloat(radToDeg(rotation?.x || 0).toFixed(1)),
          y: parseFloat(radToDeg(rotation?.y || 0).toFixed(1)),
          z: parseFloat(radToDeg(rotation?.z || 0).toFixed(1)),
        },
      };
      
      // Store transform for this specific part
      setPartTransforms(prev => {
        const newMap = new Map(prev);
        newMap.set(partId, newTransform);
        return newMap;
      });
    };

    window.addEventListener('model-transform-updated', handleTransformUpdate as EventListener);
    return () => {
      window.removeEventListener('model-transform-updated', handleTransformUpdate as EventListener);
    };
  }, []);

  // Request transforms for parts that we haven't initialized yet
  useEffect(() => {
    // Build list of all parts (importedParts or fallback to currentFile)
    const allParts = importedParts.length > 0 
      ? importedParts 
      : (currentFile ? [currentFile] : []);
    
    allParts.forEach(part => {
      if (!initializedPartsRef.current.has(part.id)) {
        initializedPartsRef.current.add(part.id);
        
        // Request transform after a delay to allow mesh to mount
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('request-model-transform', {
            detail: { partId: part.id }
          }));
        }, 150);
      }
    });
    
    // Clean up parts that no longer exist
    const currentPartIds = new Set(allParts.map(p => p.id));
    initializedPartsRef.current.forEach(id => {
      if (!currentPartIds.has(id)) {
        initializedPartsRef.current.delete(id);
        setPartTransforms(prev => {
          const newMap = new Map(prev);
          newMap.delete(id);
          return newMap;
        });
      }
    });
  }, [importedParts, currentFile]);

  // Dispatch transform change to 3D scene for a specific part
  const dispatchTransformChange = useCallback((partId: string, newTransform: PartTransform) => {
    window.dispatchEvent(
      new CustomEvent('set-model-transform', {
        detail: {
          partId,
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

  // Handle position change for a specific part - cadAxis is what UI shows, map to Three.js axis
  const handlePositionChange = useCallback((partId: string, cadAxis: 'x' | 'y' | 'z', value: string) => {
    const numValue = parseFloat(value) || 0;
    // Map CAD axis to Three.js axis: X->X, Y->Z, Z->Y
    const threeAxis = cadAxis === 'y' ? 'z' : cadAxis === 'z' ? 'y' : 'x';
    const currentTransform = getPartTransform(partId);
    const newTransform = {
      ...currentTransform,
      position: { ...currentTransform.position, [threeAxis]: numValue },
    };
    setPartTransforms(prev => new Map(prev).set(partId, newTransform));
    dispatchTransformChange(partId, newTransform);
  }, [getPartTransform, dispatchTransformChange]);

  // Handle rotation change for a specific part - cadAxis is what UI shows, map to Three.js axis
  const handleRotationChange = useCallback((partId: string, cadAxis: 'x' | 'y' | 'z', value: string) => {
    const numValue = parseFloat(value) || 0;
    // Map CAD axis to Three.js axis: X->X, Y->Z, Z->Y
    const threeAxis = cadAxis === 'y' ? 'z' : cadAxis === 'z' ? 'y' : 'x';
    const currentTransform = getPartTransform(partId);
    const newTransform = {
      ...currentTransform,
      rotation: { ...currentTransform.rotation, [threeAxis]: numValue },
    };
    setPartTransforms(prev => new Map(prev).set(partId, newTransform));
    dispatchTransformChange(partId, newTransform);
  }, [getPartTransform, dispatchTransformChange]);

  // Reset position to origin (0, 0, 0) for a specific part
  const handleResetPosition = useCallback((partId: string) => {
    const currentTransform = getPartTransform(partId);
    const newTransform = {
      ...currentTransform,
      position: { x: 0, y: 0, z: 0 },
    };
    setPartTransforms(prev => new Map(prev).set(partId, newTransform));
    dispatchTransformChange(partId, newTransform);
  }, [getPartTransform, dispatchTransformChange]);

  // Reset rotation to zero (0, 0, 0) for a specific part
  const handleResetRotation = useCallback((partId: string) => {
    const currentTransform = getPartTransform(partId);
    const newTransform = {
      ...currentTransform,
      rotation: { x: 0, y: 0, z: 0 },
    };
    setPartTransforms(prev => new Map(prev).set(partId, newTransform));
    dispatchTransformChange(partId, newTransform);
  }, [getPartTransform, dispatchTransformChange]);

  if (!hasModel) {
    return null;
  }

  // Get all parts to display (use importedParts if available, otherwise currentFile)
  const allParts = importedParts.length > 0 ? importedParts : (currentFile ? [currentFile] : []);

  return (
    <Accordion type="single" collapsible defaultValue="parts" className="w-full">
      {/* Parts Accordion */}
      {allParts.length > 0 && (
        <AccordionItem value="parts" className="border-border/50">
          <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
            <div className="flex items-center gap-2">
              <Box className="w-3.5 h-3.5 text-primary" />
              Parts
              <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
                {allParts.length}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2">
            {/* Nested Accordion for each part */}
            <Accordion 
              type="single" 
              collapsible 
              value={selectedPartId ? `part-${selectedPartId}` : ""}
              onValueChange={(val) => {
                const partId = val?.replace('part-', '') || null;
                onPartSelect?.(partId);
              }}
              className="space-y-1"
            >
              {allParts.map((part) => {
                const partColor = modelColors.get(part.metadata.name) || modelColor;
                const cadPosition = getCadPosition(part.id);
                const cadRotation = getCadRotation(part.id);
                
                return (
                  <AccordionItem 
                    key={part.id}
                    value={`part-${part.id}`}
                    className="border rounded-md border-border/30"
                  >
                    <AccordionTrigger className="py-1.5 px-2 text-xs font-tech hover:no-underline">
                      <div className="flex items-center gap-2 flex-1">
                        <PartThumbnail 
                          mesh={part.mesh} 
                          size={28} 
                          className="flex-shrink-0 border border-border/30"
                          color={partColor}
                        />
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-tech font-medium text-[10px] truncate" title={part.metadata.name}>
                            {part.metadata.name}
                          </p>
                          <p className="text-[8px] text-muted-foreground">
                            {part.metadata.triangles?.toLocaleString()} tri • {part.metadata.units}
                          </p>
                        </div>
                        {(onRemovePart || onClearFile) && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              if (onRemovePart) {
                                onRemovePart(part.id);
                              } else if (onClearFile) {
                                onClearFile();
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                e.preventDefault();
                                if (onRemovePart) {
                                  onRemovePart(part.id);
                                } else if (onClearFile) {
                                  onClearFile();
                                }
                              }
                            }}
                            className="w-6 h-6 p-0 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                            title="Remove part"
                          >
                            <X className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-2 pb-2">
                      {/* Part Info */}
                      <div className="text-[8px] text-muted-foreground font-tech mb-3 p-2 rounded bg-muted/30">
                        <span>Size: </span>
                        <span className="font-mono">
                          {part.metadata.dimensions.x.toFixed(1)} ×{' '}
                          {part.metadata.dimensions.z.toFixed(1)} ×{' '}
                          {part.metadata.dimensions.y.toFixed(1)} {part.metadata.units}
                        </span>
                      </div>

                      {/* Position & Rotation Controls */}
                      <div className="space-y-3">
                        {/* Position Controls */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
                              <Move className="w-2.5 h-2.5" />
                              Position (mm)
                            </Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResetPosition(part.id)}
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
                                value={cadPosition.x.toFixed(2)}
                                onChange={(e) => handlePositionChange(part.id, 'x', e.target.value)}
                                className="h-7 !text-[10px] font-mono"
                                step="0.1"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[8px] text-green-500 font-mono">Y</Label>
                              <Input
                                type="number"
                                value={cadPosition.y.toFixed(2)}
                                onChange={(e) => handlePositionChange(part.id, 'y', e.target.value)}
                                className="h-7 !text-[10px] font-mono"
                                step="0.1"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[8px] text-blue-500 font-mono">Z</Label>
                              <Input
                                type="number"
                                value={cadPosition.z.toFixed(2)}
                                onChange={(e) => handlePositionChange(part.id, 'z', e.target.value)}
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
                              Rotation (°)
                            </Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResetRotation(part.id)}
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
                                value={cadRotation.x.toFixed(1)}
                                onChange={(e) => handleRotationChange(part.id, 'x', e.target.value)}
                                className="h-7 !text-[10px] font-mono"
                                step="1"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[8px] text-green-500 font-mono">Y</Label>
                              <Input
                                type="number"
                                value={cadRotation.y.toFixed(1)}
                                onChange={(e) => handleRotationChange(part.id, 'y', e.target.value)}
                                className="h-7 !text-[10px] font-mono"
                                step="1"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[8px] text-blue-500 font-mono">Z</Label>
                              <Input
                                type="number"
                                value={cadRotation.z.toFixed(1)}
                                onChange={(e) => handleRotationChange(part.id, 'z', e.target.value)}
                                className="h-7 !text-[10px] font-mono"
                                step="1"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
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
