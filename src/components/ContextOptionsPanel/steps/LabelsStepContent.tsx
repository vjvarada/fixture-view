/**
 * LabelsStepContent
 *
 * Context panel step for creating and configuring labels.
 * Provides a 3D preview, font selection, text input, and dimension controls.
 */

import React, { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Plus, Check } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center, Text3D } from '@react-three/drei';
import * as THREE from 'three';
import {
  LabelConfig,
  DEFAULT_LABEL_CONFIG,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_DEPTH,
  MAX_DEPTH,
  DEFAULT_DEPTH,
  LabelFont,
  LABEL_FONTS,
  getFontFile,
} from '@/features/labels';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Scale factor for 3D preview to fit container */
const PREVIEW_TARGET_SIZE = 30;

/** Minimum font size for preview scaling calculation */
const PREVIEW_MIN_FONT = 10;

/** Preview canvas camera settings */
const PREVIEW_CAMERA = { position: [0, 0, 80] as [number, number, number], fov: 50 };

/** Preview orbit controls polar angle range */
const PREVIEW_POLAR_ANGLE = { min: Math.PI / 3, max: Math.PI / 2 };

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LabelsStepContentProps {
  hasWorkpiece?: boolean;
  hasBaseplate?: boolean;
  hasSupports?: boolean;
  labels?: LabelConfig[];
  selectedLabelId?: string | null;
  onAddLabel?: (label: LabelConfig) => void;
  onUpdateLabel?: (labelId: string, updates: Partial<LabelConfig>) => void;
  onDeleteLabel?: (labelId: string) => void;
  onSelectLabel?: (labelId: string | null) => void;
  /** Project name for default label text */
  projectName?: string;
  /** Current baseplate configuration (for multi-section support) */
  currentBaseplate?: { 
    id: string; 
    type: string; 
    sections?: Array<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }> 
  } | null;
  /** Selected section ID for multi-section baseplates */
  selectedSectionId?: string | null;
  /** Callback to select a section */
  onSectionSelect?: (sectionId: string | null) => void;
}

interface Label3DPreviewProps {
  text: string;
  fontSize: number;
  depth: number;
  font: LabelFont;
}

interface LabelFormState {
  text: string;
  fontSize: number;
  depth: number;
  font: LabelFont;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generates a unique label ID */
const generateLabelId = (): string => `label-${Date.now()}`;

/** Creates a new label config from form state */
const createLabelConfig = (form: LabelFormState, sectionId?: string): LabelConfig => ({
  id: generateLabelId(),
  text: form.text,
  fontSize: form.fontSize,
  depth: form.depth,
  font: form.font,
  position: new THREE.Vector3(0, 10, 0), // Will be repositioned by 3DScene
  rotation: new THREE.Euler(-Math.PI / 2, 0, 0), // Face up
  sectionId, // Include section ID if provided
});

/** Dispatches a label-related custom event */
const dispatchLabelEvent = (eventName: string, detail: unknown): void => {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** 3D preview of the label */
const Label3DPreview: React.FC<Label3DPreviewProps> = ({ text, fontSize, depth, font }) => {
  const scale = PREVIEW_TARGET_SIZE / Math.max(fontSize, PREVIEW_MIN_FONT);
  const fontFile = getFontFile(font);

  return (
    <Center scale={scale}>
      <Text3D
        font={fontFile}
        size={fontSize}
        height={depth}
        curveSegments={4}
        bevelEnabled={false}
      >
        {text || 'Label'}
        <meshStandardMaterial color="#4080ff" metalness={0.2} roughness={0.6} />
      </Text3D>
    </Center>
  );
};

/** Alert shown when prerequisites are not met */
const PrerequisiteAlert: React.FC<{ message: string }> = ({ message }) => (
  <div className="p-4">
    <Alert className="font-tech">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="text-xs">{message}</AlertDescription>
    </Alert>
  </div>
);

/** 3D preview canvas card */
const PreviewCard: React.FC<Label3DPreviewProps> = (props) => (
  <Card className="tech-glass overflow-hidden">
    <div className="h-[140px] bg-gradient-to-b from-background to-muted/20">
      <Canvas camera={PREVIEW_CAMERA}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 10]} intensity={0.8} />
        <Suspense fallback={null}>
          <Label3DPreview {...props} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={PREVIEW_POLAR_ANGLE.min}
          maxPolarAngle={PREVIEW_POLAR_ANGLE.max}
        />
      </Canvas>
    </div>
    <div className="p-2 text-center border-t border-border/50">
      <p className="text-[10px] text-muted-foreground font-tech">3D Preview</p>
    </div>
  </Card>
);

