/**
 * MultiSectionBasePlate
 *
 * Renders multi-section baseplates as separate extruded rectangles.
 * Supports hole CSG operations, section selection, and double-click editing.
 */

import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import type { BasePlateSection, BasePlateMaterial } from '../types';
import type { PlacedHole } from '@/features/holes';
import { createMergedHolesGeometry } from '@/features/holes';
import { performHoleCSGInWorker } from '@rapidtool/cad-core';

// =============================================================================
// Types
// =============================================================================

interface MultiSectionBasePlateProps {
  sections: BasePlateSection[];
  depth: number;
  material?: BasePlateMaterial;
  selected?: boolean;
  onSelect?: () => void;
  selectedSectionId?: string | null;
  onSectionClick?: (sectionId: string) => void;
  onSectionDoubleClick?: (sectionId: string) => void;
  holes?: PlacedHole[];
  groupRef?: React.RefObject<THREE.Group>;
  isDraggingHole?: boolean;
  isDraggingAnyItem?: boolean; // Skip CSG when any item (support/label/clamp/hole) is being dragged
  holeCSGTrigger?: number;
}

interface SectionMeshData {
  id: string;
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
}

interface SectionDimensions {
  width: number;
  height: number;
  centerX: number;
  centerZ: number;
}

// =============================================================================
// Constants
// =============================================================================

const DOUBLE_CLICK_THRESHOLD_MS = 300;
const DEFAULT_SECTION_SIZE = 100;
const CORNER_RADIUS_FACTOR = 0.08;
const CHAMFER_SIZE_FACTOR = 0.15;

const MATERIAL_CONFIGS: Record<BasePlateMaterial, { color: number; roughness: number; metalness: number }> = {
  wood: { color: 0x8B4513, roughness: 0.8, metalness: 0.1 },
  plastic: { color: 0x333333, roughness: 0.3, metalness: 0.0 },
  metal: { color: 0x888888, roughness: 0.7, metalness: 0.0 },
};

const SELECTION_COLORS = {
  selected: 0x00ff88,
  hover: 0x4488ff,
  selectedEmissive: 0x004422,
} as const;

// =============================================================================
// Geometry Utilities
// =============================================================================

/** Validates section bounds for finite values and positive dimensions. */
function isValidSection(section: BasePlateSection): boolean {
  return (
    Number.isFinite(section.minX) &&
    Number.isFinite(section.maxX) &&
    Number.isFinite(section.minZ) &&
    Number.isFinite(section.maxZ) &&
    section.maxX > section.minX &&
    section.maxZ > section.minZ
  );
}

/** Calculates rectangle dimensions from section bounds. */
function getSectionDimensions(section: BasePlateSection): SectionDimensions {
  const width = section.maxX - section.minX;
  const height = section.maxZ - section.minZ;
  const centerX = (section.minX + section.maxX) / 2;
  const centerZ = (section.minZ + section.maxZ) / 2;

  const isValid =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    Number.isFinite(centerX) &&
    Number.isFinite(centerZ) &&
    width > 0 &&
    height > 0;

  if (!isValid) {
    return {
      width: DEFAULT_SECTION_SIZE,
      height: DEFAULT_SECTION_SIZE,
      centerX: 0,
      centerZ: 0,
    };
  }

  return { width, height, centerX, centerZ };
}

/** Creates a rounded rectangle shape for extrusion. */
function createRoundedRectShape(width: number, height: number): THREE.Shape {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(width, height) * CORNER_RADIUS_FACTOR;
  const r = Math.min(radius, halfWidth, halfHeight);

  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + r, -halfHeight);
  shape.lineTo(halfWidth - r, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r);
  shape.lineTo(halfWidth, halfHeight - r);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight);
  shape.lineTo(-halfWidth + r, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r);
  shape.lineTo(-halfWidth, -halfHeight + r);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight);

  return shape;
}

