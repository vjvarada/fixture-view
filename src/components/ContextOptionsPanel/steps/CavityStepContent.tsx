import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  AlertCircle, 
  Minus, 
  Layers, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Settings2,
  ChevronDown,
  ChevronUp,
  SquaresSubtract
} from 'lucide-react';
import { CavitySettings, DEFAULT_CAVITY_SETTINGS } from '@/lib/offset/types';

interface CavityStepContentProps {
  hasWorkpiece?: boolean;
  hasBaseplate?: boolean;
  hasSupports?: boolean;
  supportsCount?: number;
  settings: CavitySettings;
  onSettingsChange: (settings: CavitySettings) => void;
  onGeneratePreview: () => void;
  onClearPreview: () => void;
  onExecuteCavity: () => void;
  onResetCavity: () => void;
  isProcessing?: boolean;
  isApplying?: boolean;
  hasPreview?: boolean;
  isCavityApplied?: boolean;
}

const CavityStepContent: React.FC<CavityStepContentProps> = ({
  hasWorkpiece = false,
  hasBaseplate = false,
  hasSupports = false,
  supportsCount = 0,
  settings,
  onSettingsChange,
  onGeneratePreview,
  onClearPreview,
  onExecuteCavity,
  onResetCavity,
  isProcessing = false,
  isApplying = false,
  hasPreview = false,
  isCavityApplied = false,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Real progress tracking for cavity subtraction
  const [cavityProgress, setCavityProgress] = useState({ current: 0, total: 0, stage: '' });
  
  // Listen for progress events from the worker
  useEffect(() => {
    const handleProgress = (e: CustomEvent<{ current: number; total: number; supportId: string; stage?: string }>) => {
      const { current, total, stage } = e.detail;
      setCavityProgress({ current, total, stage: stage || `Processing support ${current}/${total}` });
    };
    
    const handleComplete = () => {
      // Reset progress when complete
      setCavityProgress({ current: 0, total: 0, stage: '' });
    };
    
    window.addEventListener('cavity-subtraction-progress', handleProgress as EventListener);
    window.addEventListener('cavity-subtraction-complete', handleComplete as EventListener);
    
    return () => {
      window.removeEventListener('cavity-subtraction-progress', handleProgress as EventListener);
      window.removeEventListener('cavity-subtraction-complete', handleComplete as EventListener);
    };
  }, []);
  
  const canProceed = hasWorkpiece && (hasBaseplate || hasSupports);

  // Handle setting changes
  const handleSettingChange = <K extends keyof CavitySettings>(
    key: K,
    value: CavitySettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    onSettingsChange(newSettings);
  };

  // Reset to defaults
  const handleReset = () => {
    onSettingsChange(DEFAULT_CAVITY_SETTINGS);
    onClearPreview();
  };

  if (!hasWorkpiece) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Import a workpiece first to create cavities.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasBaseplate && !hasSupports) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Create a baseplate or add supports first. The cavity will be cut from those elements.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Operation Description */}
      <Card className="tech-glass p-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Minus className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-tech font-medium">Create Cavity</p>
            <p className="text-xs text-muted-foreground font-tech">
              Generate an offset mesh around the workpiece to cut cavities in supports
            </p>
          </div>
        </div>
      </Card>

      {/* Target Components */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Cavity will be cut from
        </Label>
        
        <div className="space-y-2">
          {hasSupports && (
            <Card className="tech-glass p-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-tech flex-1">Supports</span>
                <Badge variant="default" className="text-[8px]">{supportsCount}</Badge>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Clearance / Offset Distance */}
      <div className="space-y-3">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Clearance / Tolerance
        </Label>
        <div className="flex items-center gap-3">
          <Slider
            value={[settings.offsetDistance]}
            onValueChange={([v]) => handleSettingChange('offsetDistance', v)}
            min={0.1}
            max={3}
            step={0.1}
            className="flex-1"
            disabled={isProcessing}
          />
          <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
            {settings.offsetDistance.toFixed(1)}mm
          </Badge>
        </div>
        <p className="text-[8px] text-muted-foreground font-tech">
          Gap around the workpiece for easier insertion/removal
        </p>
      </div>

      {/* Advanced Settings Toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full font-tech text-xs text-muted-foreground h-7"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
        {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
      </Button>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="space-y-4 p-3 bg-muted/30 rounded-lg">
          {/* Resolution */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-tech text-muted-foreground">
                Resolution (quality)
              </Label>
              <span className="text-[10px] font-mono text-muted-foreground">
                {settings.pixelsPerUnit} px/mm
              </span>
            </div>
            <Slider
              value={[settings.pixelsPerUnit]}
              onValueChange={([value]) => handleSettingChange('pixelsPerUnit', value)}
              min={2}
              max={10}
              step={1}
              disabled={isProcessing}
            />
            <p className="text-[8px] text-muted-foreground italic">
              Higher = more detail, slower processing
            </p>
          </div>

          {/* Rotation XZ */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-tech text-muted-foreground">
                Tilt Left/Right
              </Label>
              <span className="text-[10px] font-mono text-muted-foreground">
                {settings.rotationXZ > 0 ? '+' : ''}{settings.rotationXZ}°
              </span>
            </div>
            <Slider
              value={[settings.rotationXZ]}
              onValueChange={([value]) => handleSettingChange('rotationXZ', value)}
              min={-90}
              max={90}
              step={5}
              disabled={isProcessing}
            />
          </div>

          {/* Rotation YZ */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-tech text-muted-foreground">
                Tilt Front/Back
              </Label>
              <span className="text-[10px] font-mono text-muted-foreground">
                {settings.rotationYZ > 0 ? '+' : ''}{settings.rotationYZ}°
              </span>
            </div>
            <Slider
              value={[settings.rotationYZ]}
              onValueChange={([value]) => handleSettingChange('rotationYZ', value)}
              min={-90}
              max={90}
              step={5}
              disabled={isProcessing}
            />
          </div>

          {/* Toggle Options */}
          <div className="space-y-2 pt-2 border-t border-border/30">
            {/* Fill Holes */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-tech text-muted-foreground">
                Fill Holes
              </Label>
              <Switch
                checked={settings.fillHoles}
                onCheckedChange={(checked) => handleSettingChange('fillHoles', checked)}
                disabled={isProcessing}
              />
            </div>
            <p className="text-[8px] text-muted-foreground italic">
              Repair holes in mesh before processing
            </p>
          </div>

          {/* Mesh Processing Options */}
          <div className="space-y-3 pt-2 border-t border-border/30">
            <Label className="text-[10px] font-tech text-muted-foreground uppercase tracking-wider">
              Mesh Processing
            </Label>
            
            {/* Decimation Toggle */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-tech text-muted-foreground">
                  Decimation
                </Label>
                <Switch
                  checked={settings.enableDecimation}
                  onCheckedChange={(checked) => handleSettingChange('enableDecimation', checked)}
                  disabled={isProcessing}
                />
              </div>
              <p className="text-[8px] text-muted-foreground italic">
                Reduce triangle count for faster CSG
              </p>
            </div>

            {/* Smoothing Toggle */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-tech text-muted-foreground">
                  Smoothing
                </Label>
                <Switch
                  checked={settings.enableSmoothing}
                  onCheckedChange={(checked) => handleSettingChange('enableSmoothing', checked)}
                  disabled={isProcessing}
                />
              </div>
              <p className="text-[8px] text-muted-foreground italic">
                Remove jagged edges (volume-preserving)
              </p>
            </div>

            {/* Smoothing Options */}
            {settings.enableSmoothing && (
              <div className="space-y-3 pl-2 border-l-2 border-border/30">
                {/* Smoothing Iterations */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-tech text-muted-foreground">
                      Iterations
                    </Label>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {settings.smoothingIterations ?? 2}
                    </span>
                  </div>
                  <Slider
                    value={[settings.smoothingIterations ?? 2]}
                    onValueChange={([value]) => handleSettingChange('smoothingIterations', value)}
                    min={1}
                    max={10}
                    step={1}
                    disabled={isProcessing}
                  />
                  <p className="text-[8px] text-muted-foreground italic">
                    Number of smoothing passes (1-10)
                  </p>
                </div>

                {/* Smoothing Sigma (Strength) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-tech text-muted-foreground">
                      Strength (σ)
                    </Label>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {(settings.smoothingSigma ?? 0.2).toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={[settings.smoothingSigma ?? 0.2]}
                    onValueChange={([value]) => handleSettingChange('smoothingSigma', value)}
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    disabled={isProcessing}
                  />
                  <p className="text-[8px] text-muted-foreground italic">
                    Higher = stronger smoothing effect
                  </p>
                </div>
              </div>
            )}


          </div>

          {/* Reset Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={isProcessing}
            className="w-full h-7 text-[10px] font-tech"
          >
            <Settings2 className="w-3 h-3 mr-1" />
            Reset to Defaults
          </Button>
        </div>
      )}

      {/* Preview Controls */}
      <div className="space-y-3 pt-2 border-t border-border/50">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-tech text-muted-foreground flex items-center gap-1">
            {settings.showPreview ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Show Preview
          </Label>
          <Switch
            checked={settings.showPreview}
            onCheckedChange={(checked) => {
              handleSettingChange('showPreview', checked);
              // Dispatch event to toggle offset mesh visibility in 3DScene
              window.dispatchEvent(new CustomEvent('toggle-offset-preview', { 
                detail: { visible: checked } 
              }));
            }}
            disabled={isProcessing}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-2">
        {isProcessing ? (
          <Card className="tech-glass p-4 bg-primary/5 border-primary/30">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative w-8 h-8">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-tech font-medium text-primary">
                    {isApplying ? 'Applying Cavity' : 'Generating Preview'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {isApplying 
                      ? (cavityProgress.total > 0 
                          ? `Processing support ${cavityProgress.current}/${cavityProgress.total}` 
                          : 'Preparing CSG operations...')
                      : 'Processing offset mesh...'}
                  </p>
                </div>
              </div>
              {isApplying && cavityProgress.total > 0 ? (
                <div className="space-y-1">
                  <Progress 
                    value={(cavityProgress.current / cavityProgress.total) * 100} 
                    className="h-1.5" 
                  />
                  <p className="text-[8px] text-muted-foreground text-right font-mono">
                    {cavityProgress.current}/{cavityProgress.total} supports
                  </p>
                </div>
              ) : (
                <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
              )}
            </div>
          </Card>
        ) : isCavityApplied ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full font-tech"
            onClick={onResetCavity}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset Cavity
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full font-tech"
            onClick={onGeneratePreview}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {hasPreview ? 'Regenerate Preview' : 'Generate Preview'}
          </Button>
        )}
        
        {hasPreview && !isCavityApplied && (
          <Button
            variant="default"
            size="sm"
            className="w-full font-tech"
            onClick={onExecuteCavity}
            disabled={isProcessing}
          >
            <SquaresSubtract className="w-4 h-4 mr-2" />
            Apply Cavity to Supports
          </Button>
        )}
      </div>

      {/* Status */}
      {isCavityApplied ? (
        <Card className="tech-glass p-3 bg-amber-500/5 border-amber-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <p className="text-xs font-tech text-amber-600 dark:text-amber-400">
              Cavity applied - click Reset Cavity to start over
            </p>
          </div>
        </Card>
      ) : hasPreview && (
        <Card className="tech-glass p-3 bg-green-500/5 border-green-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-xs font-tech text-green-600 dark:text-green-400">
              Preview ready - adjust settings and regenerate, or apply to supports
            </p>
          </div>
        </Card>
      )}

      {/* Info */}
      <Card className="tech-glass">
        <div className="p-3 text-xs text-muted-foreground font-tech space-y-2">
          <p>
            The cavity mesh is an offset shell around your workpiece that will be 
            subtracted from the supports to create holding cavities.
          </p>
          <p className="text-[10px]">
            <strong>Tip:</strong> Use the preview to verify the offset mesh aligns 
            correctly with your part before applying.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default CavityStepContent;
