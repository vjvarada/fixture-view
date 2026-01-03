import * as THREE from 'three';

export type SupportType = 'rectangular' | 'cylindrical' | 'conical' | 'custom';

export interface SupportBase {
  id: string;
  type: SupportType;
  center: THREE.Vector2; // on plate, units mm
  height: number; // mm
  baseY?: number; // local baseplate contact height in world units
  rotationY?: number; // radians, rotation around vertical Y-axis
  rotationZ?: number; // deprecated, use rotationY - kept for backwards compatibility
  contactOffset?: number; // mm gap reserved from model contact
  sectionId?: string; // ID of the baseplate section this support belongs to (for multi-section baseplates)
}

export interface RectSupport extends SupportBase {
  type: 'rectangular';
  width: number;
  depth: number;
  cornerRadius?: number;
}

export interface CylSupport extends SupportBase {
  type: 'cylindrical';
  radius: number;
}

export interface ConicalSupport extends SupportBase {
  type: 'conical';
  baseRadius: number;
  topRadius: number; // 0 for cone
}

export interface CustomSupport extends SupportBase {
  type: 'custom';
  polygon: Array<[number, number]>; // centered at center
  offset?: number;
  cornerRadius?: number; // radius for rounding polygon corners
}

export type AnySupport = RectSupport | CylSupport | ConicalSupport | CustomSupport;

