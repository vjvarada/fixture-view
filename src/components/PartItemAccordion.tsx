/**
 * PartItemAccordion
 *
 * Individual part item within the Parts accordion.
 * Handles transform controls and part actions.
 */

import React, { useCallback, useMemo } from 'react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RotateCcw, Move, RotateCw, Trash2, ArrowDownToLine, Eye, EyeOff } from 'lucide-react';
import { ProcessedFile } from '@/modules/FileImport/types';
import { PartThumbnail } from '@rapidtool/cad-ui';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Position3D {
  x: number;
  y: number;
  z: number;
}

interface PartItemAccordionProps {
  /** Part data */
  part: ProcessedFile;
  /** Whether this part is selected */
  isSelected: boolean;
  /** CAD-convention position */
  cadPosition: Position3D;
  /** CAD-convention rotation in degrees */
  cadRotation: Position3D;
  /** Part color */
  color?: string;
  /** Whether part is visible */
  isVisible: boolean;
  /** Whether baseplate exists */
  hasBaseplate: boolean;
  /** Position change handler */
  onPositionChange: (partId: string, axis: 'x' | 'y' | 'z', value: string) => void;
  /** Rotation change handler */
  onRotationChange: (partId: string, axis: 'x' | 'y' | 'z', value: string) => void;
  /** Reset position handler */
  onResetPosition: (partId: string) => void;
  /** Reset rotation handler */
  onResetRotation: (partId: string) => void;
  /** Set to baseplate handler */
  onSetToBaseplate: (partId: string) => void;
  /** Visibility change handler */
  onVisibilityChange?: (partId: string, visible: boolean) => void;
  /** Remove part handler */
  onRemove?: (partId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface AxisInputProps {
  label: string;
  value: number;
  onChange: (value: string) => void;
  colorClass: string;
  step?: string;
  decimals?: number;
}

const AxisInput: React.FC<AxisInputProps> = ({
  label,
  value,
  onChange,
  colorClass,
  step = '0.1',
  decimals = 2,
}) => (
  <div className="space-y-1">
    <Label className={cn('text-[8px] font-mono', colorClass)}>{label}</Label>
    <Input
      type="number"
      value={value.toFixed(decimals)}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 !text-[10px] font-mono"
      step={step}
    />
  </div>
);

interface TransformSectionProps {
  title: string;
  icon: React.ReactNode;
  values: Position3D;
  onAxisChange: (axis: 'x' | 'y' | 'z', value: string) => void;
  onReset: () => void;
  step?: string;
  decimals?: number;
  extraButton?: React.ReactNode;
}

const TransformSection: React.FC<TransformSectionProps> = ({
  title,
  icon,
  values,
  onAxisChange,
  onReset,
  step = '0.1',
  decimals = 2,
  extraButton,
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
        {icon}
        {title}
      </Label>
      <div className="flex items-center gap-1">
        {extraButton}
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="h-5 px-1.5 text-[8px]"
          title={`Reset ${title.toLowerCase()}`}
          aria-label={`Reset ${title.toLowerCase()}`}
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </Button>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 pl-1">
      <AxisInput
        label="X"
        value={values.x}
        onChange={(v) => onAxisChange('x', v)}
        colorClass="text-red-500"
        step={step}
        decimals={decimals}
      />
      <AxisInput
        label="Z"
        value={values.y}
        onChange={(v) => onAxisChange('y', v)}
        colorClass="text-green-500"
        step={step}
        decimals={decimals}
      />
      <AxisInput
        label="Y"
        value={values.z}
        onChange={(v) => onAxisChange('z', v)}
        colorClass="text-blue-500"
        step={step}
        decimals={decimals}
      />
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const PartItemAccordion: React.FC<PartItemAccordionProps> = ({
  part,
  isSelected,
  cadPosition,
  cadRotation,
  color,
  isVisible,
  hasBaseplate,
  onPositionChange,
  onRotationChange,
  onResetPosition,
  onResetRotation,
  onSetToBaseplate,
  onVisibilityChange,
  onRemove,
}) => {
  const handlePositionChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: string) => {
      onPositionChange(part.id, axis, value);
    },
    [part.id, onPositionChange]
  );

  const handleRotationChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: string) => {
      onRotationChange(part.id, axis, value);
    },
    [part.id, onRotationChange]
  );

  const handleVisibilityToggle = useCallback(() => {
    onVisibilityChange?.(part.id, !isVisible);
  }, [part.id, isVisible, onVisibilityChange]);

  const handleRemove = useCallback(() => {
    onRemove?.(part.id);
  }, [part.id, onRemove]);

  const baseplateButton = useMemo(
    () =>
      hasBaseplate ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetToBaseplate(part.id)}
          className="h-5 px-1.5 text-[8px]"
          title="Set to baseplate"
          aria-label="Set to baseplate"
        >
          <ArrowDownToLine className="w-2.5 h-2.5" />
        </Button>
      ) : null,
    [hasBaseplate, onSetToBaseplate, part.id]
  );

  // Format dimensions for display (swap Y and Z for CAD convention)
  const dimensionText = useMemo(
    () =>
      `${part.metadata.dimensions.x.toFixed(1)} × ${part.metadata.dimensions.z.toFixed(1)} × ${part.metadata.dimensions.y.toFixed(1)} ${part.metadata.units}`,
    [part.metadata]
  );

  return (
    <AccordionItem
      value={`part-${part.id}`}
      className={cn(
        'border rounded-md transition-all',
        isSelected ? 'border-primary bg-primary/5' : 'border-border/30'
      )}
    >
      <AccordionTrigger className="py-1.5 px-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2 flex-1">
          <PartThumbnail
            mesh={part.mesh}
            size={28}
            className="flex-shrink-0 border border-border/30"
            color={color}
          />
          <div className="flex-1 min-w-0 text-left">
            <p
              className="font-tech font-medium text-[10px] truncate"
              title={part.metadata.name}
            >
              {part.metadata.name}
            </p>
            <p className="text-[8px] text-muted-foreground">
              {part.metadata.triangles?.toLocaleString()} tri • {part.metadata.units}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            {onVisibilityChange && (
              <IconButton
                onClick={handleVisibilityToggle}
                title={isVisible ? 'Hide part' : 'Show part'}
                icon={
                  isVisible ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3" />
                  )
                }
                variant="ghost"
                isActive={isVisible}
              />
            )}
            {onRemove && (
              <IconButton
                onClick={handleRemove}
                title="Remove part"
                icon={<Trash2 className="w-3 h-3" />}
                variant="destructive"
              />
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-2 pb-2">
        {/* Part Info */}
        <div className="text-[8px] text-muted-foreground font-tech mb-3 p-2 rounded bg-muted/30">
          <span>Size: </span>
          <span className="font-mono">{dimensionText}</span>
        </div>

        {/* Position & Rotation Controls */}
        <div className="space-y-3">
          <TransformSection
            title="Position (mm)"
            icon={<Move className="w-2.5 h-2.5" />}
            values={cadPosition}
            onAxisChange={handlePositionChange}
            onReset={() => onResetPosition(part.id)}
            extraButton={baseplateButton}
          />

          <TransformSection
            title="Rotation (°)"
            icon={<RotateCw className="w-2.5 h-2.5" />}
            values={cadRotation}
            onAxisChange={handleRotationChange}
            onReset={() => onResetRotation(part.id)}
            step="1"
            decimals={1}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

export default PartItemAccordion;
