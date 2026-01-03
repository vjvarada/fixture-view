import { useState, useEffect, useCallback, memo } from 'react';
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
  SquaresSubtract,
} from 'lucide-react';
import { CavitySettings, DEFAULT_CAVITY_SETTINGS } from '@rapidtool/cad-core';

// ============================================
// Types
// ============================================

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

interface CavityProgress {
  current: number;
  total: number;
  stage: string;
}

interface SliderSettingProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  unit?: string;
  formatValue?: (v: number) => string;
  hint?: string;
}

interface ToggleSettingProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
}

// ============================================
// Sub-Components
// ============================================

/** Alert shown when workpiece is missing */
const MissingWorkpieceAlert = memo(() => (
  <div className="p-4">
    <Alert className="font-tech">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="text-xs">
        Import a workpiece first to create cavities.
      </AlertDescription>
    </Alert>
  </div>
));
MissingWorkpieceAlert.displayName = 'MissingWorkpieceAlert';

/** Alert shown when no target (baseplate/supports) exists */
const MissingTargetAlert = memo(() => (
  <div className="p-4">
    <Alert className="font-tech">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="text-xs">
        Create a baseplate or add supports first. The cavity will be cut from those elements.
      </AlertDescription>
    </Alert>
  </div>
));
MissingTargetAlert.displayName = 'MissingTargetAlert';

