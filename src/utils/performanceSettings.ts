/**
 * Performance Settings for Low-Power Devices (Tablets, etc.)
 * 
 * Provides configurable quality levels to optimize rendering
 * performance on less powerful hardware.
 */

import { performanceLogger as logger } from './logger';

export type PerformanceLevel = 'high' | 'medium' | 'low' | 'auto';

export interface PerformanceSettings {
  // Rendering
  pixelRatio: number;
  antialias: boolean;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  
  // Geometry
  maxTriangles: number;
  autoDecimateOnImport: boolean;
  
  // Animation/Updates
  frameRateLimit: number | null; // null = unlimited
  
  // Effects
  enableAnimations: boolean;
  enableHoverEffects: boolean;
}

// Preset configurations
export const PERFORMANCE_PRESETS: Record<Exclude<PerformanceLevel, 'auto'>, PerformanceSettings> = {
  high: {
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    maxTriangles: 100_000,
    autoDecimateOnImport: false,
    frameRateLimit: null,
    enableAnimations: true,
    enableHoverEffects: true,
  },
  medium: {
    pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    maxTriangles: 50_000,
    autoDecimateOnImport: true,
    frameRateLimit: 30,
    enableAnimations: true,
    enableHoverEffects: true,
  },
  low: {
    pixelRatio: 1,
    antialias: false,
    shadowsEnabled: false,
    shadowMapSize: 512,
    maxTriangles: 25_000,
    autoDecimateOnImport: true,
    frameRateLimit: 24,
    enableAnimations: false,
    enableHoverEffects: false,
  },
};

// Storage key for persisting settings
const STORAGE_KEY = 'fixture-view-performance-settings';

/**
 * Detect if the device is likely a low-power device (tablet, mobile)
 */
export function detectDeviceCapability(): PerformanceLevel {
  // Check for mobile/tablet user agent
  const isMobileOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  
  // Check for touch support (common on tablets)
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // Check available memory (if supported)
  const memory = (navigator as any).deviceMemory;
  const isLowMemory = memory && memory < 4;
  
  // Check hardware concurrency (CPU cores)
  const cores = navigator.hardwareConcurrency || 4;
  const isLowCPU = cores < 4;
  
  // Check screen size (tablets typically < 1400px width in landscape)
  const isSmallScreen = window.screen.width < 1400;
  
  // WebGL capabilities check
  let webglTier: 'high' | 'medium' | 'low' = 'high';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        // Mobile GPUs typically have these keywords
        if (/Mali|Adreno|PowerVR|Apple GPU|Intel.*HD/i.test(renderer)) {
          webglTier = 'medium';
        }
        if (/Mali-[T4]|Adreno [234]/i.test(renderer)) {
          webglTier = 'low';
        }
      }
    }
  } catch (e) {
    // WebGL detection failed, assume medium
    webglTier = 'medium';
  }
  
  // Score-based decision
  let score = 0;
  if (isMobileOrTablet) score += 2;
  if (hasTouch && isSmallScreen) score += 1;
  if (isLowMemory) score += 2;
  if (isLowCPU) score += 1;
  if (webglTier === 'low') score += 2;
  else if (webglTier === 'medium') score += 1;
  
  logger.debug(`Device detection score: ${score}`, {
    isMobileOrTablet,
    hasTouch,
    isLowMemory,
    isLowCPU,
    isSmallScreen,
    webglTier,
  });
  
  if (score >= 4) return 'low';
  if (score >= 2) return 'medium';
  return 'high';
}

// Current settings state
let currentSettings: PerformanceSettings = PERFORMANCE_PRESETS.high;
let currentLevel: PerformanceLevel = 'high';

/**
 * Initialize performance settings
 * Call this early in app startup
 */
