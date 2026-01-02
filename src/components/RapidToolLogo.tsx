/**
 * RapidToolLogo - Brand logo component for the RapidTool suite
 * 
 * Displays "RapidTool" in Thuast font with:
 * - Zap icon in amber
 * - "Rapid" in foreground color
 * - "Tool" in primary/accent color
 * - Optional subscript for app name (e.g., "fixtures")
 * 
 * @module @/components/RapidToolLogo
 */

import React from 'react';
import { Zap } from 'lucide-react';

export interface RapidToolLogoProps {
  /** Subscript text (e.g., "fixtures", "assembly", etc.) */
  subscript?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show subscript */
  showSubscript?: boolean;
  /** Additional class names */
  className?: string;
}

const sizeConfig = {
  sm: {
    main: 'text-lg',        // ~18px
    subscript: 'text-[9px]',
    gap: 'gap-0',
    icon: 'w-[14px] h-[14px]',
    iconGap: 'gap-0.5',
  },
  md: {
    main: 'text-xl',        // ~20px
    subscript: 'text-[10px]',
    gap: 'gap-0.5',
    icon: 'w-4 h-4',        // 16px
    iconGap: 'gap-1',
  },
  lg: {
    main: 'text-3xl',       // ~30px
    subscript: 'text-xs',
    gap: 'gap-1',
    icon: 'w-6 h-6',        // 24px
    iconGap: 'gap-1',
  },
};

export const RapidToolLogo: React.FC<RapidToolLogoProps> = ({
  subscript = 'fixtures',
  size = 'sm',
  showSubscript = true,
  className = '',
}) => {
  const config = sizeConfig[size];

  return (
    <div className={`flex flex-col ${config.gap} leading-none ${className}`}>
      {/* Main logo row: RapidTool + Zap */}
      <div className={`flex items-center ${config.iconGap}`}>
        <div 
          className={`font-thuast ${config.main} tracking-tight`}
          style={{ fontFamily: "'Thuast', sans-serif" }}
        >
          <span className="text-foreground">Rapid</span>
          <span className="text-primary">Tool</span>
        </div>
        <Zap className={`${config.icon} text-amber-500 fill-amber-500 flex-shrink-0`} />
      </div>
      
      {/* Subscript - aligned with start */}
      {showSubscript && subscript && (
        <span 
          className={`font-tech ${config.subscript} text-muted-foreground tracking-widest uppercase`}
        >
          {subscript}
        </span>
      )}
    </div>
  );
};

export default RapidToolLogo;
