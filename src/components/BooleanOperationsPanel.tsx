import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Minus,
  Plus,
  RotateCcw,
  Settings,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  ArrowUpRight
} from 'lucide-react';
import * as THREE from 'three';
import { CSGEngine, FixtureNegative, csgUtils } from '@/lib/csgEngine';

interface BooleanOperationsPanelProps {
  baseMesh: THREE.Mesh | null;
  fixtureComponents: THREE.Mesh[];
  onOperationComplete?: (resultMesh: THREE.Mesh) => void;
  onNegativeCreate?: (negative: FixtureNegative) => void;
  className?: string;
}

interface OperationState {
  type: 'subtract' | 'intersect' | 'union';
  depth: number;
  angle: number;
  offset: number;
  removalDirection: THREE.Vector3;
  preview: boolean;
  useModel: boolean;
  useSupports: 'none' | 'all';
  useAdvancedOffset: boolean;
  qualityPreset: 'fast' | 'balanced' | 'high';
  pixelsPerUnit: number;
  rotationXZ: number;
  rotationYZ: number;
}

const BooleanOperationsPanel: React.FC<BooleanOperationsPanelProps> = ({
  baseMesh,
  fixtureComponents,
  onOperationComplete,
  onNegativeCreate,
  className = ''
}) => {
  const [operationState, setOperationState] = useState<OperationState>({
    type: 'subtract',
    depth: 2,
    angle: 0,
    offset: 0.5,
    removalDirection: new THREE.Vector3(0, -1, 0),
    preview: false,
    useModel: true,
    useSupports: 'all',
    // Default to classic trimming (no GPU offset). Users can opt in to
    // GPU Advanced Offset when they specifically need it.
    useAdvancedOffset: false,
    qualityPreset: 'balanced',
    // Lighter default GPU config when it is enabled.
    pixelsPerUnit: 8,
    rotationXZ: 0,
    rotationYZ: 0
  });

  const [createdNegatives, setCreatedNegatives] = useState<FixtureNegative[]>([]);
  const [selectedNegative, setSelectedNegative] = useState<string | null>(null);

  const csgEngine = new CSGEngine();

  const handleOperationTypeChange = (type: 'subtract' | 'intersect' | 'union') => {
    setOperationState(prev => ({ ...prev, type }));
  };

  const handleApply = () => {
    // For now we focus solely on trimming supports, not updating the base cavity here.
    // Notify the scene that supports should be trimmed using the current boolean parameters.
    // ThreeDScene will interpret this as: for each support, treat it as the target and use the
    // model (and optionally other cutters) as tools, applying the same depth/offset/direction.
    window.dispatchEvent(new CustomEvent('supports-trim-request', {
      detail: {
        depth: operationState.depth,
        offset: operationState.offset,
        removalDirection: operationState.removalDirection,
        useModel: operationState.useModel,
        useSupports: operationState.useSupports,
        useAdvancedOffset: operationState.useAdvancedOffset,
        advancedOffsetOptions: {
          offsetDistance: Math.abs(operationState.offset) || 0.2,
          pixelsPerUnit: operationState.pixelsPerUnit,
          rotationXZ: operationState.rotationXZ,
          rotationYZ: operationState.rotationYZ
        }
      }
    }));
  };

  const handleParameterChange = (parameter: keyof OperationState, value: any) => {
    setOperationState(prev => ({ ...prev, [parameter]: value }));
  };

  const applyQualityPreset = (preset: 'fast' | 'balanced' | 'high') => {
    switch (preset) {
      case 'fast':
        setOperationState(prev => ({
          ...prev,
          qualityPreset: preset,
          pixelsPerUnit: 8,
        }));
        break;
      case 'high':
        setOperationState(prev => ({
          ...prev,
          qualityPreset: preset,
          pixelsPerUnit: 24,
        }));
        break;
      case 'balanced':
      default:
        setOperationState(prev => ({
          ...prev,
          qualityPreset: 'balanced',
          pixelsPerUnit: 14,
        }));
        break;
    }
  };

  const handlePreviewToggle = () => {
    setOperationState(prev => ({ ...prev, preview: !prev.preview }));
  };

  const handleToolSelectionChange = (field: 'useModel' | 'useSupports', value: any) => {
    setOperationState(prev => ({ ...prev, [field]: value }));
  };

  const handleCreateNegative = () => {
    if (!baseMesh || fixtureComponents.length === 0) {
      console.warn('No base mesh or fixture components available');
      return;
    }

    try {
      // Create the negative space
      const resultMesh = csgEngine.createNegativeSpace(
        baseMesh,
        fixtureComponents,
        operationState.removalDirection,
        {
          depth: operationState.depth,
          angle: operationState.angle,
          offset: operationState.offset
        }
      );

      // Create negative record
      const negative: FixtureNegative = {
        id: `negative-${Date.now()}`,
        operation: {
          type: operationState.type,
          targetMesh: baseMesh,
          toolMeshes: fixtureComponents,
          resultMesh
        },
        removalDirection: operationState.removalDirection,
        parameters: {
          depth: operationState.depth,
          angle: operationState.angle,
          offset: operationState.offset
        }
      };

      setCreatedNegatives(prev => [...prev, negative]);
      onNegativeCreate?.(negative);
      onOperationComplete?.(resultMesh);

    } catch (error) {
      console.error('Error creating negative space:', error);
    }
  };

  const handleDeleteNegative = (negativeId: string) => {
    setCreatedNegatives(prev => prev.filter(n => n.id !== negativeId));
  };

  const handleDuplicateNegative = (negativeId: string) => {
    const negative = createdNegatives.find(n => n.id === negativeId);
    if (negative) {
      const duplicated: FixtureNegative = {
        ...negative,
        id: `negative-${Date.now()}`,
        parameters: {
          ...negative.parameters,
          depth: negative.parameters.depth + 2
        }
      };
      setCreatedNegatives(prev => [...prev, duplicated]);
    }
  };

  const handleQuickOperation = (operationType: string) => {
    if (!baseMesh) return;

    let resultMesh: THREE.Mesh;

    switch (operationType) {
      case 'cylindrical-hole':
        resultMesh = csgUtils.createCylindricalHole(
          baseMesh,
          5,
          operationState.depth,
          new THREE.Vector3(0, 0, 0)
        );
        break;
      case 'rectangular-pocket':
        resultMesh = csgUtils.createRectangularPocket(
          baseMesh,
          20,
          20,
          operationState.depth,
          new THREE.Vector3(0, 0, 0)
        );
        break;
      case 'chamfer':
        resultMesh = csgEngine.createChamfer(baseMesh, 2, 45);
        break;
      default:
        return;
    }

    onOperationComplete?.(resultMesh);
  };

  const getOperationIcon = (type: string) => {
    switch (type) {
      case 'subtract': return <Minus className="w-4 h-4" />;
      case 'union': return <Plus className="w-4 h-4" />;
      case 'intersect': return <Settings className="w-4 h-4" />;
      default: return <Settings className="w-4 h-4" />;
    }
  };

  const getOperationColor = (type: string) => {
    switch (type) {
      case 'subtract': return 'destructive';
      case 'union': return 'default';
      case 'intersect': return 'secondary';
      default: return 'secondary';
    }
  };

  return (
    <div className={`w-full rounded-lg border border-border/50 bg-background/80 shadow-sm flex flex-col ${className}`}>
      <div className="p-4 border-b border-border/50">
        <h2 className="font-tech font-semibold text-lg mb-1">Support Trimming</h2>
        <p className="text-xs text-muted-foreground font-tech">
          Trim parametric supports against the model using swept subtraction
        </p>
      </div>

      <Tabs defaultValue="trim" className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-1 mx-4 mt-4">
          <TabsTrigger value="trim" className="text-xs">Support Trim</TabsTrigger>
        </TabsList>

        <div className="flex-1 p-4">
          <TabsContent value="trim" className="mt-0 h-full">
            <div className="space-y-4">
              {/* Options */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">Options</h3>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={operationState.useSupports === 'all'}
                      onChange={(e) => handleToolSelectionChange('useSupports', e.target.checked ? 'all' : 'none')}
                    />
                    <span>Subtract supports</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Global offset
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Slider
                          value={[operationState.offset]}
                          onValueChange={([value]) => handleParameterChange('offset', value)}
                          min={-20}
                          max={20}
                          step={0.1}
                          className="w-full"
                        />
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground w-20 justify-end">
                        <input
                          type="number"
                          className="w-12 px-1 py-0.5 text-right border border-border/60 rounded bg-background/80"
                          value={operationState.offset.toFixed(1)}
                          min={-20}
                          max={20}
                          step={0.1}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isNaN(v)) return;
                            const clamped = Math.min(20, Math.max(-20, v));
                            handleParameterChange('offset', clamped);
                          }}
                        />
                        <span>mm</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Advanced options */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium text-sm mb-2">Advanced options</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium mb-2 block">
                        Resolution (sweep depth)
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Slider
                            value={[operationState.depth]}
                            onValueChange={([value]) => handleParameterChange('depth', value)}
                            min={1}
                            max={50}
                            step={0.5}
                            className="w-full"
                          />
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground w-20 justify-end">
                          <input
                            type="number"
                            className="w-12 px-1 py-0.5 text-right border border-border/60 rounded bg-background/80"
                            value={operationState.depth.toFixed(1)}
                            min={1}
                            max={50}
                            step={0.5}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isNaN(v)) return;
                              const clamped = Math.min(50, Math.max(1, v));
                              handleParameterChange('depth', clamped);
                            }}
                          />
                          <span>mm</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium mb-2 block">
                        Sweep angle
                      </label>
                      <Slider
                        value={[operationState.angle]}
                        onValueChange={([value]) => handleParameterChange('angle', value)}
                        min={-90}
                        max={90}
                        step={5}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Advanced Offset (GPU) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-sm">Advanced Offset</h3>
                      <p className="text-[11px] text-muted-foreground">
                        GPU offset for model cutter (supports trimming)
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={operationState.useAdvancedOffset}
                        onChange={(e) => handleParameterChange('useAdvancedOffset', e.target.checked)}
                      />
                      <span>Enable</span>
                    </label>
                  </div>

                {operationState.useAdvancedOffset && (
                  <div className="space-y-3 border border-border/40 rounded-md p-3 bg-muted/40">
                    <p className="text-[11px] text-muted-foreground">
                      Uses a GPU offset for the model cutter with a performance-oriented
                      configuration (around 8 px/unit). Enable only
                      when you need additional clearance around complex workpieces.
                    </p>
                  </div>
                )}
              </div>
              </div>
              {/* Action Button */}
              <div className="space-y-2 pt-2">
                <Button
                  onClick={handleApply}
                  className="w-full"
                >
                  Trim Supports
                </Button>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default BooleanOperationsPanel;
