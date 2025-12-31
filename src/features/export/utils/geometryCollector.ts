/**
 * Geometry Collector Utilities
 * 
 * Functions for collecting and preparing geometries for export.
 */

import * as THREE from 'three';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';
import type { LabelConfig } from '@/features/labels';
import { buildClampSupportGeometryAtOrigin, buildLabelGeometry } from '@/components/3DScene/utils/csgUtils';
import { performClampCSGInWorker } from '@rapidtool/cad-core';
import type { 
  GeometryCollectionContext, 
  ExportGeometryCollection,
  ExportProgressCallback,
  ClampExportData 
} from '../types';

// Constants matching MultiSectionBasePlate.tsx
const CORNER_RADIUS_FACTOR = 0.08;
const CHAMFER_SIZE_FACTOR = 0.15;

/**
 * Creates a rounded rectangle shape for extrusion (matches MultiSectionBasePlate)
 */
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

/**
 * Creates an extruded section geometry (matches MultiSectionBasePlate)
 */
function createExtrudedSectionGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
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

/**
 * Creates multi-section baseplate geometries from config when refs aren't available.
 * This is a fallback for when the MultiSectionBasePlate component is unmounted (e.g., merged fixture shown).
 */
export function createMultiSectionGeometriesFromConfig(
  config: BasePlateConfig
): { geometries: THREE.BufferGeometry[]; sectionData: SectionGeometryData[] } {
  const geometries: THREE.BufferGeometry[] = [];
  const sectionData: SectionGeometryData[] = [];
  
  if (config.type !== 'multi-section' || !config.sections) {
    console.warn('[Export] createMultiSectionGeometriesFromConfig called for non-multi-section baseplate');
    return { geometries, sectionData };
  }
  
  const depth = config.depth ?? 4;
  
  config.sections.forEach((section, index) => {
    // Validate section
    if (!Number.isFinite(section.minX) || !Number.isFinite(section.maxX) ||
        !Number.isFinite(section.minZ) || !Number.isFinite(section.maxZ) ||
        section.maxX <= section.minX || section.maxZ <= section.minZ) {
      console.warn(`[Export] Skipping invalid section ${section.id}:`, section);
      return;
    }
    
    const width = section.maxX - section.minX;
    const height = section.maxZ - section.minZ;
    const centerX = (section.minX + section.maxX) / 2;
    const centerZ = (section.minZ + section.maxZ) / 2;
    
    // Create the section geometry
    const geometry = createExtrudedSectionGeometry(width, height, depth);
    
    // Apply world position (translate to section center)
    geometry.translate(centerX, 0, centerZ);
    
    geometries.push(geometry);
    sectionData.push({
      id: section.id,
      index,
      geometry,
      bounds: {
        minX: section.minX,
        maxX: section.maxX,
        minZ: section.minZ,
        maxZ: section.maxZ,
      },
    });
    
    console.log(`[Export] Created section ${section.id} from config: ${width.toFixed(1)}x${height.toFixed(1)} at (${centerX.toFixed(1)}, ${centerZ.toFixed(1)})`);
  });
  
  return { geometries, sectionData };
}

/**
 * Creates baseplate geometry from config when refs are not available.
 * Note: This only works for single baseplates, not multi-section.
 * 
 * IMPORTANT: This creates geometry in LOCAL SPACE (centered at origin).
 * The caller must apply basePlate.position to transform to world space.
 */
