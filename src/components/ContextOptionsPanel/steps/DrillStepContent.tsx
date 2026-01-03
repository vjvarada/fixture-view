import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, Plus, RotateCcw, MousePointer, X, Check, Magnet } from 'lucide-react';
import { ThroughHoleIcon, CounterSinkIcon, CounterBoreIcon } from './HoleTypeIcons';
import { PlacedHole } from '@/features/holes';

type HoleType = 'through' | 'countersink' | 'counterbore';

interface DrillStepContentProps {
  hasWorkpiece?: boolean;
  onAddHole?: (config: HoleConfig) => void;
  holes?: PlacedHole[];
  baseplateHeight?: number;
  isPlacementMode?: boolean;
  onStartPlacement?: (config: HoleConfig) => void;
  onCancelPlacement?: () => void;
}

export interface HoleConfig {
  id: string;
  type: HoleType;
  diameter: number;
  // Counter sink specific
  countersinkAngle?: number;
  countersinkDiameter?: number;
  // Counter bore specific
  counterboreDiameter?: number;
  counterboreDepth?: number;
}

const STANDARD_SIZES = [3, 4, 5, 6, 8, 10, 12];

const COUNTERSINK_ANGLES = [82, 90, 100, 120];

// Standard countersink diameters for flat head screws (90° metric standard)
const COUNTERSINK_STANDARDS: Record<number, { diameter: number; angle: number }> = {
  3: { diameter: 6.5, angle: 90 },
  4: { diameter: 8.4, angle: 90 },
  5: { diameter: 10.4, angle: 90 },
  6: { diameter: 12.6, angle: 90 },
  8: { diameter: 16.6, angle: 90 },
  10: { diameter: 20, angle: 90 },
  12: { diameter: 24, angle: 90 },
};

// Standard counterbore dimensions for socket head cap screws (SHCS)
const COUNTERBORE_STANDARDS: Record<number, { diameter: number; depth: number }> = {
  3: { diameter: 5.5, depth: 3 },
  4: { diameter: 7, depth: 4 },
  5: { diameter: 8.5, depth: 5 },
  6: { diameter: 10, depth: 6 },
  8: { diameter: 13, depth: 8 },
  10: { diameter: 16, depth: 10 },
  12: { diameter: 18, depth: 12 },
};

// Get standard values or calculate based on diameter
const getCountersinkDefaults = (dia: number) => {
  if (COUNTERSINK_STANDARDS[dia]) {
    return COUNTERSINK_STANDARDS[dia];
  }
  // Approximate: countersink diameter ~2x hole diameter
  return { diameter: Math.round(dia * 2 * 10) / 10, angle: 90 };
};

const getCounterboreDefaults = (dia: number) => {
  if (COUNTERBORE_STANDARDS[dia]) {
    return COUNTERBORE_STANDARDS[dia];
  }
  // Approximate: counterbore diameter ~1.8x, depth ~1x hole diameter
  return { 
    diameter: Math.round(dia * 1.8 * 10) / 10, 
    depth: dia 
  };
};