export function initPerformanceSettings(level: PerformanceLevel = 'auto'): PerformanceSettings {
  // Try to load from storage first
  const savedLevel = loadSavedLevel();
  
  if (savedLevel && level === 'auto') {
    currentLevel = savedLevel;
  } else if (level === 'auto') {
    currentLevel = detectDeviceCapability();
  } else {
    currentLevel = level;
  }
  
  currentSettings = PERFORMANCE_PRESETS[currentLevel === 'auto' ? 'high' : currentLevel];
  
  logger.info(`Initialized with level: ${currentLevel}`, currentSettings);
  
  // Dispatch event so components can react
  window.dispatchEvent(new CustomEvent('performance-settings-changed', { 
    detail: { level: currentLevel, settings: currentSettings } 
  }));
  
  return currentSettings;
}

/**
 * Get current performance settings
 */
export function getPerformanceSettings(): PerformanceSettings {
  return currentSettings;
}

/**
 * Get current performance level
 */
export function getPerformanceLevel(): PerformanceLevel {
  return currentLevel;
}

/**
 * Set performance level and persist
 */
export function setPerformanceLevel(level: Exclude<PerformanceLevel, 'auto'>): PerformanceSettings {
  currentLevel = level;
  currentSettings = PERFORMANCE_PRESETS[level];
  
  // Persist to localStorage
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch (e) {
    logger.warn('Failed to save settings:', e);
  }
  
  logger.info(`Changed to level: ${level}`, currentSettings);
  
  // Dispatch event so components can react
  window.dispatchEvent(new CustomEvent('performance-settings-changed', { 
    detail: { level, settings: currentSettings } 
  }));
  
  return currentSettings;
}

/**
 * Load saved level from storage
 */
function loadSavedLevel(): Exclude<PerformanceLevel, 'auto'> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'high' || saved === 'medium' || saved === 'low')) {
      return saved;
    }
  } catch (e) {
    // Storage not available
  }
  return null;
}

/**
 * Check if current settings allow a feature
 */
export function isFeatureEnabled(feature: keyof Pick<PerformanceSettings, 'shadowsEnabled' | 'enableAnimations' | 'enableHoverEffects'>): boolean {
  return currentSettings[feature];
}

/**
 * Get recommended decimation target based on current settings
 */
export function getDecimationTarget(): number {
  return currentSettings.maxTriangles;
}

/**
 * Check if model should be auto-decimated based on triangle count
 */
export function shouldAutoDecimate(triangleCount: number): boolean {
  return currentSettings.autoDecimateOnImport && triangleCount > currentSettings.maxTriangles;
}

/**
 * Device capabilities information
 */
export interface DeviceCapabilities {
  // Hardware
  cpuCores: number;
  deviceMemoryGB: number | null;
  platform: string;
  userAgent: string;
  
  // Display
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
  
  // GPU/WebGL
  gpuVendor: string | null;
  gpuRenderer: string | null;
  webglVersion: string;
  maxTextureSize: number;
  maxViewportSize: number[];
  
  // Features
  hasTouch: boolean;
  isMobile: boolean;
  isTablet: boolean;
  
  // Performance estimate
  estimatedTier: 'high' | 'medium' | 'low';
  recommendedLevel: PerformanceLevel;
}

/**
 * Get detailed device capabilities
 * Shows exactly what hardware the browser can detect
 */