export function createBaseplateGeometryFromConfig(
  config: BasePlateConfig
): THREE.BufferGeometry | null {
  // Multi-section baseplates should use multiSectionBasePlateGroupRef instead
  if (config.type === 'multi-section') {
    console.warn('[Export] createBaseplateGeometryFromConfig called for multi-section baseplate - this should use multiSectionBasePlateGroupRef');
    return null;
  }
  
  try {
    const width = config.width ?? 200;
    const depth = config.depth ?? 10;
    const height = config.height ?? 200;
    
    // Create a rounded rectangle shape similar to BasePlate component
    // Note: Geometry is created centered at origin (local space)
    // Position will be applied by caller using basePlate.position
    const cornerRadiusFactor = 0.08;
    const cornerRadius = Math.min(width, height) * cornerRadiusFactor;
    const shape = new THREE.Shape();
    const hw = width / 2;
    const hh = height / 2;
    const r = Math.min(cornerRadius, hw, hh);
    
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    
    // For a 45-degree chamfer
    const chamferSizeFactor = 0.15;
    const chamferSize = Math.min(1.0, depth * chamferSizeFactor);
    const extrudeDepth = Math.max(0.1, depth - 2 * chamferSize);
    
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: extrudeDepth,
      bevelEnabled: true,
      bevelThickness: chamferSize,
      bevelSize: chamferSize,
      bevelSegments: 1,
    });
    
    // Rotate to Y-up and translate so bottom sits at Y=0
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, chamferSize, 0);
    
    // NOTE: Do NOT apply position here - caller will apply basePlate.position
    // This keeps the function consistent with other geometry sources
    
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();
    
    console.log('[Export] Created baseplate geometry from config (local space):', { width, height, depth });
    return geometry;
  } catch (err) {
    console.error('[Export] Failed to create baseplate geometry from config:', err);
    return null;
  }
}

/**
 * Per-section geometry data with bounds
 */
interface SectionGeometryData {
  id: string;
  index: number;
  geometry: THREE.BufferGeometry;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Collects baseplate geometry from various sources
 */
export function collectBaseplateGeometry(
  ctx: GeometryCollectionContext
): { 
  geometry: THREE.BufferGeometry | null; 
  isMultiSection: boolean; 
  multiSectionGeometries: THREE.BufferGeometry[];
  sectionData: SectionGeometryData[];
} {
  const isMultiSection = ctx.basePlate?.type === 'multi-section';
  const multiSectionGeometries: THREE.BufferGeometry[] = [];
  const sectionData: SectionGeometryData[] = [];
  let geometry: THREE.BufferGeometry | null = null;
  
  // Multi-section baseplates: always use the group reference (ignore baseplateWithHoles)
  if (isMultiSection) {
    if (ctx.multiSectionBasePlateGroupRef.current && ctx.basePlate?.sections) {
      console.log('[Export] Collecting multi-section baseplate geometries');
      const sections = ctx.basePlate.sections;
      let sectionIndex = 0;
      
      ctx.multiSectionBasePlateGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const section = sections[sectionIndex];
          if (section) {
            // Clone geometry and apply world transform
            const clonedGeom = child.geometry.clone();
            child.updateMatrixWorld(true);
            clonedGeom.applyMatrix4(child.matrixWorld);
            
            multiSectionGeometries.push(clonedGeom);
            sectionData.push({
              id: section.id,
              index: sectionIndex,
              geometry: clonedGeom,
              bounds: {
                minX: section.minX,
                maxX: section.maxX,
                minZ: section.minZ,
                maxZ: section.maxZ,
              },
            });
            console.log(`[Export] Collected section ${section.id} (${sectionIndex}): bounds [${section.minX.toFixed(1)}, ${section.maxX.toFixed(1)}] x [${section.minZ.toFixed(1)}, ${section.maxZ.toFixed(1)}]`);
          }
          sectionIndex++;
        }
      });
      
