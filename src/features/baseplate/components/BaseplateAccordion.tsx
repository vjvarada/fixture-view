/**
 * BaseplateAccordion
 *
 * Properties panel accordion for baseplate configuration.
 * Provides controls for padding, height, and visibility.
 * Supports editing individual sections for multi-section baseplates.
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Grid3X3, Square, Hexagon, Trash2, Maximize2, Move, Eye, EyeOff, LayoutGrid, PenTool, ChevronDown, ChevronRight, Crosshair } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BasePlateSection } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BaseplateConfig {
  id: string;
  type: string;
  padding?: number;
  height?: number;
  sections?: BasePlateSection[];
}

/** Updates to a section's bounds */
interface SectionBoundsUpdate {
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
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
  /** Handler for removing individual section from multi-section baseplate */
  onRemoveSection?: (sectionId: string) => void;
  /** Handler for updating individual section bounds */
  onUpdateSection?: (sectionId: string, updates: SectionBoundsUpdate) => void;
  /** Handler for selecting a section (for 3D highlighting) */
  onSelectSection?: (sectionId: string | null) => void;
  /** Handler for starting to add more sections to multi-section baseplate */
  onAddSections?: () => void;
  /** ID of the selected section for highlighting */
  selectedSectionId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PADDING = 5;
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
const getBaseplateIcon = (type: string) => {
  if (type === 'convex-hull') return Hexagon;
  if (type === 'multi-section') return LayoutGrid;
  return Square;
};

/** Returns display name for baseplate type */
const getBaseplateTypeName = (type: string): string => {
  if (type === 'convex-hull') return 'Convex Hull';
  if (type === 'multi-section') return 'Multi-Section';
  return 'Rectangular';
};

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

/** Compact input for section dimension editing */
interface SectionDimensionInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}

const SectionDimensionInput: React.FC<SectionDimensionInputProps> = ({
  label,
  value,
  onChange,
  min = -10000,
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    if (!isNaN(newValue)) {
      onChange(newValue);
    }
  }, [onChange]);

  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] font-tech text-muted-foreground w-8">{label}</span>
      <Input
        type="number"
        value={value.toFixed(1)}
        onChange={handleChange}
        className="h-5 w-16 !text-[9px] font-mono px-1"
        step="0.5"
        min={min}
      />
    </div>
  );
};

interface SectionListItemProps {
  section: BasePlateSection;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onRemove?: (sectionId: string) => void;
  onUpdate?: (sectionId: string, updates: SectionBoundsUpdate) => void;
}