/** Creates an extruded geometry with chamfered edges. */
function createExtrudedSection(width: number, height: number, depth: number): THREE.BufferGeometry {
  const shape = createRoundedRectShape(width, height);
  const chamferSize = Math.min(1.0, depth * CHAMFER_SIZE_FACTOR);
  const extrudeDepth = Math.max(0.1, depth - 2 * chamferSize);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: true,
    bevelThickness: chamferSize,
    bevelSize: chamferSize,
    bevelSegments: 1,
  });

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, chamferSize, 0);
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();

  return geometry;
}

// =============================================================================
// Custom Hooks
// =============================================================================

/** Handles double-click detection on sections. */
function useSectionClickHandler(
  onSectionClick?: (sectionId: string) => void,
  onSectionDoubleClick?: (sectionId: string) => void
) {
  const lastClickTimesRef = useRef<Map<string, number>>(new Map());

  return useCallback(
    (event: ThreeEvent<MouseEvent>, sectionId: string) => {
      event.stopPropagation();

      const now = Date.now();
      const lastClickTime = lastClickTimesRef.current.get(sectionId) || 0;
      const isDoubleClick = now - lastClickTime < DOUBLE_CLICK_THRESHOLD_MS;

      if (isDoubleClick) {
        onSectionDoubleClick?.(sectionId);
        lastClickTimesRef.current.set(sectionId, 0);
        return;
      }

      lastClickTimesRef.current.set(sectionId, now);

      if (onSectionClick) {
        onSectionClick(sectionId);
        window.dispatchEvent(
          new CustomEvent('baseplate-section-selected', { detail: { sectionId } })
        );
      }
    },
    [onSectionClick, onSectionDoubleClick]
  );
}

/** Applies CSG hole operations to section geometries. */
function useSectionHoleCSG(
  baseSectionMeshes: SectionMeshData[],
  holes: PlacedHole[],
  depth: number,
  isDraggingHole: boolean,
  holeCSGTrigger: number,
  isDraggingAnyItem: boolean
): Map<string, THREE.BufferGeometry> {
  const [geometriesWithHoles, setGeometriesWithHoles] = useState<Map<string, THREE.BufferGeometry>>(new Map());
  
  // Use ref for holes to avoid triggering CSG on array reference changes
  const holesRef = useRef(holes);
  holesRef.current = holes;
  
  // Track previous trigger value to detect actual changes
  const prevTriggerRef = useRef(holeCSGTrigger);

  // Clear CSG result when any drag starts (show original geometry without holes)
  useEffect(() => {
    if (isDraggingHole || isDraggingAnyItem) {
      setGeometriesWithHoles(new Map());
    }
  }, [isDraggingHole, isDraggingAnyItem]);

  // Run CSG ONLY when explicitly triggered via holeCSGTrigger
  useEffect(() => {
    const triggerChanged = holeCSGTrigger !== prevTriggerRef.current;
    
    // Skip if dragging a hole or any item
    if (isDraggingHole || isDraggingAnyItem) return;
    
    // Skip if trigger hasn't changed
    if (!triggerChanged) return;
    
    // Update ref for next comparison
    prevTriggerRef.current = holeCSGTrigger;
    
    // Skip if trigger is 0 (initial state)
    if (holeCSGTrigger === 0) return;

    const currentHoles = holesRef.current;
    if (currentHoles.length === 0) {
      setGeometriesWithHoles(new Map());
      return;
    }

    const applyCSG = async () => {
      const newGeometries = new Map<string, THREE.BufferGeometry>();

      for (const meshData of baseSectionMeshes) {
        const sectionHoles = currentHoles.filter((h) => h.sectionId === meshData.id);

        if (sectionHoles.length === 0) {
          newGeometries.set(meshData.id, meshData.geometry);
          continue;
        }

        try {
          // Transform hole world positions to section-local positions
          const holesGeo = createMergedHolesGeometry(
            sectionHoles.map((h) => ({ ...h, depth: h.depth || depth })),
            depth,
            { x: meshData.position.x, z: meshData.position.z }
          );

          if (!holesGeo) {
            newGeometries.set(meshData.id, meshData.geometry);
            continue;
          }

          const resultGeo = await performHoleCSGInWorker(meshData.geometry.clone(), holesGeo);
          newGeometries.set(meshData.id, resultGeo || meshData.geometry);
          holesGeo.dispose();
        } catch {
          newGeometries.set(meshData.id, meshData.geometry);
        }
      }

      // Verify we're still not dragging before applying result
      if (!isDraggingHole && !isDraggingAnyItem) {
        setGeometriesWithHoles(newGeometries);
      }
    };

    applyCSG();
  }, [baseSectionMeshes, depth, holeCSGTrigger, isDraggingHole, isDraggingAnyItem]);

  return geometriesWithHoles;
}