/** Reusable slider setting component */
const SliderSetting = memo<SliderSettingProps>(({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled = false,
  unit = '',
  formatValue,
  hint,
}) => {
  const displayValue = formatValue ? formatValue(value) : `${value}${unit}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] font-tech text-muted-foreground">{label}</Label>
        <span className="text-[10px] font-mono text-muted-foreground">{displayValue}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
      {hint && <p className="text-[8px] text-muted-foreground italic">{hint}</p>}
    </div>
  );
});
SliderSetting.displayName = 'SliderSetting';

/** Reusable toggle setting component */
const ToggleSetting = memo<ToggleSettingProps>(({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  hint,
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <Label className="text-[10px] font-tech text-muted-foreground">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
    {hint && <p className="text-[8px] text-muted-foreground italic">{hint}</p>}
  </div>
));
ToggleSetting.displayName = 'ToggleSetting';

/** Operation description header card */
const OperationHeader = memo(() => (
  <Card className="tech-glass p-3">
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
        <SquaresSubtract className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-tech font-medium">Create Cavity</p>
        <p className="text-xs text-muted-foreground font-tech">
          Generate an offset mesh around the workpiece to cut cavities in supports
        </p>
      </div>
    </div>
  </Card>
));
OperationHeader.displayName = 'OperationHeader';

/** Target components display (supports badge) */
const TargetComponents = memo<{ hasSupports: boolean; supportsCount: number }>(
  ({ hasSupports, supportsCount }) => {
    if (!hasSupports) return null;

    return (
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Cavity will be cut from
        </Label>
        <Card className="tech-glass p-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-tech flex-1">Supports</span>
            <Badge variant="default" className="text-[8px]">{supportsCount}</Badge>
          </div>
        </Card>
      </div>
    );
  }
);
TargetComponents.displayName = 'TargetComponents';

// ============================================
// Custom Hooks
// ============================================

/** Hook to track cavity subtraction progress via window events */
function useCavityProgress(): CavityProgress {
  const [progress, setProgress] = useState<CavityProgress>({ current: 0, total: 0, stage: '' });

  useEffect(() => {
    const handleProgress = (e: CustomEvent<{ current: number; total: number; stage?: string }>) => {
      const { current, total, stage } = e.detail;
      setProgress({ current, total, stage: stage || `Processing support ${current}/${total}` });
    };

    const handleComplete = () => {
      setProgress({ current: 0, total: 0, stage: '' });
    };

    window.addEventListener('cavity-subtraction-progress', handleProgress as EventListener);
    window.addEventListener('cavity-subtraction-complete', handleComplete as EventListener);

    return () => {
      window.removeEventListener('cavity-subtraction-progress', handleProgress as EventListener);
      window.removeEventListener('cavity-subtraction-complete', handleComplete as EventListener);
    };
  }, []);

  return progress;
}

// ============================================
// Main Component
// ============================================

const CavityStepContent: React.FC<CavityStepContentProps> = ({
  hasWorkpiece = false,
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
  const cavityProgress = useCavityProgress();

  // Memoized setting change handler
  const handleSettingChange = useCallback(
    <K extends keyof CavitySettings>(key: K, value: CavitySettings[K]) => {
      onSettingsChange({ ...settings, [key]: value });
    },
    [settings, onSettingsChange]
  );

  // Reset to defaults
  const handleReset = useCallback(() => {
    onSettingsChange(DEFAULT_CAVITY_SETTINGS);
    onClearPreview();
  }, [onSettingsChange, onClearPreview]);

  // Toggle preview visibility
  const handlePreviewToggle = useCallback(
    (checked: boolean) => {
      handleSettingChange('showPreview', checked);
      window.dispatchEvent(new CustomEvent('toggle-offset-preview', { detail: { visible: checked } }));
    },
    [handleSettingChange]
  );

  // Early returns for missing requirements
  if (!hasWorkpiece) return <MissingWorkpieceAlert />;
  if (!hasSupports) return <MissingTargetAlert />;

  return (
    <div className="p-4 space-y-4">
      <OperationHeader />
      <TargetComponents hasSupports={hasSupports} supportsCount={supportsCount} />

      {/* Clearance / Offset Distance */}
      <div className="space-y-3">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Clearance / Tolerance
        </Label>
        <div className="flex items-center gap-3">
          <Slider
            value={[settings.offsetDistance]}
            onValueChange={([v]) => handleSettingChange('offsetDistance', v)}
            min={0}
            max={3}
            step={0.05}
            className="flex-1"
            disabled={isProcessing}
          />
          <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
            {settings.offsetDistance.toFixed(2)}mm
          </Badge>
        </div>
        <p className="text-[8px] text-muted-foreground font-tech">
          Gap around the workpiece for easier insertion/removal (0 = exact fit)
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
          <SliderSetting
            label="Resolution (quality)"
            value={settings.pixelsPerUnit}
            onChange={(v) => handleSettingChange('pixelsPerUnit', v)}
            min={2}
            max={10}
            step={1}
            disabled={isProcessing}
            unit=" px/mm"
            hint="Higher = more detail, slower processing"
          />

          <SliderSetting
            label="Tilt Left/Right"
            value={settings.rotationXZ}
            onChange={(v) => handleSettingChange('rotationXZ', v)}
            min={-90}
            max={90}
            step={5}
            disabled={isProcessing}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v}°`}
          />

          <SliderSetting
            label="Tilt Front/Back"
            value={settings.rotationYZ}
            onChange={(v) => handleSettingChange('rotationYZ', v)}
            min={-90}
            max={90}
            step={5}
            disabled={isProcessing}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v}°`}
          />

          {/* Toggle Options */}
          <div className="space-y-2 pt-2 border-t border-border/30">
            <ToggleSetting
              label="Fill Holes"
              checked={settings.fillHoles}
              onCheckedChange={(checked) => handleSettingChange('fillHoles', checked)}
              disabled={isProcessing}
              hint="Repair holes in mesh before processing"
            />
          </div>

          {/* Mesh Processing Options */}
          <div className="space-y-3 pt-2 border-t border-border/30">
            <Label className="text-[10px] font-tech text-muted-foreground uppercase tracking-wider">
              Mesh Processing
            </Label>

            <ToggleSetting
              label="Decimation"
              checked={settings.enableDecimation}
              onCheckedChange={(checked) => handleSettingChange('enableDecimation', checked)}
              disabled={isProcessing}
              hint="Reduce triangle count for faster CSG"
            />

            <ToggleSetting
              label="Smoothing"
              checked={settings.enableSmoothing}
              onCheckedChange={(checked) => handleSettingChange('enableSmoothing', checked)}
              disabled={isProcessing}
              hint="Smooth horizontal contours (preserves height)"
            />

            {/* Smoothing Options - shown only when smoothing enabled */}
            {settings.enableSmoothing && (
              <div className="space-y-3 pl-2 border-l-2 border-border/30">
                <SliderSetting
                  label="Strength"
                  value={settings.smoothingStrength ?? 0}
                  onChange={(v) => handleSettingChange('smoothingStrength', v)}
                  min={0}
                  max={1}
                  step={0.1}
                  disabled={isProcessing}
                  formatValue={(v) => {
                    if (v === 0) return 'Taubin (0%)';
                    if (v === 1) return 'Laplacian (100%)';
                    return `${(v * 100).toFixed(0)}%`;
                  }}
                  hint="0 = volume-preserving, 1 = stronger (may shrink)"
                />

                <SliderSetting
                  label="Iterations"
                  value={settings.smoothingIterations ?? 10}
                  onChange={(v) => handleSettingChange('smoothingIterations', v)}
                  min={1}
                  max={100}
                  step={1}
                  disabled={isProcessing}
                  hint="More iterations = smoother result"
                />

                <ToggleSetting
                  label="Debug Colors"
                  checked={settings.debugSmoothingColors ?? false}
                  onCheckedChange={(checked) => handleSettingChange('debugSmoothingColors', checked)}
                  disabled={isProcessing}
                  hint="RED=Wall, GREEN=TopBoundary, BLUE=TopInterior, YELLOW=Bottom"
                />
              </div>
            )}
          </div>

          {/* CSG Cleanup Options */}
          <div className="space-y-3 pt-2 border-t border-border/30">
            <Label className="text-[10px] font-tech text-muted-foreground uppercase tracking-wider">
              CSG Cleanup (Fragment Removal)
            </Label>
            <p className="text-[9px] text-muted-foreground">
              Remove small fragments after CSG operations. Lower values keep more geometry (including labels).
            </p>

            <SliderSetting
              label="Min Volume"
              value={settings.csgMinVolume ?? 1.0}
              onChange={(v) => handleSettingChange('csgMinVolume', v)}
              min={0}
              max={50}
              step={0.5}
              disabled={isProcessing}
              unit=" mm³"
              hint="Fragments smaller than this are removed (0 = keep all)"
            />

            <SliderSetting
              label="Min Thickness"
              value={settings.csgMinThickness ?? 0.5}
              onChange={(v) => handleSettingChange('csgMinThickness', v)}
              min={0}
              max={10}
              step={0.1}
              disabled={isProcessing}
              unit=" mm"
              hint="Fragments thinner than this are removed (0 = keep all)"
            />

            <SliderSetting
              label="Min Triangles"
              value={settings.csgMinTriangles ?? 5}
              onChange={(v) => handleSettingChange('csgMinTriangles', v)}
              min={0}
              max={100}
              step={1}
              disabled={isProcessing}
              hint="Fragments with fewer triangles are removed (0 = keep all)"
            />
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
            onCheckedChange={handlePreviewToggle}
            disabled={isProcessing}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <ActionButtons
        isProcessing={isProcessing}
        isApplying={isApplying}
        isCavityApplied={isCavityApplied}
        hasPreview={hasPreview}
        cavityProgress={cavityProgress}
        onGeneratePreview={onGeneratePreview}
        onExecuteCavity={onExecuteCavity}
        onResetCavity={onResetCavity}
      />

      {/* Status */}
      <StatusIndicator isCavityApplied={isCavityApplied} hasPreview={hasPreview} />

      {/* Info Card */}
      <InfoCard />
    </div>
  );
};

// ============================================
// Action & Status Sub-Components
// ============================================

interface ActionButtonsProps {
  isProcessing: boolean;
  isApplying: boolean;
  isCavityApplied: boolean;
  hasPreview: boolean;
  cavityProgress: CavityProgress;
  onGeneratePreview: () => void;
  onExecuteCavity: () => void;
  onResetCavity: () => void;
}

const ActionButtons = memo<ActionButtonsProps>(({
  isProcessing,
  isApplying,
  isCavityApplied,
  hasPreview,
  cavityProgress,
  onGeneratePreview,
  onExecuteCavity,
  onResetCavity,
}) => {
  if (isProcessing) {
    return (
      <div className="space-y-2 pt-2">
        <ProcessingCard isApplying={isApplying} cavityProgress={cavityProgress} />
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2">
      {isCavityApplied ? (
        <Button variant="outline" size="sm" className="w-full font-tech" onClick={onResetCavity}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset Cavity
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="w-full font-tech" onClick={onGeneratePreview}>
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
  );
});
ActionButtons.displayName = 'ActionButtons';

/** Processing indicator with progress */
const ProcessingCard = memo<{ isApplying: boolean; cavityProgress: CavityProgress }>(
  ({ isApplying, cavityProgress }) => {
    const hasProgress = cavityProgress.total > 0;
    const progressPercent = hasProgress ? (cavityProgress.current / cavityProgress.total) * 100 : 0;

    return (
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
                  ? hasProgress
                    ? `Processing support ${cavityProgress.current}/${cavityProgress.total}`
                    : 'Preparing CSG operations...'
                  : 'Processing offset mesh...'}
              </p>
            </div>
          </div>

          {isApplying && hasProgress ? (
            <div className="space-y-1">
              <Progress value={progressPercent} className="h-1.5" />
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
    );
  }
);
ProcessingCard.displayName = 'ProcessingCard';

/** Status indicator card */
const StatusIndicator = memo<{ isCavityApplied: boolean; hasPreview: boolean }>(
  ({ isCavityApplied, hasPreview }) => {
    if (isCavityApplied) {
      return (
        <Card className="tech-glass p-3 bg-amber-500/5 border-amber-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <p className="text-xs font-tech text-amber-600 dark:text-amber-400">
              Cavity applied - click Reset Cavity to start over
            </p>
          </div>
        </Card>
      );
    }

    if (hasPreview) {
      return (
        <Card className="tech-glass p-3 bg-green-500/5 border-green-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-xs font-tech text-green-600 dark:text-green-400">
              Preview ready - adjust settings and regenerate, or apply to supports
            </p>
          </div>
        </Card>
      );
    }

    return null;
  }
);
StatusIndicator.displayName = 'StatusIndicator';

/** Info card with usage tips */
const InfoCard = memo(() => (
  <Card className="tech-glass">
    <div className="p-3 text-xs text-muted-foreground font-tech space-y-2">
      <p>
        The cavity mesh is an offset shell around your workpiece that will be subtracted from the
        supports to create holding cavities.
      </p>
      <p className="text-[10px]">
        <strong>Tip:</strong> Use the preview to verify the offset mesh aligns correctly with your
        part before applying.
      </p>
    </div>
  </Card>
));
InfoCard.displayName = 'InfoCard';

export default CavityStepContent;
