import React, { useState, Suspense, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Type, Plus } from 'lucide-react';
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
} from '@/components/Labels/types';

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
}

// 3D Preview component for the label
const Label3DPreview: React.FC<{
  text: string;
  fontSize: number;
  depth: number;
  font: LabelFont;
}> = ({ text, fontSize, depth, font }) => {
  // Scale factor to fit preview nicely
  const scale = 30 / Math.max(fontSize, 10);
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
        <meshStandardMaterial
          color="#4080ff"
          metalness={0.2}
          roughness={0.6}
        />
      </Text3D>
    </Center>
  );
};

const LabelsStepContent: React.FC<LabelsStepContentProps> = ({
  hasWorkpiece = false,
  hasBaseplate = false,
  hasSupports = false,
  labels = [],
  selectedLabelId = null,
  onAddLabel,
  onUpdateLabel,
  onDeleteLabel,
  onSelectLabel,
}) => {
  // Form state for new label
  const [labelText, setLabelText] = useState(DEFAULT_LABEL_CONFIG.text);
  const [fontSize, setFontSize] = useState(DEFAULT_LABEL_CONFIG.fontSize);
  const [depth, setDepth] = useState(DEFAULT_LABEL_CONFIG.depth);
  const [font, setFont] = useState<LabelFont>(DEFAULT_LABEL_CONFIG.font);

  // Get the selected label for properties panel
  const selectedLabel = labels.find(l => l.id === selectedLabelId);

  // Update form when a label is selected
  useEffect(() => {
    if (selectedLabel) {
      setLabelText(selectedLabel.text);
      setFontSize(selectedLabel.fontSize);
      setDepth(selectedLabel.depth);
      setFont(selectedLabel.font || 'helvetiker');
    }
  }, [selectedLabel]);

  // Listen for label selection from 3D scene
  useEffect(() => {
    const handleLabelSelected = (e: CustomEvent) => {
      onSelectLabel?.(e.detail);
    };
    window.addEventListener('label-selected', handleLabelSelected as EventListener);
    return () => window.removeEventListener('label-selected', handleLabelSelected as EventListener);
  }, [onSelectLabel]);

  // Listen for label added event (position update from 3DScene)
  useEffect(() => {
    const handleLabelAdded = (e: CustomEvent) => {
      const label = e.detail as LabelConfig;
      // Update the labels array with the positioned label
      onUpdateLabel?.(label.id, { position: label.position, rotation: label.rotation });
    };
    window.addEventListener('label-added', handleLabelAdded as EventListener);
    return () => window.removeEventListener('label-added', handleLabelAdded as EventListener);
  }, [onUpdateLabel]);

  if (!hasWorkpiece) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Import a workpiece to add labels.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasBaseplate) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Create a baseplate first before adding labels.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasSupports) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Add supports first before adding labels. Labels are positioned outside the support area.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleAddLabel = () => {
    const newLabel: LabelConfig = {
      id: `label-${Date.now()}`,
      text: labelText,
      fontSize,
      depth,
      font,
      position: new THREE.Vector3(0, 10, 0), // Will be positioned by 3DScene
      rotation: new THREE.Euler(-Math.PI / 2, 0, 0), // Face up by default
    };
    // Dispatch event for 3DScene to handle positioning and rendering
    // AppShell listens to 'label-added' event (dispatched by 3DScene after positioning)
    // so we don't call onAddLabel here to avoid duplicates
    window.dispatchEvent(new CustomEvent('label-add', { detail: newLabel }));
  };

  const handleUpdateSelectedLabel = (updates: Partial<LabelConfig>) => {
    if (selectedLabelId) {
      window.dispatchEvent(new CustomEvent('label-update', { detail: { labelId: selectedLabelId, updates } }));
      onUpdateLabel?.(selectedLabelId, updates);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedLabelId) {
      window.dispatchEvent(new CustomEvent('label-delete', { detail: selectedLabelId }));
      onDeleteLabel?.(selectedLabelId);
      onSelectLabel?.(null);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-auto max-h-[calc(100vh-200px)]">
      {/* 3D Preview */}
      <Card className="tech-glass overflow-hidden">
        <div className="h-[140px] bg-gradient-to-b from-background to-muted/20">
          <Canvas camera={{ position: [0, 0, 80], fov: 50 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 10, 10]} intensity={0.8} />
            <Suspense fallback={null}>
              <Label3DPreview
                text={labelText}
                fontSize={fontSize}
                depth={depth}
                font={font}
              />
            </Suspense>
            <OrbitControls
              enablePan={false}
              enableZoom={false}
              minPolarAngle={Math.PI / 3}
              maxPolarAngle={Math.PI / 2}
            />
          </Canvas>
        </div>
        <div className="p-2 text-center border-t border-border/50">
          <p className="text-[10px] text-muted-foreground font-tech">3D Preview</p>
        </div>
      </Card>

      {/* Font Selection */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Font
        </Label>
        <Select
          value={font}
          onValueChange={(value: LabelFont) => {
            setFont(value);
            if (selectedLabelId) {
              handleUpdateSelectedLabel({ font: value });
            }
          }}
        >
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

      {/* Label Text Input */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Label Text
        </Label>
        <Input
          value={labelText}
          onChange={(e) => {
            setLabelText(e.target.value);
            if (selectedLabelId) {
              handleUpdateSelectedLabel({ text: e.target.value });
            }
          }}
          placeholder="Enter label text..."
          className="font-tech"
        />
      </div>

      {/* Font Size */}
      <div className="space-y-3">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Font Size (min {MIN_FONT_SIZE}mm)
        </Label>
        <div className="flex items-center gap-3">
          <Slider
            value={[fontSize]}
            onValueChange={([v]) => {
              setFontSize(v);
              if (selectedLabelId) {
                handleUpdateSelectedLabel({ fontSize: v });
              }
            }}
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            className="flex-1"
          />
          <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
            {fontSize}mm
          </Badge>
        </div>
      </div>

      {/* Emboss Height */}
      <div className="space-y-3">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Emboss Height
        </Label>
        <div className="flex items-center gap-3">
          <Slider
            value={[depth]}
            onValueChange={([v]) => {
              setDepth(v);
              if (selectedLabelId) {
                handleUpdateSelectedLabel({ depth: v });
              }
            }}
            min={MIN_DEPTH}
            max={MAX_DEPTH}
            step={0.1}
            className="flex-1"
          />
          <Badge variant="secondary" className="font-tech min-w-[50px] justify-center">
            {depth.toFixed(1)}mm
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground font-tech">
          Default: {DEFAULT_DEPTH}mm. Use Z-axis gizmo to adjust after placing.
        </p>
      </div>

      <Separator />

      {/* Add Label Button */}
      <Button
        variant="default"
        size="sm"
        className="w-full font-tech"
        onClick={handleAddLabel}
        disabled={!labelText.trim()}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Label to Scene
      </Button>

      <p className="text-[10px] text-muted-foreground font-tech text-center">
        Click on the baseplate or fixture to position the label.
        <br />
        Use the gizmo to reposition. Z-axis adjusts emboss depth.
      </p>

      {/* Labels count indicator */}
      {labels.length > 0 && (
        <p className="text-[10px] text-muted-foreground font-tech text-center">
          {labels.length} label{labels.length !== 1 ? 's' : ''} added. View and edit in Properties panel.
        </p>
      )}
    </div>
  );
};

export default LabelsStepContent;
