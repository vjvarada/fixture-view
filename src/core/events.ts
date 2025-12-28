/**
 * Centralized Event Constants
 * 
 * All custom events used in the application are defined here.
 * This provides type safety, IDE autocomplete, and prevents typos.
 * 
 * @module core/events
 */

// ============================================================================
// Event Names
// ============================================================================

export const EVENTS = {
  // 
  // Transform Events
  // 
  MODEL_TRANSFORM_UPDATED: 'model-transform-updated',
  SET_MODEL_TRANSFORM: 'set-model-transform',
  REQUEST_MODEL_TRANSFORM: 'request-model-transform',
  CHECK_BASEPLATE_COLLISION: 'check-baseplate-collision',
  CHECK_BASEPLATE_COLLISION_DELAYED: 'check-baseplate-collision-delayed',
  BASEPLATE_MOVED_MODEL: 'baseplate-moved-model',
  SET_PART_TO_BASEPLATE: 'set-part-to-baseplate',
  
  // 
  // Control Events
  // 
  DISABLE_ORBIT_CONTROLS: 'disable-orbit-controls',
  PIVOT_CONTROL_ACTIVATED: 'pivot-control-activated',
  MESH_DOUBLE_CLICK: 'mesh-double-click',
  
  // 
  // Session/Viewer Events
  // 
  SESSION_RESET: 'session-reset',
  VIEWER_RESET: 'viewer-reset',
  VIEWER_RESIZE: 'viewer-resize',
  VIEWER_UNDO: 'viewer-undo',
  VIEWER_REDO: 'viewer-redo',
  VIEWER_STATE_CHANGED: 'viewer-state-changed',
  VIEWER_CAMERA_CHANGED: 'viewer-camera-changed',
  VIEWER_CAMERA_SET_QUATERNION: 'viewer-camera-set-quaternion',
  VIEWER_ORIENTATION: 'viewer-orientation',
  
  // 
  // Part Events
  // 
  PART_IMPORTED: 'part-imported',
  PART_SELECTED: 'part-selected',
  PART_REMOVED: 'part-removed',
  PART_VISIBILITY_CHANGED: 'part-visibility-changed',
  
  // 
  // Baseplate Events
  // 
  CREATE_BASEPLATE: 'create-baseplate',
  UPDATE_BASEPLATE: 'update-baseplate',
  REMOVE_BASEPLATE: 'remove-baseplate',
  BASEPLATE_SELECTED: 'baseplate-selected',
  BASEPLATE_CONFIG_UPDATED: 'baseplate-config-updated',
  BASEPLATE_VISIBILITY_CHANGED: 'baseplate-visibility-changed',
  BASEPLATE_DRAWING_MODE_CHANGED: 'baseplate-drawing-mode-changed',
  BASEPLATE_SECTION_DRAWN: 'baseplate-section-drawn',
  BASEPLATE_SECTION_SELECT: 'baseplate-section-select',
  BASEPLATE_SECTION_SELECTED: 'baseplate-section-selected',
  BASEPLATE_SECTION_UPDATED: 'baseplate-section-updated',
  BASEPLATE_SECTION_REMOVED: 'baseplate-section-removed',
  
  // 
  // Support Events
  // 
  SUPPORT_CREATED: 'support-created',
  SUPPORT_UPDATED: 'support-updated',
  SUPPORT_DELETE: 'support-delete',
  SUPPORT_FOCUS: 'support-focus',
  SUPPORT_SNAP_ENABLED_CHANGED: 'support-snap-enabled-changed',
  SUPPORTS_START_PLACEMENT: 'supports-start-placement',
  SUPPORTS_AUTO_PLACE: 'supports-auto-place',
  SUPPORTS_AUTO_PLACED: 'supports-auto-placed',
  SUPPORTS_CLEAR_ALL: 'supports-clear-all',
  
  // 
  // Clamp Events
  // 
  CLAMP_START_PLACEMENT: 'clamp-start-placement',
  CLAMP_CANCEL_PLACEMENT: 'clamp-cancel-placement',
  CLAMP_PLACED: 'clamp-placed',
  CLAMP_SELECTED: 'clamp-selected',
  CLAMP_SELECT: 'clamp-select',
  CLAMP_UPDATE: 'clamp-update',
  CLAMP_DELETE: 'clamp-delete',
  CLAMP_DATA_LOADED: 'clamp-data-loaded',
  CLAMP_PROCESSING_START: 'clamp-processing-start',
  CLAMP_PROGRESS: 'clamp-progress',
  
  // 
  // Hole Events
  // 
  HOLE_START_PLACEMENT: 'hole-start-placement',
  HOLE_CANCEL_PLACEMENT: 'hole-cancel-placement',
  HOLE_PLACEMENT_CANCELLED: 'hole-placement-cancelled',
  HOLE_PLACED: 'hole-placed',
  HOLE_SELECTED: 'hole-selected',
  HOLE_SELECT_REQUEST: 'hole-select-request',
  HOLE_EDIT_REQUEST: 'hole-edit-request',
  HOLE_UPDATED: 'hole-updated',
  HOLES_UPDATED: 'holes-updated',
  HOLE_SNAP_ENABLED_CHANGED: 'hole-snap-enabled-changed',
  
  // 
  // Label Events
  // 
  LABEL_ADD: 'label-add',
  LABEL_ADDED: 'label-added',
  LABEL_PLACED: 'label-placed',
  LABEL_SELECTED: 'label-selected',
  LABEL_UPDATE: 'label-update',
  LABEL_DELETE: 'label-delete',
  LABEL_FOCUS: 'label-focus',
  
  // 
  // Cavity/CSG Events
  // 
  CAVITY_CONTEXT: 'cavity-context',
  EXECUTE_CAVITY_SUBTRACTION: 'execute-cavity-subtraction',
  CAVITY_SUBTRACTION_PROGRESS: 'cavity-subtraction-progress',
  CAVITY_SUBTRACTION_COMPLETE: 'cavity-subtraction-complete',
  RESET_CAVITY: 'reset-cavity',
  GENERATE_OFFSET_MESH_PREVIEW: 'generate-offset-mesh-preview',
  CLEAR_OFFSET_MESH_PREVIEW: 'clear-offset-mesh-preview',
  TOGGLE_OFFSET_PREVIEW: 'toggle-offset-preview',
  OFFSET_MESH_PREVIEW_PROGRESS: 'offset-mesh-preview-progress',
  OFFSET_MESH_PREVIEW_COMPLETE: 'offset-mesh-preview-complete',
  
  // 
  // Dialog Events
  // 
  OPEN_CLAMPS_DIALOG: 'open-clamps-dialog',
  OPEN_LABELS_DIALOG: 'open-labels-dialog',
  OPEN_DRILL_DIALOG: 'open-drill-dialog',
  OPEN_EXPORT_DIALOG: 'open-export-dialog',
} as const;

// Type for event names
export type EventName = typeof EVENTS[keyof typeof EVENTS];

// ============================================================================
// Type-Safe Event Helpers
// ============================================================================

/**
 * Dispatches a typed custom event.
 * @param eventName - The event name from EVENTS constant
 * @param detail - Optional payload data
 */
export function dispatchAppEvent<T = undefined>(
  eventName: EventName,
  detail?: T
): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

/**
 * Adds a typed event listener and returns cleanup function.
 * @param eventName - The event name from EVENTS constant  
 * @param handler - Handler function receiving the event detail
 * @returns Cleanup function to remove the listener
 */
export function addAppEventListener<T = undefined>(
  eventName: EventName,
  handler: (detail: T) => void
): () => void {
  const wrappedHandler = (e: Event) => {
    handler((e as CustomEvent<T>).detail);
  };
  window.addEventListener(eventName, wrappedHandler);
  return () => window.removeEventListener(eventName, wrappedHandler);
}
