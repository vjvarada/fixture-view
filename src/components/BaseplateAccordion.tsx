/**
 * BaseplateAccordion
 *
 * Properties panel accordion for baseplate configuration.
 * Provides controls for padding, height, and visibility.
 */

import React, { useCallback } from 'react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Grid3X3, Square, Hexagon, Trash2, Maximize2, Move, Eye, EyeOff } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BaseplateConfig {
  id: string;
  type: string;
  padding?: number;
  height?: number;
}

interface BaseplateAccordionProps {
  /** Current baseplate configuration */
  baseplate: BaseplateConfig | null;
  /** Handler for removing baseplate */
  onRemoveBaseplate?: () => void;
  /** Handler for updating baseplate properties */
  onUpdateBaseplate?: (updates: Partial<BaseplateConfig>) => void;
  /** Whether baseplate is visible */
  visible?: boolean;
  /** Handler for visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PADDING = 10;
const DEFAULT_HEIGHT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/** Dispatches baseplate visibility change event */
const dispatchVisibilityEvent = (visible: boolean): void => {
  window.dispatchEvent(
    new CustomEvent('baseplate-visibility-changed', {
      detail: { visible },
    })
  );
};

/** Returns the appropriate icon for baseplate type */
const getBaseplateIcon = (type: string) =>
  type === 'convex-hull' ? Hexagon : Square;

/** Returns display name for baseplate type */
const getBaseplateTypeName = (type: string): string =>
  type === 'convex-hull' ? 'Convex Hull' : 'Rectangular';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Empty state when no baseplate is configured */
const EmptyState: React.FC = () => (
  <AccordionItem value="baseplate" className="border-border/50">
    <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
      <div className="flex items-center gap-2 flex-1">
        <Grid3X3 className="w-3.5 h-3.5 text-primary" />
        Baseplate
        <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
          None
        </Badge>
      </div>
    </AccordionTrigger>
    <AccordionContent className="pt-2">
      <div className="tech-glass p-4 text-center rounded-md border border-border/30">
        <Grid3X3 className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground font-tech">
          No baseplate configured
        </p>
        <p className="text-[10px] text-muted-foreground font-tech mt-1">
          Use the Baseplates step in the Context Panel to add a baseplate
        </p>
      </div>
    </AccordionContent>
  </AccordionItem>
);

interface PropertyInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  icon: React.ReactNode;
  description: string;
  min?: number;
  max?: number;
}

const PropertyInput: React.FC<PropertyInputProps> = ({
  label,
  value,
  onChange,
  icon,
  description,
  min = 0,
  max = 100,
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value) || 0);
    },
    [onChange]
  );

  return (
    <div className="space-y-2">
      <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </Label>
      <Input
        type="number"
        value={value.toFixed(0)}
        onChange={handleChange}
        className="h-6 !text-[10px] font-mono"
        step="1"
        min={min}
        max={max}
      />
      <p className="text-[8px] text-muted-foreground font-tech">{description}</p>
    </div>
  );
};

interface BaseplateHeaderProps {
  baseplate: BaseplateConfig;
  visible: boolean;
  onVisibilityToggle: () => void;
  onRemove?: () => void;
}

const BaseplateHeader: React.FC<BaseplateHeaderProps> = ({
  baseplate,
  visible,
  onVisibilityToggle,
  onRemove,
}) => {
  const TypeIcon = getBaseplateIcon(baseplate.type);

  return (
    <div className="py-1.5 px-2 flex items-center gap-2 border-b border-border/30">
      <div className="w-5 h-5 rounded bg-muted/50 flex items-center justify-center">
        <TypeIcon className="w-3 h-3 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-tech font-medium capitalize">
          {getBaseplateTypeName(baseplate.type)}
        </p>
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton
          onClick={onVisibilityToggle}
          title={visible ? 'Hide baseplate' : 'Show baseplate'}
          icon={visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          variant="ghost"
          isActive={visible}
        />
        {onRemove && (
          <IconButton
            onClick={onRemove}
            title="Remove baseplate"
            icon={<Trash2 className="w-3 h-3" />}
            variant="destructive"
          />
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const BaseplateAccordion: React.FC<BaseplateAccordionProps> = ({
  baseplate,
  onRemoveBaseplate,
  onUpdateBaseplate,
  visible = true,
  onVisibilityChange,
}) => {
  const handlePropertyChange = useCallback(
    (property: 'padding' | 'height', value: number) => {
      onUpdateBaseplate?.({ [property]: value });
    },
    [onUpdateBaseplate]
  );

  const handleVisibilityToggle = useCallback(() => {
    const newVisible = !visible;
    onVisibilityChange?.(newVisible);
    dispatchVisibilityEvent(newVisible);
  }, [visible, onVisibilityChange]);

  if (!baseplate) {
    return <EmptyState />;
  }

  return (
    <AccordionItem value="baseplate" className="border-border/50">
      <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2 flex-1">
          <Grid3X3 className="w-3.5 h-3.5 text-primary" />
          Baseplate
          <Badge
            variant="default"
            className="ml-auto font-tech text-[8px] h-4 bg-green-500/20 text-green-600 border-green-500/30"
          >
            Active
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2">
        <div className="space-y-1">
          <div
            className={cn(
              'border rounded-md transition-all',
              'border-primary bg-primary/5'
            )}
          >
            <BaseplateHeader
              baseplate={baseplate}
              visible={visible}
              onVisibilityToggle={handleVisibilityToggle}
              onRemove={onRemoveBaseplate}
            />

            <div className="p-2 space-y-3">
              <PropertyInput
                label="Padding (mm)"
                value={baseplate.padding ?? DEFAULT_PADDING}
                onChange={(value) => handlePropertyChange('padding', value)}
                icon={<Move className="w-2.5 h-2.5" />}
                description="Extra space around the workpiece boundary"
                min={0}
                max={100}
              />

              <PropertyInput
                label="Height (mm)"
                value={baseplate.height ?? DEFAULT_HEIGHT}
                onChange={(value) => handlePropertyChange('height', value)}
                icon={<Maximize2 className="w-2.5 h-2.5" />}
                description="Thickness of the baseplate"
                min={4}
                max={100}
              />
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

export default BaseplateAccordion;
