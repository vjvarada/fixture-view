/**
 * CADLayout
 * 
 * Main layout shell for CAD applications.
 * Provides a flexible layout with toolbar, sidebar, and main content area.
 * 
 * @module @rapidtool/cad-ui/layout
 */

import React from 'react';

// ============================================================================
// Types
// ============================================================================

export interface CADLayoutProps {
  /** Toolbar content (typically VerticalToolbar) */
  toolbar?: React.ReactNode;
  /** Left sidebar content (typically property panels) */
  sidebar?: React.ReactNode;
  /** Main content area (typically 3D viewport) */
  children: React.ReactNode;
  /** Header/title bar content */
  header?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Right panel content (optional secondary sidebar) */
  rightPanel?: React.ReactNode;
  /** Whether to show the sidebar */
  showSidebar?: boolean;
  /** Sidebar width in pixels */
  sidebarWidth?: number;
  /** Toolbar position */
  toolbarPosition?: 'left' | 'right';
  /** Additional CSS classes */
  className?: string;
  /** Theme mode for styling */
  theme?: 'light' | 'dark';
}

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: 'var(--background, #ffffff)',
    color: 'var(--foreground, #1f2937)',
  },
  header: {
    flexShrink: 0,
    borderBottom: '1px solid var(--border, #e5e7eb)',
    backgroundColor: 'var(--card, #ffffff)',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  toolbar: {
    flexShrink: 0,
    borderRight: '1px solid var(--border, #e5e7eb)',
    backgroundColor: 'var(--card, #ffffff)',
    display: 'flex',
    flexDirection: 'column',
  },
  toolbarRight: {
    borderRight: 'none',
    borderLeft: '1px solid var(--border, #e5e7eb)',
  },
  sidebar: {
    flexShrink: 0,
    borderRight: '1px solid var(--border, #e5e7eb)',
    backgroundColor: 'var(--card, #ffffff)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarContent: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'var(--background, #f9fafb)',
  },
  rightPanel: {
    flexShrink: 0,
    borderLeft: '1px solid var(--border, #e5e7eb)',
    backgroundColor: 'var(--card, #ffffff)',
    overflow: 'hidden',
  },
  footer: {
    flexShrink: 0,
    borderTop: '1px solid var(--border, #e5e7eb)',
    backgroundColor: 'var(--card, #ffffff)',
  },
};

// ============================================================================
// Main Component
// ============================================================================

export const CADLayout: React.FC<CADLayoutProps> = ({
  toolbar,
  sidebar,
  children,
  header,
  footer,
  rightPanel,
  showSidebar = true,
  sidebarWidth = 320,
  toolbarPosition = 'left',
  className,
  theme,
}) => {
  const containerStyle: React.CSSProperties = {
    ...styles.container,
    ...(theme === 'dark' ? { 
      '--background': '#0f172a',
      '--foreground': '#f8fafc',
      '--card': '#1e293b',
      '--border': '#334155',
    } as React.CSSProperties : {}),
  };

  return (
    <div style={containerStyle} className={className} data-theme={theme}>
      {/* Header */}
      {header && <div style={styles.header}>{header}</div>}

      {/* Main Area */}
      <div style={styles.main}>
        {/* Toolbar (left position) */}
        {toolbar && toolbarPosition === 'left' && (
          <div style={styles.toolbar}>{toolbar}</div>
        )}

        {/* Sidebar */}
        {sidebar && showSidebar && (
          <div style={{ ...styles.sidebar, width: sidebarWidth }}>
            <div style={styles.sidebarContent}>{sidebar}</div>
          </div>
        )}

        {/* Main Content */}
        <div style={styles.content}>{children}</div>

        {/* Right Panel */}
        {rightPanel && (
          <div style={{ ...styles.rightPanel, width: sidebarWidth }}>
            {rightPanel}
          </div>
        )}

        {/* Toolbar (right position) */}
        {toolbar && toolbarPosition === 'right' && (
          <div style={{ ...styles.toolbar, ...styles.toolbarRight }}>{toolbar}</div>
        )}
      </div>

      {/* Footer */}
      {footer && <div style={styles.footer}>{footer}</div>}
    </div>
  );
};

export default CADLayout;