      if (multiSectionGeometries.length === 0) {
        console.warn('[Export] Multi-section baseplate group has no mesh children!');
      }
    } else if (ctx.basePlate?.sections) {
      // Multi-section but ref not available (component unmounted, e.g., merged fixture shown)
      // Fall back to creating geometries from config
      console.log('[Export] Multi-section baseplate ref not available, creating from config');
      const fallback = createMultiSectionGeometriesFromConfig(ctx.basePlate);
      multiSectionGeometries.push(...fallback.geometries);
      sectionData.push(...fallback.sectionData);
    } else {
      // Multi-section but no sections defined - this is an error condition
      console.error('[Export] Multi-section baseplate but no sections defined!');
    }
    // Don't fall through to other branches for multi-section - return what we have
    return { geometry: null, isMultiSection, multiSectionGeometries, sectionData };
  }
  
  // Single baseplate handling
  // IMPORTANT: Baseplate geometry needs to be transformed to world space because:
  // 1. Labels and clamp supports are positioned in world coordinates
  // 2. The BasePlate component may have internal geometry offsets (geometryOffsetX/Z)
  //    for asymmetric expansion when hull points extend beyond configured bounds
  // 3. The mesh's matrixWorld includes the mesh position (basePlate.position)
  if (ctx.baseplateWithHoles) {
    // Single baseplate with holes cut (CSG result)
    // This geometry is in local space, need to transform to world space
    console.log('[Export] Using baseplateWithHoles geometry');
    geometry = ctx.baseplateWithHoles.clone();
    
    // Debug: Log geometry bounds before transform
    geometry.computeBoundingBox();
    const beforeBox = geometry.boundingBox!;
    const beforeCenter = new THREE.Vector3();
    beforeBox.getCenter(beforeCenter);
    console.log('[Export] Baseplate geometry BEFORE transform:', {
      center: { x: beforeCenter.x.toFixed(2), y: beforeCenter.y.toFixed(2), z: beforeCenter.z.toFixed(2) },
      min: { x: beforeBox.min.x.toFixed(2), y: beforeBox.min.y.toFixed(2), z: beforeBox.min.z.toFixed(2) },
      max: { x: beforeBox.max.x.toFixed(2), y: beforeBox.max.y.toFixed(2), z: beforeBox.max.z.toFixed(2) }
    });
    
    // Apply mesh position transform to convert from local to world space
    if (ctx.basePlateMeshRef.current) {
      ctx.basePlateMeshRef.current.updateMatrixWorld(true);
      const matrixWorld = ctx.basePlateMeshRef.current.matrixWorld;
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(matrixWorld);
      console.log('[Export] Applying matrixWorld from mesh ref, position:', { x: pos.x.toFixed(2), y: pos.y.toFixed(2), z: pos.z.toFixed(2) });
      geometry.applyMatrix4(matrixWorld);
      console.log('[Export] Applied baseplate mesh matrixWorld to baseplateWithHoles');
    } else if (ctx.basePlate?.position) {
      // Mesh not available (unmounted after cavity), use config position
      const pos = ctx.basePlate.position;
      console.log('[Export] Mesh ref not available, using basePlate.position:', { x: pos.x, y: pos.y, z: pos.z });
      const positionMatrix = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
      geometry.applyMatrix4(positionMatrix);
      console.log('[Export] Applied basePlate.position transform to baseplateWithHoles');
    } else {
      console.warn('[Export] No transform applied to baseplateWithHoles - mesh ref null and no basePlate.position!');
    }
    
    // Debug: Log geometry bounds after transform
    geometry.computeBoundingBox();
    const afterBox = geometry.boundingBox!;
    const afterCenter = new THREE.Vector3();
    afterBox.getCenter(afterCenter);
    console.log('[Export] Baseplate geometry AFTER transform:', {
      center: { x: afterCenter.x.toFixed(2), y: afterCenter.y.toFixed(2), z: afterCenter.z.toFixed(2) },
      min: { x: afterBox.min.x.toFixed(2), y: afterBox.min.y.toFixed(2), z: afterBox.min.z.toFixed(2) },
      max: { x: afterBox.max.x.toFixed(2), y: afterBox.max.y.toFixed(2), z: afterBox.max.z.toFixed(2) }
    });
  } else if (ctx.basePlateMeshRef.current?.geometry) {
    // Baseplate mesh is still mounted - use its geometry with world transform
    console.log('[Export] Using baseplate geometry from ref (no holes)');
    geometry = ctx.basePlateMeshRef.current.geometry.clone();
    ctx.basePlateMeshRef.current.updateMatrixWorld(true);
    
    // Debug: Log geometry bounds before transform
    geometry.computeBoundingBox();
    const beforeBox = geometry.boundingBox!;
    const beforeCenter = new THREE.Vector3();
    beforeBox.getCenter(beforeCenter);
    console.log('[Export] Baseplate geometry BEFORE transform:', {
      center: { x: beforeCenter.x.toFixed(2), y: beforeCenter.y.toFixed(2), z: beforeCenter.z.toFixed(2) },
      min: { x: beforeBox.min.x.toFixed(2), y: beforeBox.min.y.toFixed(2), z: beforeBox.min.z.toFixed(2) },
      max: { x: beforeBox.max.x.toFixed(2), y: beforeBox.max.y.toFixed(2), z: beforeBox.max.z.toFixed(2) }
    });
    
    const matrixWorld = ctx.basePlateMeshRef.current.matrixWorld;
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(matrixWorld);
    console.log('[Export] Applying matrixWorld from mesh ref, position:', { x: pos.x.toFixed(2), y: pos.y.toFixed(2), z: pos.z.toFixed(2) });
    geometry.applyMatrix4(matrixWorld);
    console.log('[Export] Applied baseplate mesh matrixWorld to geometry from ref');
    
    // Debug: Log geometry bounds after transform
    geometry.computeBoundingBox();
    const afterBox = geometry.boundingBox!;
    const afterCenter = new THREE.Vector3();
    afterBox.getCenter(afterCenter);
    console.log('[Export] Baseplate geometry AFTER transform:', {
      center: { x: afterCenter.x.toFixed(2), y: afterCenter.y.toFixed(2), z: afterCenter.z.toFixed(2) },
      min: { x: afterBox.min.x.toFixed(2), y: afterBox.min.y.toFixed(2), z: afterBox.max.z.toFixed(2) },
      max: { x: afterBox.max.x.toFixed(2), y: afterBox.max.y.toFixed(2), z: afterBox.max.z.toFixed(2) }
    });
  } else if (ctx.originalBaseplateGeoRef.current) {
    // originalBaseplateGeoRef is cached from useHoleCSG (local space with geometry offset)
    // Need to apply mesh position to convert to world space
    console.log('[Export] Using baseplate geometry from originalBaseplateGeoRef');
    geometry = ctx.originalBaseplateGeoRef.current.clone();
    
    if (ctx.basePlate?.position) {
      const pos = ctx.basePlate.position;
      console.log('[Export] Applying basePlate.position to originalBaseplateGeoRef:', { x: pos.x, y: pos.y, z: pos.z });
      const positionMatrix = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
      geometry.applyMatrix4(positionMatrix);
      console.log('[Export] Applied basePlate.position transform to originalBaseplateGeoRef');
    }
  } else if (ctx.basePlate) {
    // Fallback: create from config - this is in local/origin space
    // MUST apply basePlate.position to convert to world space
    console.log('[Export] Creating baseplate geometry from config (fallback)');
    geometry = createBaseplateGeometryFromConfig(ctx.basePlate);
    
    // Apply mesh position transform to convert from local to world space
    if (ctx.basePlate.position) {
      const pos = ctx.basePlate.position;
      
      // Debug: Log geometry bounds before transform
      geometry.computeBoundingBox();
      const beforeBox = geometry.boundingBox!;
      const beforeCenter = new THREE.Vector3();
      beforeBox.getCenter(beforeCenter);
      console.log('[Export] Baseplate geometry BEFORE transform:', {
        center: { x: beforeCenter.x.toFixed(2), y: beforeCenter.y.toFixed(2), z: beforeCenter.z.toFixed(2) },
        min: { x: beforeBox.min.x.toFixed(2), y: beforeBox.min.y.toFixed(2), z: beforeBox.min.z.toFixed(2) },
        max: { x: beforeBox.max.x.toFixed(2), y: beforeBox.max.y.toFixed(2), z: beforeBox.max.z.toFixed(2) }
      });
      
      console.log('[Export] Applying basePlate.position to config-created geometry:', { x: pos.x, y: pos.y, z: pos.z });
      const positionMatrix = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
      geometry.applyMatrix4(positionMatrix);
      console.log('[Export] Applied basePlate.position transform to config-created geometry');
      
      // Debug: Log geometry bounds after transform
      geometry.computeBoundingBox();
      const afterBox = geometry.boundingBox!;
      const afterCenter = new THREE.Vector3();
      afterBox.getCenter(afterCenter);
      console.log('[Export] Baseplate geometry AFTER transform:', {
        center: { x: afterCenter.x.toFixed(2), y: afterCenter.y.toFixed(2), z: afterCenter.z.toFixed(2) },
        min: { x: afterBox.min.x.toFixed(2), y: afterBox.min.y.toFixed(2), z: afterBox.min.z.toFixed(2) },
        max: { x: afterBox.max.x.toFixed(2), y: afterBox.max.y.toFixed(2), z: afterBox.max.z.toFixed(2) }
      });
    } else {
      console.warn('[Export] No basePlate.position available for config-created geometry!');
    }
  }
  
  return { geometry, isMultiSection, multiSectionGeometries, sectionData };
}

