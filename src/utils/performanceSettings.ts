/**
 * Performance Settings for Low-Power Devices (Tablets, etc.)
 * 
 * Provides configurable quality levels to optimize rendering
 * performance on less powerful hardware.
 */

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
  
  console.log(`[Performance] Device detection score: ${score}`, {
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
  
  console.log(`[Performance] Initialized with level: ${currentLevel}`, currentSettings);
  
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
    console.warn('[Performance] Failed to save settings:', e);
  }
  
  console.log(`[Performance] Changed to level: ${level}`, currentSettings);
  
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

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).__performanceSettings = {
    getSettings: getPerformanceSettings,
    getLevel: getPerformanceLevel,
    setLevel: setPerformanceLevel,
    detect: detectDeviceCapability,
    presets: PERFORMANCE_PRESETS,
  };
  
  console.log('[Performance] Debug commands available at window.__performanceSettings');
}