export function getDeviceCapabilities(): DeviceCapabilities {
  const ua = navigator.userAgent;
  const isMobile = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const isTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua) || 
    (navigator.maxTouchPoints > 0 && window.screen.width >= 768 && window.screen.width < 1400);
  
  // GPU info
  let gpuVendor: string | null = null;
  let gpuRenderer: string | null = null;
  let webglVersion = 'none';
  let maxTextureSize = 0;
  let maxViewportSize = [0, 0];
  
  try {
    const canvas = document.createElement('canvas');
    let gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl) {
      webglVersion = 'WebGL 2.0';
    } else {
      gl = canvas.getContext('webgl') as WebGL2RenderingContext | null;
      if (gl) webglVersion = 'WebGL 1.0';
    }
    
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      }
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maxVp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      maxViewportSize = [maxVp[0], maxVp[1]];
    }
  } catch (e) {
    logger.warn('WebGL detection failed:', e);
  }
  
  // Estimate tier based on GPU
  let estimatedTier: 'high' | 'medium' | 'low' = 'high';
  if (gpuRenderer) {
    // High-end GPUs
    if (/RTX|GTX 10[6789]|GTX 20|Radeon RX [56789]|Radeon Pro|Quadro/i.test(gpuRenderer)) {
      estimatedTier = 'high';
    }
    // Mid-range / integrated
    else if (/GTX 10[0-5]|Intel.*Iris|Intel.*UHD|Radeon [56]|GeForce MX/i.test(gpuRenderer)) {
      estimatedTier = 'medium';
    }
    // Low-end / old integrated / mobile
    else if (/Intel.*HD|Mali|Adreno|PowerVR|Apple GPU|Intel.*[4-6][0-9]{2}/i.test(gpuRenderer)) {
      estimatedTier = 'low';
    }
  }
  
  // Memory check
  const deviceMemory = (navigator as any).deviceMemory || null;
  if (deviceMemory && deviceMemory < 4) {
    estimatedTier = 'low';
  }
  
  return {
    cpuCores: navigator.hardwareConcurrency || 0,
    deviceMemoryGB: deviceMemory,
    platform: navigator.platform,
    userAgent: ua,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
    colorDepth: window.screen.colorDepth,
    gpuVendor,
    gpuRenderer,
    webglVersion,
    maxTextureSize,
    maxViewportSize,
    hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    isMobile,
    isTablet,
    estimatedTier,
    recommendedLevel: estimatedTier,
  };
}

/**
 * Print a formatted report of device capabilities to console
 */
export function printDeviceReport(): void {
  const caps = getDeviceCapabilities();
  
  console.group('🖥️ Device Capabilities Report');
  
  console.group('Hardware');
  console.log(`CPU Cores: ${caps.cpuCores || 'Unknown'}`);
  console.log(`Memory: ${caps.deviceMemoryGB ? caps.deviceMemoryGB + ' GB' : 'Unknown (browser restricted)'}`);
  console.log(`Platform: ${caps.platform}`);
  console.groupEnd();
  
  console.group('Display');
  console.log(`Screen: ${caps.screenWidth} × ${caps.screenHeight}`);
  console.log(`Pixel Ratio: ${caps.devicePixelRatio}x`);
  console.log(`Color Depth: ${caps.colorDepth}-bit`);
  console.groupEnd();
  
  console.group('GPU / WebGL');
  console.log(`Vendor: ${caps.gpuVendor || 'Unknown'}`);
  console.log(`Renderer: ${caps.gpuRenderer || 'Unknown'}`);
  console.log(`WebGL: ${caps.webglVersion}`);
  console.log(`Max Texture: ${caps.maxTextureSize}px`);
  console.log(`Max Viewport: ${caps.maxViewportSize[0]} × ${caps.maxViewportSize[1]}`);
  console.groupEnd();
  
  console.group('Device Type');
  console.log(`Touch: ${caps.hasTouch ? 'Yes' : 'No'}`);
  console.log(`Mobile: ${caps.isMobile ? 'Yes' : 'No'}`);
  console.log(`Tablet: ${caps.isTablet ? 'Yes' : 'No'}`);
  console.groupEnd();
  
  console.group('Performance Recommendation');
  console.log(`Estimated Tier: ${caps.estimatedTier.toUpperCase()}`);
  console.log(`Current Level: ${currentLevel.toUpperCase()}`);
  if (caps.recommendedLevel !== currentLevel) {
    console.log(`💡 Suggested: Switch to "${caps.recommendedLevel}" for optimal performance`);
  } else {
    console.log(`✅ Current settings match device capabilities`);
  }
  console.groupEnd();
  
  console.groupEnd();
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).__performanceSettings = {
    getSettings: getPerformanceSettings,
    getLevel: getPerformanceLevel,
    setLevel: setPerformanceLevel,
    detect: detectDeviceCapability,
    getCapabilities: getDeviceCapabilities,
    printReport: printDeviceReport,
    presets: PERFORMANCE_PRESETS,
  };
  
  logger.debug('Debug commands available at window.__performanceSettings');
  logger.debug('Run window.__performanceSettings.printReport() to see device capabilities');}