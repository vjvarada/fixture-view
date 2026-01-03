/**
 * VerticalToolbar
 *
 * Main workflow toolbar with tool selection buttons.
 * Pure presentational component with proper accessibility.
 */

import React, { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Upload,
  Grid3X3,
  Cuboid,
  SquaresSubtract,
  Pin,
  Type,
  CircleDashed,
  Scissors,
  DownloadCloud,
  LucideIcon,
  UserCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToolId =
  | 'import'
  | 'baseplates'
  | 'supports'
  | 'clamps'
  | 'labels'
  | 'cavity'
  | 'drill'
  | 'export';

interface ToolConfig {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  tooltip: string;
}

interface VerticalToolbarProps {
  /** Callback when a tool is selected */
  onToolSelect?: (tool: ToolId) => void;
  /** Additional CSS classes */
  className?: string;
  /** Currently active tool */
  activeTool?: ToolId;
  /** Callback when account button is clicked */
  onAccountClick?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS: readonly ToolConfig[] = [
  { id: 'import', icon: Upload, label: 'Import', tooltip: 'Import Workpieces / Models' },
  { id: 'baseplates', icon: Grid3X3, label: 'Baseplates', tooltip: 'Choose From Different Baseplates' },
  { id: 'supports', icon: Cuboid, label: 'Supports', tooltip: 'Create Supports by Extruding a Sketch' },
  { id: 'clamps', icon: Pin, label: 'Clamps', tooltip: 'Clamp Workpieces with Standard Components' },
  { id: 'labels', icon: Type, label: 'Labels', tooltip: 'Set Labels (e.g., Version Numbers)' },
  { id: 'drill', icon: CircleDashed, label: 'Mounting Holes', tooltip: 'Add Mounting Holes to Fixture' },
  { id: 'cavity', icon: SquaresSubtract, label: 'Cavity', tooltip: 'Subtract Workpieces From Fixture Geometry' },
  { id: 'export', icon: DownloadCloud, label: 'Export', tooltip: 'Export Fixture for 3D Printing' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface ToolButtonProps {
  tool: ToolConfig;
  isActive: boolean;
  onClick: () => void;
}

const ToolButton: React.FC<ToolButtonProps> = React.memo(({ tool, isActive, onClick }) => {
  const Icon = tool.icon;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={tool.label}
      aria-pressed={isActive}
      className={cn(
        'w-10 h-10 p-0 tech-transition justify-center rounded-md focus-visible:ring-2 focus-visible:ring-primary',
        isActive
          ? 'bg-primary/15 text-primary border border-primary/20'
          : 'hover:bg-primary/10 hover:text-primary'
      )}
      title={tool.tooltip}
    >
      <Icon className="w-5 h-5" />
    </Button>
  );
});

ToolButton.displayName = 'ToolButton';

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const VerticalToolbar: React.FC<VerticalToolbarProps> = ({
  onToolSelect,
  className = '',
  activeTool,
  onAccountClick,
}) => {
  const handleToolClick = useCallback(
    (toolId: ToolId) => {
      onToolSelect?.(toolId);
    },
    [onToolSelect]
  );

  const toolButtons = useMemo(
    () =>
      TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          isActive={activeTool === tool.id}
          onClick={() => handleToolClick(tool.id)}
        />
      )),
    [activeTool, handleToolClick]
  );

  return (
    <nav
      className={cn('vertical-toolbar flex flex-col h-full', className)}
      role="toolbar"
      aria-label="Fixture design tools"
    >
      {/* Main Tools */}
      <div className="flex flex-col gap-2 p-2 flex-1">{toolButtons}</div>
      
      {/* Account Button at Bottom */}
      <div className="p-2 border-t border-border/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={onAccountClick}
          aria-label="Account Settings"
          className="w-10 h-10 p-0 tech-transition justify-center rounded-md hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
          title="Account Settings"
        >
          <UserCircle2 className="w-5 h-5" />
        </Button>
      </div>
    </nav>
  );
};

export default VerticalToolbar;