/**
 * Collects support geometries from modified support geometries map
 */
export function collectSupportGeometries(
  modifiedSupportGeometries: Map<string, THREE.BufferGeometry>
): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = [];
  
  if (modifiedSupportGeometries.size > 0) {
    console.log(`[Export] Collecting ${modifiedSupportGeometries.size} modified support geometries`);
    modifiedSupportGeometries.forEach((geom) => {
      if (geom) {
        geometries.push(geom);
      }
    });
  }
  
  return geometries;
}

/**
 * Builds a single clamp support geometry with cutouts
 */
export async function buildClampSupportWithCutouts(
  clampId: string,
  clampPosition: THREE.Vector3,
  clampRotationY: number,
  clampData: ClampExportData,
  baseTopY: number,
  onProgress?: (message: string) => void
): Promise<THREE.BufferGeometry | null> {
  if (!clampData.supportInfo) {
    console.log(`[Export] Skipping clamp ${clampId} - no support info`);
    return null;
  }
  
  const { polygon, mountSurfaceLocalY, fixturePointY } = clampData.supportInfo;
  
  // Calculate support height
  const mountSurfaceWorldY = clampPosition.y + (mountSurfaceLocalY - fixturePointY);
  const supportHeight = Math.max(1.0, mountSurfaceWorldY - baseTopY);
  
  // Build geometry at origin using the full fillet implementation
  let clampSupportGeometry = buildClampSupportGeometryAtOrigin(polygon, supportHeight, 2);
  if (!clampSupportGeometry) {
    console.warn(`[Export] Failed to build clamp support geometry for ${clampId}`);
    return null;
  }
  
  // Apply cutouts (holes) CSG subtraction if cutouts geometry exists
  if (clampData.fixtureCutoutsGeometry && clampData.fixturePointTopCenter) {
    console.log(`[Export] Applying cutouts CSG for clamp ${clampId}`);
    onProgress?.(`Applying cutouts for clamp ${clampId}...`);
    
    // Clone and transform cutouts geometry
    const cutoutsClone = clampData.fixtureCutoutsGeometry.clone();
    cutoutsClone.translate(
      -clampData.fixturePointTopCenter.x,
      0,
      -clampData.fixturePointTopCenter.z
    );
    
    // Apply Y offset so cutouts align with support geometry
    const yOffset = supportHeight - mountSurfaceLocalY;
    cutoutsClone.translate(0, yOffset, 0);
    
    // Ensure UVs exist for CSG
    if (!cutoutsClone.getAttribute('uv')) {
      const posAttr = cutoutsClone.getAttribute('position');
      if (posAttr) {
        const uvArray = new Float32Array(posAttr.count * 2);
        cutoutsClone.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
      }
    }
    
    try {
      const csgResult = await performClampCSGInWorker(
        clampSupportGeometry,
        cutoutsClone,
        (progress) => {
          onProgress?.(`CSG for clamp ${clampId}: ${progress}%`);
        }
      );
      
      if (csgResult) {
        clampSupportGeometry = csgResult;
        console.log(`[Export] Cutouts CSG completed for clamp ${clampId}`);
      }
    } catch (err) {
      console.warn(`[Export] Cutouts CSG failed for clamp ${clampId}, using support without holes:`, err);
    }
  }
  
  // Transform to world position
  const worldRotationY = THREE.MathUtils.degToRad(clampRotationY);
  const transformMatrix = new THREE.Matrix4()
    .makeRotationY(worldRotationY)
    .setPosition(clampPosition.x, baseTopY, clampPosition.z);
  clampSupportGeometry.applyMatrix4(transformMatrix);
  
  // Debug: Log clamp support bounds
  clampSupportGeometry.computeBoundingBox();
  const clampBox = clampSupportGeometry.boundingBox!;
  const clampCenter = new THREE.Vector3();
  clampBox.getCenter(clampCenter);
  console.log(`[Export] Clamp support ${clampId} positioned at:`, {
    inputPosition: { x: clampPosition.x.toFixed(2), z: clampPosition.z.toFixed(2) },
    center: { x: clampCenter.x.toFixed(2), y: clampCenter.y.toFixed(2), z: clampCenter.z.toFixed(2) }
  });
  
  // Prepare for CSG
  prepareGeometryForCSG(clampSupportGeometry);
  
  console.log(`[Export] Added clamp support for ${clampId}, height: ${supportHeight.toFixed(2)}mm`);
  return clampSupportGeometry;
}

