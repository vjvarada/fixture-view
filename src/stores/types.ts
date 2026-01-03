/**
 * Fixture Store Types
 * 
 * App-specific types for the fixture design workflow.
 */

import type * as THREE from 'three';

/** Processed file from import */
export interface ProcessedFile {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  originalFile?: File;
  units?: string;
  bounds?: {
    min: THREE.Vector3;
    max: THREE.Vector3;
    size: THREE.Vector3;
    center: THREE.Vector3;
  };
}

/** Support types */
export type SupportType = 'cylindrical' | 'rectangular' | 'adjustable' | 'vblock';

/** Base support interface */
export interface BaseSupport {
  id: string;
  type: SupportType;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

/** Cylindrical support */
export interface CylindricalSupport extends BaseSupport {
  type: 'cylindrical';
  diameter: number;
  height: number;
}

/** Rectangular support */
export interface RectangularSupport extends BaseSupport {
  type: 'rectangular';
  width: number;
  depth: number;
  height: number;
}

/** Adjustable support */
export interface AdjustableSupport extends BaseSupport {
  type: 'adjustable';
  minHeight: number;
  maxHeight: number;
  currentHeight: number;
  diameter: number;
}

/** V-Block support */
export interface VBlockSupport extends BaseSupport {
  type: 'vblock';
  width: number;
  height: number;
  angle: number;
}

/** Any support type */
export type AnySupport = CylindricalSupport | RectangularSupport | AdjustableSupport | VBlockSupport;

/** Placed clamp */
export interface PlacedClamp {
  id: string;
  clampType: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  fixturePointPosition?: { x: number; y: number; z: number };
}

/** Label configuration */
export interface LabelConfig {
  id: string;
  text: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  fontSize: number;
  color: string;
  fontFamily: string;
  depth: number;
}

/** Hole configuration */
export interface HoleConfig {
  type: 'through' | 'threaded' | 'counterbore' | 'countersink';
  diameter: number;
  depth?: number;
  threadPitch?: number;
  countersinkAngle?: number;
  counterboreDepth?: number;
  counterboreDiameter?: number;
}

/** Placed hole */
export interface PlacedHole {
  id: string;
  config: HoleConfig;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

/** Baseplate section */
export interface BaseplateSection {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Baseplate configuration */
export interface BaseplateConfig {
  id: string;
  type: 'rectangular' | 'convex-hull' | 'perforated-panel' | 'metal-wooden-plate' | 'multi-section';
  padding?: number;
  height?: number;
  depth?: number;
  sections?: BaseplateSection[];
}

// CavitySettings imported from @rapidtool/cad-core
export type { CavitySettings } from '@rapidtool/cad-core';

/** Workflow steps for fixture design */
export type FixtureWorkflowStep = 
  | 'import'
  | 'baseplate'
  | 'supports'
  | 'clamps'
  | 'labels'
  | 'holes'
  | 'cavity'
  | 'export';

/** Category to step mapping */
export const FIXTURE_CATEGORY_TO_STEP: Record<string, FixtureWorkflowStep> = {
  part: 'import',
  baseplate: 'baseplate',
  support: 'supports',
  clamp: 'clamps',
  label: 'labels',
  hole: 'holes',
  cavity: 'cavity',
};

/** Step to accordion mapping */
export const FIXTURE_STEP_TO_ACCORDION: Record<FixtureWorkflowStep, { accordion: string; subAccordion?: string }> = {
  import: { accordion: 'parts' },
  baseplate: { accordion: 'parts', subAccordion: 'baseplate' },
  supports: { accordion: 'supports' },
  clamps: { accordion: 'clamps' },
  labels: { accordion: 'labels' },
  holes: { accordion: 'holes' },
  cavity: { accordion: 'cavity' },
  export: { accordion: 'export' },
};

/** All fixture workflow steps in order */
export const FIXTURE_WORKFLOW_STEPS: FixtureWorkflowStep[] = [
  'import',
  'baseplate',
  'supports',
  'clamps',
  'labels',
  'holes',
  'cavity',
  'export',
];
