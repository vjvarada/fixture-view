/**
 * Isometric View Icons
 * 
 * Custom SVG icons for view orientation controls.
 * These are small perspective cube icons for view switching.
 */

import React from 'react';

interface IconProps {
  className?: string;
}

/**
 * Isometric view icon with right face filled
 */
export const IconIsoFace: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* top diamond */}
    <polygon points="12,4 19,8 12,12 5,8" fill="none" />
    {/* left face */}
    <polygon points="5,8 12,12 12,20 5,16" fill="none" />
    {/* right face (filled) */}
    <polygon points="19,8 12,12 12,20 19,16" fill="currentColor" />
    {/* edges */}
    <polyline points="5,8 12,12 19,8" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);

/**
 * Isometric view icon with top face filled
 */
export const IconIsoTop: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* top diamond (filled) */}
    <polygon points="12,4 19,8 12,12 5,8" fill="currentColor" />
    {/* side outlines */}
    <polygon points="5,8 12,12 12,20 5,16" fill="none" />
    <polygon points="19,8 12,12 12,20 19,16" fill="none" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);

/**
 * Top face only icon
 */
export const IconTopFace: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="12,6 18,10 12,14 6,10" fill="currentColor" />
    <polygon points="6,10 12,14 18,10 12,6 6,10" fill="none" />
  </svg>
);

/**
 * Isometric view icon with left face filled
 */
export const IconIsoLeftFace: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="12,4 19,8 12,12 5,8" fill="none" />
    <polygon points="5,8 12,12 12,20 5,16" fill="currentColor" />
    <polygon points="19,8 12,12 12,20 19,16" fill="none" />
    <polyline points="5,8 12,12 19,8" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);

/**
 * Isometric corner view icon - all three faces visible with gradient shading
 * Used for isometric/3D perspective view
 */
export const IconIsoCorner: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* top face - lightest */}
    <polygon points="12,4 19,8 12,12 5,8" fill="currentColor" fillOpacity="0.3" />
    {/* left face - medium */}
    <polygon points="5,8 12,12 12,20 5,16" fill="currentColor" fillOpacity="0.5" />
    {/* right face - darkest */}
    <polygon points="19,8 12,12 12,20 19,16" fill="currentColor" fillOpacity="0.7" />
    {/* edges */}
    <polyline points="5,8 12,12 19,8" />
    <polyline points="5,16 12,20 19,16" />
    <line x1="12" y1="12" x2="12" y2="20" />
  </svg>
);