/**
 * Prepares a geometry for CSG operations
 */
export function prepareGeometryForCSG(geometry: THREE.BufferGeometry): void {
  // Add index if missing
  if (!geometry.index) {
    const posAttr = geometry.getAttribute('position');
    const vertexCount = posAttr.count;
    const indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  
  // Add UVs if missing
  if (!geometry.getAttribute('uv')) {
    const position = geometry.getAttribute('position');
    const uvArray = new Float32Array(position.count * 2);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }
  
  geometry.computeVertexNormals();
}

/**
 * Builds label geometries
 */
export async function buildLabelGeometries(
  labels: LabelConfig[],
  onProgress?: (message: string) => void
): Promise<THREE.BufferGeometry[]> {
  const geometries: THREE.BufferGeometry[] = [];
  
  if (labels.length === 0) return geometries;
  
  console.log(`[Export] Building ${labels.length} label geometries`);
  
  for (const label of labels) {
    try {
      onProgress?.(`Building label "${label.text}"...`);
      const labelGeometry = await buildLabelGeometry(label);
      if (labelGeometry) {
        // Debug: Log label geometry bounds
        labelGeometry.computeBoundingBox();
        const labelBox = labelGeometry.boundingBox!;
        const labelCenter = new THREE.Vector3();
        labelBox.getCenter(labelCenter);
        const labelPos = label.position;
        console.log(`[Export] Label "${label.text}" positioned at:`, {
          inputPosition: { 
            x: (labelPos instanceof THREE.Vector3 ? labelPos.x : labelPos.x).toFixed(2),
            y: (labelPos instanceof THREE.Vector3 ? labelPos.y : labelPos.y).toFixed(2),
            z: (labelPos instanceof THREE.Vector3 ? labelPos.z : labelPos.z).toFixed(2)
          },
          geometryCenter: { x: labelCenter.x.toFixed(2), y: labelCenter.y.toFixed(2), z: labelCenter.z.toFixed(2) }
        });
        geometries.push(labelGeometry);
      }
    } catch (err) {
      console.warn(`[Export] Failed to build label geometry for "${label.text}":`, err);
    }
  }
  
  return geometries;
}

/**
 * Collects all geometries required for export
 */
export async function collectAllGeometries(
  ctx: GeometryCollectionContext,
  onProgress?: ExportProgressCallback
): Promise<ExportGeometryCollection> {
  const emitProgress = (stage: 'preparing' | 'manifold', progress: number, message: string) => {
    onProgress?.({ stage, progress, message });
  };
  
  emitProgress('preparing', 5, 'Collecting component geometries...');
  
  // 1. Collect baseplate
  const { geometry: baseplateGeometry, isMultiSection, multiSectionGeometries, sectionData } = 
    collectBaseplateGeometry(ctx);
  
  // 2. Collect regular supports
  const supportGeometries = collectSupportGeometries(ctx.modifiedSupportGeometries);
  
  // 3. Build clamp support geometries
  const clampSupportGeometries: THREE.BufferGeometry[] = [];
  
  if (ctx.placedClamps.length > 0) {
    console.log(`[Export] Building ${ctx.placedClamps.length} clamp support geometries with cutouts`);
    emitProgress('preparing', 6, `Building ${ctx.placedClamps.length} clamp support geometries...`);
    
    for (const clamp of ctx.placedClamps) {
      const clampData = ctx.loadedClampDataRef.current.get(clamp.id);
      const supportInfo = ctx.clampSupportInfos.get(clamp.id);
      
      if (!clampData?.supportInfo || !supportInfo) {
        continue;
      }
      
      const geometry = await buildClampSupportWithCutouts(
        clamp.id,
        clamp.position,
        clamp.rotation.y,
        clampData as ClampExportData,
        ctx.baseTopY,
        (msg) => emitProgress('preparing', 7, msg)
      );
      
      if (geometry) {
        clampSupportGeometries.push(geometry);
      }
    }
  }
  
  // 4. Build label geometries
  emitProgress('preparing', 8, `Building ${ctx.labels.length} label geometries...`);
  const labelGeometries = await buildLabelGeometries(
    ctx.labels,
    (msg) => emitProgress('preparing', 9, msg)
  );
  
  // 5. Build per-section export data for multi-section baseplates
  const sectionGeometries = new Map<string, import('../types').SectionExportData>();
  
  if (isMultiSection && sectionData.length > 0) {
    console.log(`[Export] Building per-section export data for ${sectionData.length} sections`);
    
    // Build a lookup map from support ID to sectionId
    const supportSectionMap = new Map<string, string>();
    for (const support of ctx.supports) {
      if (support.sectionId) {
        supportSectionMap.set(support.id, support.sectionId);
      }
    }
    console.log(`[Export] Support section mapping: ${supportSectionMap.size} supports have sectionId`);
    
    for (const section of sectionData) {
      // Find supports that belong to this section by sectionId
      const sectionSupports: THREE.BufferGeometry[] = [];
      
      // Check each support geometry by ID
      ctx.modifiedSupportGeometries.forEach((geom, supportId) => {
        const supportSectionId = supportSectionMap.get(supportId);
        if (supportSectionId === section.id) {
          console.log(`[Export] Support ${supportId} assigned to section ${section.id} by sectionId`);
          sectionSupports.push(geom.clone());
        }
      });
      
      // For clamp supports, use bounds-based filtering (clamps don't have sectionId)
      for (const clampGeom of clampSupportGeometries) {
        clampGeom.computeBoundingBox();
        if (clampGeom.boundingBox) {
          const center = new THREE.Vector3();
          clampGeom.boundingBox.getCenter(center);
          
          const tolerance = 1.0;
          if (
            center.x >= section.bounds.minX - tolerance &&
            center.x <= section.bounds.maxX + tolerance &&
            center.z >= section.bounds.minZ - tolerance &&
            center.z <= section.bounds.maxZ + tolerance
          ) {
            sectionSupports.push(clampGeom.clone());
          }
        }
      }
      
      // Find labels that belong to this section by sectionId first, then fallback to bounds
      const sectionLabels: THREE.BufferGeometry[] = [];
      for (let i = 0; i < ctx.labels.length; i++) {
        const label = ctx.labels[i];
        const labelGeom = labelGeometries[i];
        if (!labelGeom) continue;
        
        // Check if label has sectionId matching this section
        if (label.sectionId === section.id) {
          console.log(`[Export] Label "${label.text}" assigned to section ${section.id} by sectionId`);
          sectionLabels.push(labelGeom.clone());
        } else if (!label.sectionId) {
          // Fallback to bounds-based filtering for labels without sectionId
          labelGeom.computeBoundingBox();
          if (labelGeom.boundingBox) {
            const center = new THREE.Vector3();
            labelGeom.boundingBox.getCenter(center);
            
            const tolerance = 1.0;
            if (
              center.x >= section.bounds.minX - tolerance &&
              center.x <= section.bounds.maxX + tolerance &&
              center.z >= section.bounds.minZ - tolerance &&
              center.z <= section.bounds.maxZ + tolerance
            ) {
              sectionLabels.push(labelGeom.clone());
            }
          }
        }
      }
      
      sectionGeometries.set(section.id, {
        id: section.id,
        index: section.index,
        baseplateGeometry: section.geometry,
        supportGeometries: sectionSupports,
        labelGeometries: sectionLabels,
        bounds: section.bounds,
      });
      
      console.log(`[Export] Section ${section.id}: ${sectionSupports.length} supports, ${sectionLabels.length} labels`);
    }
  }
  
  // Handle multi-section baseplate for combined export
  let finalBaseplateGeometry = baseplateGeometry;
  if (isMultiSection && multiSectionGeometries.length > 0 && !baseplateGeometry) {
    // For multi-section, we'll add them to supports for CSG union
    multiSectionGeometries.forEach(g => supportGeometries.unshift(g));
    finalBaseplateGeometry = null;
  }
  
  return {
    baseplateGeometry: finalBaseplateGeometry,
    supportGeometries,
    clampSupportGeometries,
    labelGeometries,
    isMultiSection,
    sectionGeometries,
  };
}