const DrillStepContent: React.FC<DrillStepContentProps> = ({
  hasWorkpiece = false,
  onAddHole,
  holes = [],
  baseplateHeight = 20,
  isPlacementMode = false,
  onStartPlacement,
  onCancelPlacement,
}) => {
  const [holeType, setHoleType] = useState<HoleType>('through');
  const [diameter, setDiameter] = useState(5);
  // Counter sink options
  const [countersinkAngle, setCountersinkAngle] = useState(90);
  const [countersinkDiameter, setCountersinkDiameter] = useState(10.4);
  // Counter bore options
  const [counterboreDiameter, setCounterboreDiameter] = useState(8.5);
  const [counterboreDepth, setCounterboreDepth] = useState(5);
  // Snap to alignment toggle (ON by default)
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Max depth is 75% of baseplate height
  const maxDepth = useMemo(() => Math.round(baseplateHeight * 0.75 * 10) / 10, [baseplateHeight]);

  // Update countersink/counterbore defaults when diameter changes
  useEffect(() => {
    const csDefaults = getCountersinkDefaults(diameter);
    setCountersinkAngle(csDefaults.angle);
    setCountersinkDiameter(csDefaults.diameter);

    const cbDefaults = getCounterboreDefaults(diameter);
    setCounterboreDiameter(cbDefaults.diameter);
    // Ensure depth doesn't exceed max allowed
    setCounterboreDepth(Math.min(cbDefaults.depth, maxDepth));
  }, [diameter, maxDepth]);

  // Slider bounds relative to diameter
  const countersinkDiameterMin = diameter + 1;
  const countersinkDiameterMax = Math.max(diameter * 3, diameter + 15);
  
  const counterboreDiameterMin = diameter + 1;
  const counterboreDiameterMax = Math.max(diameter * 2.5, diameter + 12);
  
  const counterboreDepthMin = 1;
  const counterboreDepthMax = maxDepth;

  // Reset to default values based on current diameter
  const handleResetCountersink = () => {
    const defaults = getCountersinkDefaults(diameter);
    setCountersinkAngle(defaults.angle);
    setCountersinkDiameter(defaults.diameter);
  };

  const handleResetCounterbore = () => {
    const defaults = getCounterboreDefaults(diameter);
    setCounterboreDiameter(defaults.diameter);
    setCounterboreDepth(Math.min(defaults.depth, maxDepth));
  };

  if (!hasWorkpiece) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Create a baseplate first to add mounting holes.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleAddHole = () => {
    const config: HoleConfig = {
      id: `hole-${Date.now()}`,
      type: holeType,
      diameter,
    };

    if (holeType === 'countersink') {
      config.countersinkAngle = countersinkAngle;
      config.countersinkDiameter = countersinkDiameter;
    } else if (holeType === 'counterbore') {
      config.counterboreDiameter = counterboreDiameter;
      config.counterboreDepth = counterboreDepth;
    }

    // Start placement mode instead of directly adding
    if (onStartPlacement) {
      onStartPlacement(config);
      // Dispatch snap enabled state
      window.dispatchEvent(new CustomEvent('hole-snap-enabled-changed', { detail: { enabled: snapEnabled } }));
    } else {
      onAddHole?.(config);
    }
  };

  // Listen for hole placement cancellation
  useEffect(() => {
    const handlePlacementCancelled = () => {
      // Placement was cancelled (e.g., Escape key pressed)
    };
    
    window.addEventListener('hole-placement-cancelled', handlePlacementCancelled);
    return () => {
      window.removeEventListener('hole-placement-cancelled', handlePlacementCancelled);
    };
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* Holes Status - Small indicator */}
      {holes.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-tech text-green-600">
            {holes.length} hole{holes.length !== 1 ? 's' : ''} placed
          </span>
          <span className="text-xs text-muted-foreground font-tech ml-auto">
            View in Properties Panel →
          </span>
        </div>
      )}

      {/* Hole Type */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Hole Type
        </Label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setHoleType('through')}
            className={`flex flex-col items-center p-3 rounded-lg border-2 transition-all ${
              holeType === 'through'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <ThroughHoleIcon size={32} className="text-foreground" />
            <span className="text-[10px] font-tech mt-1">Through</span>
          </button>
          <button
            onClick={() => setHoleType('countersink')}
            className={`flex flex-col items-center p-3 rounded-lg border-2 transition-all ${
              holeType === 'countersink'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <CounterSinkIcon size={32} className="text-foreground" />
            <span className="text-[10px] font-tech mt-1">C-Sink</span>
          </button>
          <button
            onClick={() => setHoleType('counterbore')}
            className={`flex flex-col items-center p-3 rounded-lg border-2 transition-all ${
              holeType === 'counterbore'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <CounterBoreIcon size={32} className="text-foreground" />
            <span className="text-[10px] font-tech mt-1">C-Bore</span>
          </button>
        </div>
      </div>

      {/* Standard Sizes Quick Select */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Standard Sizes
        </Label>
        <div className="flex flex-wrap gap-1">
          {STANDARD_SIZES.map((size) => (
            <Button
              key={size}
              variant={diameter === size ? 'default' : 'outline'}
              size="sm"
              className="font-tech text-xs px-2 py-1 h-7"
              onClick={() => setDiameter(size)}
            >
              {size}mm
            </Button>
          ))}
        </div>
      </div>

      {/* Custom Diameter */}
      <div className="space-y-3">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Diameter
        </Label>
        <div className="flex items-center gap-3">
          <Slider
            value={[diameter]}
            onValueChange={([v]) => setDiameter(v)}
            min={1}
            max={50}
            step={0.5}
            className="flex-1"
          />
          <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
            {diameter}mm
          </Badge>
        </div>
      </div>

      {/* Counter Sink Options */}
      {holeType === 'countersink' && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Countersink Options
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetCountersink}
              className="h-5 px-1.5 text-[8px]"
              title="Reset to defaults"
              aria-label="Reset to defaults"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Countersink Angle
            </Label>
            <div className="flex flex-wrap gap-1">
              {COUNTERSINK_ANGLES.map((angle) => (
                <Button
                  key={angle}
                  variant={countersinkAngle === angle ? 'default' : 'outline'}
                  size="sm"
                  className="font-tech text-xs px-2 py-1 h-7"
                  onClick={() => setCountersinkAngle(angle)}
                >
                  {angle}°
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Countersink Diameter
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[countersinkDiameter]}
                onValueChange={([v]) => setCountersinkDiameter(v)}
                min={countersinkDiameterMin}
                max={countersinkDiameterMax}
                step={0.1}
                className="flex-1"
              />
              <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
                {countersinkDiameter}mm
              </Badge>
            </div>
          </div>
        </>
      )}

      {/* Counter Bore Options */}
      {holeType === 'counterbore' && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Counterbore Options
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetCounterbore}
              className="h-5 px-1.5 text-[8px]"
              title="Reset to defaults"
              aria-label="Reset to defaults"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </Button>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Counterbore Diameter
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[counterboreDiameter]}
                onValueChange={([v]) => setCounterboreDiameter(v)}
                min={counterboreDiameterMin}
                max={counterboreDiameterMax}
                step={0.1}
                className="flex-1"
              />
              <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
                {counterboreDiameter}mm
              </Badge>
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Counterbore Depth
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[counterboreDepth]}
                onValueChange={([v]) => setCounterboreDepth(v)}
                min={counterboreDepthMin}
                max={counterboreDepthMax}
                step={0.5}
                className="flex-1"
              />
              <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
                {counterboreDepth}mm
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground font-tech">
              Max depth: {maxDepth}mm (75% of baseplate height)
            </p>
          </div>
        </>
      )}

      {/* Snap to Alignment Toggle */}
      <div className="flex items-center justify-between py-2 px-1">
        <div className="flex items-center gap-2">
          <Magnet className="w-4 h-4 text-muted-foreground" />
          <Label className="text-xs font-tech cursor-pointer" htmlFor="snap-toggle">
            Snap to alignment
          </Label>
        </div>
        <Switch
          id="snap-toggle"
          checked={snapEnabled}
          onCheckedChange={(checked) => {
            setSnapEnabled(checked);
            // Update snap state in 3D scene if already in placement mode
            if (isPlacementMode) {
              window.dispatchEvent(new CustomEvent('hole-snap-enabled-changed', { detail: { enabled: checked } }));
            }
          }}
        />
      </div>

      {/* Add Hole Button / Placement Mode Indicator */}
      {isPlacementMode ? (
        <Card className="tech-glass p-3 bg-primary/10 border-primary/30">
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8 flex-shrink-0">
              <MousePointer className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-tech font-medium text-primary">
                Click on baseplate to place hole
              </p>
              <p className="text-[10px] text-muted-foreground">
                Press Escape to cancel
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelPlacement}
              className="h-7 px-2"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="w-full font-tech"
          onClick={handleAddHole}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Hole (click to place)
        </Button>
      )}

      {/* Info */}
      <Card className="tech-glass">
        <div className="p-3 text-xs text-muted-foreground font-tech">
          <p>
            Add mounting holes to secure your fixture to the machine bed or mounting plate.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default DrillStepContent;