const SectionListItem: React.FC<SectionListItemProps> = React.memo(({
  section,
  index,
  isSelected,
  isExpanded,
  onToggleExpand,
  onSelect,
  onRemove,
  onUpdate,
}) => {
  const width = Math.abs(section.maxX - section.minX);
  const depth = Math.abs(section.maxZ - section.minZ);
  const centerX = (section.minX + section.maxX) / 2;
  const centerZ = (section.minZ + section.maxZ) / 2;

  // Update handlers that maintain center position when changing size
  const handleWidthChange = useCallback((newWidth: number) => {
    if (newWidth <= 0) return;
    const halfWidth = newWidth / 2;
    onUpdate?.(section.id, {
      minX: centerX - halfWidth,
      maxX: centerX + halfWidth,
    });
  }, [section.id, centerX, onUpdate]);

  const handleDepthChange = useCallback((newDepth: number) => {
    if (newDepth <= 0) return;
    const halfDepth = newDepth / 2;
    onUpdate?.(section.id, {
      minZ: centerZ - halfDepth,
      maxZ: centerZ + halfDepth,
    });
  }, [section.id, centerZ, onUpdate]);

  // Update handlers for position (moves the whole section)
  const handleCenterXChange = useCallback((newCenterX: number) => {
    const halfWidth = width / 2;
    onUpdate?.(section.id, {
      minX: newCenterX - halfWidth,
      maxX: newCenterX + halfWidth,
    });
  }, [section.id, width, onUpdate]);

  const handleCenterZChange = useCallback((newCenterZ: number) => {
    const halfDepth = depth / 2;
    onUpdate?.(section.id, {
      minZ: newCenterZ - halfDepth,
      maxZ: newCenterZ + halfDepth,
    });
  }, [section.id, depth, onUpdate]);

  return (
    <div
      className={cn(
        "rounded border transition-all",
        isSelected
          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
          : "bg-muted/30 border-border/30"
      )}
    >
      {/* Header row - always visible */}
      <div 
        className="flex items-center justify-between p-2 cursor-pointer"
        onClick={onSelect}
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
            <span className="text-[9px] font-tech text-primary">{index + 1}</span>
          </div>
          <div className="text-[9px] font-tech text-muted-foreground">
            {width.toFixed(1)} × {depth.toFixed(1)} mm
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {onRemove && (
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                onRemove(section.id);
              }}
              title="Remove section"
              icon={<Trash2 className="w-3 h-3" />}
              variant="ghost"
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded content - editable dimensions */}
      {isExpanded && (
        <div className="px-2 pb-2 pt-1 border-t border-border/30 space-y-2">
          {/* Size controls */}
          <div className="space-y-1">
            <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
              <Maximize2 className="w-2.5 h-2.5" />
              Size
            </Label>
            <div className="flex gap-2">
              <SectionDimensionInput
                label="W"
                value={width}
                onChange={handleWidthChange}
                min={10}
              />
              <SectionDimensionInput
                label="D"
                value={depth}
                onChange={handleDepthChange}
                min={10}
              />
            </div>
          </div>

          {/* Position controls */}
          <div className="space-y-1">
            <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
              <Crosshair className="w-2.5 h-2.5" />
              Center Position
            </Label>
            <div className="flex gap-2">
              <SectionDimensionInput
                label="X"
                value={centerX}
                onChange={handleCenterXChange}
              />
              <SectionDimensionInput
                label="Y"
                value={centerZ}
                onChange={handleCenterZChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

SectionListItem.displayName = 'SectionListItem';

interface SectionListProps {
  sections: BasePlateSection[];
  onRemoveSection?: (sectionId: string) => void;
  onUpdateSection?: (sectionId: string, updates: SectionBoundsUpdate) => void;
  onSelectSection?: (sectionId: string | null) => void;
  selectedSectionId?: string | null;
}

const SectionList: React.FC<SectionListProps> = ({ 
  sections, 
  onRemoveSection, 
  onUpdateSection,
  onSelectSection,
  selectedSectionId 
}) => {
  const sectionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);

  // Auto-expand selected section
  useEffect(() => {
    if (selectedSectionId) {
      setExpandedSectionId(selectedSectionId);
    }
  }, [selectedSectionId]);

  // Auto-scroll to selected section
  useEffect(() => {
    if (!selectedSectionId) return;

    const timer = setTimeout(() => {
      const element = sectionRefs.current.get(selectedSectionId);
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedSectionId]);

  const handleToggleExpand = useCallback((sectionId: string) => {
    setExpandedSectionId(prev => prev === sectionId ? null : sectionId);
  }, []);

  const handleSelectSection = useCallback((sectionId: string) => {
    onSelectSection?.(sectionId);
  }, [onSelectSection]);

  if (!sections?.length) return null;

  return (
    <div className="space-y-2">
      <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
        <LayoutGrid className="w-2.5 h-2.5" />
        Sections ({sections.length})
      </Label>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {sections.map((section, index) => (
          <div
            key={section.id}
            ref={(el) => sectionRefs.current.set(section.id, el)}
          >
            <SectionListItem
              section={section}
              index={index}
              isSelected={selectedSectionId === section.id}
              isExpanded={expandedSectionId === section.id}
              onToggleExpand={() => handleToggleExpand(section.id)}
              onSelect={() => handleSelectSection(section.id)}
              onRemove={onRemoveSection}
              onUpdate={onUpdateSection}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

SectionList.displayName = 'SectionList';

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const BaseplateAccordion: React.FC<BaseplateAccordionProps> = ({
  baseplate,
  onRemoveBaseplate,
  onUpdateBaseplate,
  visible = true,
  onVisibilityChange,
  onRemoveSection,
  onUpdateSection,
  onSelectSection,
  onAddSections,
  selectedSectionId = null,
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
              {/* Show sections list for multi-section baseplates */}
              {baseplate.type === 'multi-section' && baseplate.sections && (
                <>
                  <SectionList
                    sections={baseplate.sections}
                    onRemoveSection={onRemoveSection}
                    onUpdateSection={onUpdateSection}
                    onSelectSection={onSelectSection}
                    selectedSectionId={selectedSectionId}
                  />
                  
                  {/* Add Sections Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full font-tech text-xs"
                    onClick={onAddSections}
                  >
                    <PenTool className="w-3 h-3 mr-2" />
                    Add More Sections
                  </Button>
                </>
              )}
              
              <PropertyInput
                label="Padding (mm)"
                value={baseplate.padding ?? DEFAULT_PADDING}
                onChange={(value) => handlePropertyChange('padding', value)}
                icon={<Move className="w-2.5 h-2.5" />}
                description={baseplate.type === 'multi-section' 
                  ? 'Reserved space for features added later'
                  : 'Extra space around the workpiece boundary'
                }
                min={0}
                max={20}
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

BaseplateAccordion.displayName = 'BaseplateAccordion';

export default BaseplateAccordion;