// =============================================================================
// Sub-Components
// =============================================================================

interface SectionMeshProps {
  meshData: SectionMeshData;
  isSelected: boolean;
  isParentSelected: boolean;
  materialConfig: { color: number; roughness: number; metalness: number };
  onClick: (event: ThreeEvent<MouseEvent>, sectionId: string) => void;
}

const SectionMesh = React.memo<SectionMeshProps>(function SectionMesh({
  meshData,
  isSelected,
  isParentSelected,
  materialConfig,
  onClick,
}) {
  const color = isSelected
    ? SELECTION_COLORS.selected
    : isParentSelected
    ? SELECTION_COLORS.hover
    : materialConfig.color;

  return (
    <mesh
      geometry={meshData.geometry}
      position={meshData.position}
      receiveShadow
      castShadow
      onClick={(e) => onClick(e, meshData.id)}
      userData={{ isBaseplateSection: true, sectionId: meshData.id }}
    >
      <meshStandardMaterial
        color={color}
        roughness={materialConfig.roughness}
        metalness={materialConfig.metalness}
        emissive={isSelected ? SELECTION_COLORS.selectedEmissive : 0x000000}
        emissiveIntensity={isSelected ? 0.3 : 0}
      />
    </mesh>
  );
});

// =============================================================================
// Main Component
// =============================================================================

const MultiSectionBasePlate: React.FC<MultiSectionBasePlateProps> = ({
  sections,
  depth,
  material = 'metal',
  selected = false,
  selectedSectionId = null,
  onSectionClick,
  onSectionDoubleClick,
  holes = [],
  groupRef,
  isDraggingHole = false,
  holeCSGTrigger = 0,
  isDraggingAnyItem = false,
}) => {
  const handleSectionClick = useSectionClickHandler(onSectionClick, onSectionDoubleClick);
  const materialConfig = useMemo(() => MATERIAL_CONFIGS[material] || MATERIAL_CONFIGS.metal, [material]);

  const validSections = useMemo(() => sections.filter(isValidSection), [sections]);

  const baseSectionMeshes = useMemo<SectionMeshData[]>(
    () =>
      validSections.map((section) => {
        const { width, height, centerX, centerZ } = getSectionDimensions(section);
        return {
          id: section.id,
          geometry: createExtrudedSection(width, height, depth),
          position: new THREE.Vector3(centerX, 0, centerZ),
        };
      }),
    [validSections, depth]
  );

  const geometriesWithHoles = useSectionHoleCSG(
    baseSectionMeshes,
    holes,
    depth,
    isDraggingHole,
    holeCSGTrigger,
    isDraggingAnyItem
  );

  const finalMeshes = useMemo<SectionMeshData[]>(
    () =>
      baseSectionMeshes.map((meshData) => ({
        ...meshData,
        geometry: geometriesWithHoles.get(meshData.id) || meshData.geometry,
      })),
    [baseSectionMeshes, geometriesWithHoles]
  );

  if (validSections.length === 0) {
    return null;
  }

  return (
    <group ref={groupRef}>
      {finalMeshes.map((meshData) => (
        <SectionMesh
          key={meshData.id}
          meshData={meshData}
          isSelected={selectedSectionId === meshData.id}
          isParentSelected={selected}
          materialConfig={materialConfig}
          onClick={handleSectionClick}
        />
      ))}
    </group>
  );
};

export default MultiSectionBasePlate;