/** Font selection dropdown */
const FontSelect: React.FC<{
  value: LabelFont;
  onChange: (value: LabelFont) => void;
}> = ({ value, onChange }) => (
  <div className="space-y-2">
    <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
      Font
    </Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Select font" />
      </SelectTrigger>
      <SelectContent>
        {LABEL_FONTS.map((f) => (
          <SelectItem key={f.value} value={f.value} className="text-xs">
            {f.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

/** Slider control with badge */
const SliderControl: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  formatValue?: (v: number) => string;
  helpText?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, unit = 'mm', formatValue, helpText, onChange }) => (
  <div className="space-y-3">
    <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
      {label}
    </Label>
    <div className="flex items-center gap-3">
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="flex-1"
      />
      <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
        {formatValue ? formatValue(value) : value}
        {unit}
      </Badge>
    </div>
    {helpText && <p className="text-[10px] text-muted-foreground font-tech">{helpText}</p>}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Hook to listen for label selection from 3D scene */
function useLabelSelectionListener(onSelectLabel?: (id: string | null) => void): void {
  useEffect(() => {
    const handleLabelSelected = (e: Event): void => {
      onSelectLabel?.((e as CustomEvent).detail);
    };

    window.addEventListener('label-selected', handleLabelSelected);
    return () => window.removeEventListener('label-selected', handleLabelSelected);
  }, [onSelectLabel]);
}

/** Hook to listen for label position updates from 3D scene */
function useLabelAddedListener(
  onUpdateLabel?: (labelId: string, updates: Partial<LabelConfig>) => void
): void {
  useEffect(() => {
    const handleLabelAdded = (e: Event): void => {
      const label = (e as CustomEvent).detail as LabelConfig;
      onUpdateLabel?.(label.id, { position: label.position, rotation: label.rotation });
    };

    window.addEventListener('label-added', handleLabelAdded);
    return () => window.removeEventListener('label-added', handleLabelAdded);
  }, [onUpdateLabel]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const LabelsStepContent: React.FC<LabelsStepContentProps> = ({
  hasWorkpiece = false,
  hasBaseplate = false,
  hasSupports = false,
  labels = [],
  selectedLabelId = null,
  onUpdateLabel,
  onDeleteLabel,
  onSelectLabel,
  projectName = 'Untitled',
  currentBaseplate = null,
  selectedSectionId = null,
  onSectionSelect,
}) => {
  // Generate default label text from project name
  const defaultLabelText = `${projectName} V1.0`;
  
  // Form state
  const [labelText, setLabelText] = useState(defaultLabelText);
  const [fontSize, setFontSize] = useState(DEFAULT_LABEL_CONFIG.fontSize);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [font, setFont] = useState<LabelFont>(DEFAULT_LABEL_CONFIG.font);

  // Check if using multi-section baseplate
  const isMultiSection = currentBaseplate?.type === 'multi-section';
  const sections = currentBaseplate?.sections || [];

  // Find selected label
  const selectedLabel = useMemo(
    () => labels.find((l) => l.id === selectedLabelId),
    [labels, selectedLabelId]
  );

  // Sync form with selected label
  useEffect(() => {
    if (!selectedLabel) return;

    setLabelText(selectedLabel.text);
    setFontSize(selectedLabel.fontSize);
    setDepth(selectedLabel.depth);
    setFont(selectedLabel.font || 'helvetiker');
  }, [selectedLabel]);

  // Update default label text when project name changes (only when no label is selected)
  useEffect(() => {
    if (!selectedLabel) {
      setLabelText(`${projectName} V1.0`);
    }
  }, [projectName, selectedLabel]);

  // Event listeners
  useLabelSelectionListener(onSelectLabel);
  useLabelAddedListener(onUpdateLabel);

  // Handlers
  const updateSelectedLabel = useCallback(
    (updates: Partial<LabelConfig>): void => {
      if (!selectedLabelId) return;

      dispatchLabelEvent('label-update', { labelId: selectedLabelId, updates });
      onUpdateLabel?.(selectedLabelId, updates);
    },
    [selectedLabelId, onUpdateLabel]
  );

  const handleAddLabel = useCallback((): void => {
    // Don't pass sectionId - let 3DScene handle section selection for multi-section baseplates
    const newLabel = createLabelConfig({ text: labelText, fontSize, depth, font }, undefined);
    dispatchLabelEvent('label-add', newLabel);
  }, [labelText, fontSize, depth, font]);

  const handleFontChange = useCallback(
    (value: LabelFont): void => {
      setFont(value);
      if (selectedLabelId) updateSelectedLabel({ font: value });
    },
    [selectedLabelId, updateSelectedLabel]
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const value = e.target.value;
      setLabelText(value);
      if (selectedLabelId) updateSelectedLabel({ text: value });
    },
    [selectedLabelId, updateSelectedLabel]
  );

  const handleFontSizeChange = useCallback(
    (value: number): void => {
      setFontSize(value);
      if (selectedLabelId) updateSelectedLabel({ fontSize: value });
    },
    [selectedLabelId, updateSelectedLabel]
  );

  const handleDepthChange = useCallback(
    (value: number): void => {
      setDepth(value);
      if (selectedLabelId) updateSelectedLabel({ depth: value });
    },
    [selectedLabelId, updateSelectedLabel]
  );

  // Prerequisite checks
  if (!hasWorkpiece) {
    return <PrerequisiteAlert message="Import a workpiece to add labels." />;
  }
  if (!hasBaseplate) {
    return <PrerequisiteAlert message="Create a baseplate first before adding labels." />;
  }
  if (!hasSupports) {
    return (
      <PrerequisiteAlert message="Add supports first before adding labels. Labels are positioned outside the support area." />
    );
  }

  const canAddLabel = labelText.trim().length > 0;

  return (
    <div className="p-4 space-y-4 overflow-auto max-h-[calc(100vh-200px)]">
      {/* Labels Status - Small indicator */}
      {labels.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-tech text-green-600">
            {labels.length} label{labels.length !== 1 ? 's' : ''} placed
          </span>
          <span className="text-xs text-muted-foreground font-tech ml-auto">
            View in Properties Panel →
          </span>
        </div>
      )}

      {/* 3D Preview */}
      <PreviewCard text={labelText} fontSize={fontSize} depth={depth} font={font} />

      {/* Font Selection */}
      <FontSelect value={font} onChange={handleFontChange} />

      {/* Label Text Input */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Label Text
        </Label>
        <Input
          value={labelText}
          onChange={handleTextChange}
          placeholder="Enter label text..."
          className="font-tech"
        />
      </div>

      {/* Font Size */}
      <SliderControl
        label={`Font Size (min ${MIN_FONT_SIZE}mm)`}
        value={fontSize}
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        step={1}
        onChange={handleFontSizeChange}
      />

      {/* Emboss Height */}
      <SliderControl
        label="Emboss Height"
        value={depth}
        min={MIN_DEPTH}
        max={MAX_DEPTH}
        step={0.1}
        formatValue={(v) => v.toFixed(1)}
        helpText={`Default: ${DEFAULT_DEPTH}mm. Use Z-axis gizmo to adjust after placing.`}
        onChange={handleDepthChange}
      />

      <Separator />

      {/* Add Label Button */}
      <Button
        variant="default"
        size="sm"
        className="w-full font-tech"
        onClick={handleAddLabel}
        disabled={!canAddLabel}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Label to Scene
      </Button>

      <p className="text-[10px] text-muted-foreground font-tech text-center">
        {isMultiSection 
          ? "Click 'Add Label to Scene', then select a baseplate section to place the label."
          : "Click on the baseplate or fixture to position the label."}
        <br />
        Use the gizmo to reposition. Z-axis adjusts emboss depth.
      </p>

      {/* Labels count indicator */}
      {labels.length > 0 && (
        <p className="text-[10px] text-muted-foreground font-tech text-center">
          {labels.length} label{labels.length !== 1 ? 's' : ''} added. View and edit in Properties
          panel.
        </p>
      )}
    </div>
  );
};

export default LabelsStepContent;
