/**
 * Model color utilities for 3DScene
 */

// =============================================================================
// Color Palette
// =============================================================================

export const MODEL_COLOR_PALETTE = [
  '#4ade80', // Green
  '#f97316', // Orange
  '#06b6d4', // Cyan
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#eab308', // Yellow
  '#ef4444', // Red
  '#22c55e', // Emerald
  '#3b82f6', // Blue
  '#f59e0b'  // Amber
];

// =============================================================================
// Color Assignment
// =============================================================================

/**
 * Get or assign a color for a model from the palette.
 */
export function getModelColor(modelId: string, colorsMap: Map<string, string>): string {
  if (colorsMap.has(modelId)) {
    return colorsMap.get(modelId)!;
  }

  // Assign a new color from palette if not already assigned
  const availableColors = MODEL_COLOR_PALETTE.filter(color =>
    !Array.from(colorsMap.values()).includes(color)
  );

  if (availableColors.length === 0) {
    // If all colors used, cycle back to first color
    const assignedColors = Array.from(colorsMap.values());
    const firstUnusedColor = MODEL_COLOR_PALETTE.find(color => !assignedColors.includes(color)) || MODEL_COLOR_PALETTE[0];
    return firstUnusedColor;
  }

  const newColor = availableColors[0];
  return newColor;
}

/**
 * Get the next available color from the palette.
 */
export function getNextAvailableColor(colorsMap: Map<string, string>): string {
  const usedColors = new Set(colorsMap.values());
  const availableColor = MODEL_COLOR_PALETTE.find(color => !usedColors.has(color));
  return availableColor || MODEL_COLOR_PALETTE[0];
}

/**
 * Parse a hex color string to RGB values (0-1 range).
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '');
  return {
    r: parseInt(cleanHex.substr(0, 2), 16) / 255,
    g: parseInt(cleanHex.substr(2, 2), 16) / 255,
    b: parseInt(cleanHex.substr(4, 2), 16) / 255,
  };
}
