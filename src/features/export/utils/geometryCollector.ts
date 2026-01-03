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
import {
  logDebug,
  logWarn,
  logError,
  logGeometryTransform,
  formatPosition,
} from './debugUtils';

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
    logWarn('createMultiSectionGeometriesFromConfig called for non-multi-section baseplate');
    return { geometries, sectionData };
  }
  
  const depth = config.depth ?? 4;
  
  config.sections.forEach((section, index) => {
    // Validate section
    if (!Number.isFinite(section.minX) || !Number.isFinite(section.maxX) ||
        !Number.isFinite(section.minZ) || !Number.isFinite(section.maxZ) ||
        section.maxX <= section.minX || section.maxZ <= section.minZ) {
      logWarn(`Skipping invalid section ${section.id}`, section as unknown as Record<string, unknown>);
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
    
    logDebug(`Created section ${section.id} from config`, {
      size: `${width.toFixed(1)}x${height.toFixed(1)}`,
      center: `(${centerX.toFixed(1)}, ${centerZ.toFixed(1)})`,
    });
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
    logWarn('createBaseplateGeometryFromConfig called for multi-section baseplate - use multiSectionBasePlateGroupRef');
    return null;
  }
  
  try {
    const width = config.width ?? 200;
    const depth = config.depth ?? 10;
    const height = config.height ?? 200;
    
    // Create a rounded rectangle shape similar to BasePlate component
    const cornerRadius = Math.min(width, height) * CORNER_RADIUS_FACTOR;
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
    const chamferSize = Math.min(1.0, depth * CHAMFER_SIZE_FACTOR);
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
    
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();
    
    logDebug('Created baseplate geometry from config (local space)', { width, height, depth });
    return geometry;
  } catch (err) {
    logError('Failed to create baseplate geometry from config', err);
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
    return collectMultiSectionGeometry(ctx, multiSectionGeometries, sectionData);
  }
  
  // Single baseplate handling
  geometry = collectSingleBaseplateGeometry(ctx);
  
  return { geometry, isMultiSection, multiSectionGeometries, sectionData };
}

/**
 * Collects multi-section baseplate geometries
 */
function collectMultiSectionGeometry(
  ctx: GeometryCollectionContext,
  multiSectionGeometries: THREE.BufferGeometry[],
  sectionData: SectionGeometryData[]
): { 
  geometry: THREE.BufferGeometry | null; 
  isMultiSection: boolean; 
  multiSectionGeometries: THREE.BufferGeometry[];
  sectionData: SectionGeometryData[];
} {
  if (ctx.multiSectionBasePlateGroupRef.current && ctx.basePlate?.sections) {
    logDebug('Collecting multi-section baseplate geometries');
    const sections = ctx.basePlate.sections;
    let sectionIndex = 0;
    
    ctx.multiSectionBasePlateGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const section = sections[sectionIndex];
        if (section) {
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
          logDebug(`Collected section ${section.id}`, {
            index: sectionIndex,
            bounds: `[${section.minX.toFixed(1)}, ${section.maxX.toFixed(1)}] x [${section.minZ.toFixed(1)}, ${section.maxZ.toFixed(1)}]`,
          });
        }
        sectionIndex++;
      }
    });
    
    if (multiSectionGeometries.length === 0) {
      logWarn('Multi-section baseplate group has no mesh children!');
    }
  } else if (ctx.basePlate?.sections) {
    logDebug('Multi-section baseplate ref not available, creating from config');
    const fallback = createMultiSectionGeometriesFromConfig(ctx.basePlate);
    multiSectionGeometries.push(...fallback.geometries);
    sectionData.push(...fallback.sectionData);
  } else {
    logError('Multi-section baseplate but no sections defined!');
  }
  
  return { geometry: null, isMultiSection: true, multiSectionGeometries, sectionData };
}

/**
 * Applies world transform to geometry and logs the transformation
 */
function applyWorldTransform(
  geometry: THREE.BufferGeometry,
  transform: THREE.Matrix4,
  label: string
): void {
  logGeometryTransform(label, geometry, 'before');
  geometry.applyMatrix4(transform);
  logGeometryTransform(label, geometry, 'after');
}

/**
 * Gets transform matrix from mesh ref or position
 */
function getBaseplateTransform(
  meshRef: React.RefObject<THREE.Mesh | null>,
  fallbackPosition?: { x: number; y: number; z: number }
): THREE.Matrix4 | null {
  if (meshRef.current) {
    meshRef.current.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(meshRef.current.matrixWorld);
    logDebug('Using matrixWorld from mesh ref', formatPosition(pos) as unknown as Record<string, unknown>);
    return meshRef.current.matrixWorld.clone();
  }
  
  if (fallbackPosition) {
    logDebug('Using basePlate.position (mesh ref not available)', formatPosition(fallbackPosition) as unknown as Record<string, unknown>);
    return new THREE.Matrix4().makeTranslation(
      fallbackPosition.x,
      fallbackPosition.y,
      fallbackPosition.z
    );
  }
  
  return null;
}

/**
 * Collects single baseplate geometry from various sources
 */
function collectSingleBaseplateGeometry(
  ctx: GeometryCollectionContext
): THREE.BufferGeometry | null {
  let geometry: THREE.BufferGeometry | null = null;
  
  // Priority 1: baseplateWithHoles (CSG result)
  if (ctx.baseplateWithHoles) {
    logDebug('Using baseplateWithHoles geometry');
    geometry = ctx.baseplateWithHoles.clone();
    
    const transform = getBaseplateTransform(ctx.basePlateMeshRef, ctx.basePlate?.position);
    if (transform) {
      applyWorldTransform(geometry, transform, 'Baseplate (with holes)');
    } else {
      logWarn('No transform applied to baseplateWithHoles - mesh ref null and no basePlate.position!');
    }
    return geometry;
  }
  
  // Priority 2: basePlateMeshRef geometry
  if (ctx.basePlateMeshRef.current?.geometry) {
    logDebug('Using baseplate geometry from ref (no holes)');
    geometry = ctx.basePlateMeshRef.current.geometry.clone();
    
    ctx.basePlateMeshRef.current.updateMatrixWorld(true);
    applyWorldTransform(geometry, ctx.basePlateMeshRef.current.matrixWorld, 'Baseplate (from ref)');
    return geometry;
  }
  
  // Priority 3: originalBaseplateGeoRef
  if (ctx.originalBaseplateGeoRef.current) {
    logDebug('Using baseplate geometry from originalBaseplateGeoRef');
    geometry = ctx.originalBaseplateGeoRef.current.clone();
    
    if (ctx.basePlate?.position) {
      const transform = new THREE.Matrix4().makeTranslation(
        ctx.basePlate.position.x,
        ctx.basePlate.position.y,
        ctx.basePlate.position.z
      );
      applyWorldTransform(geometry, transform, 'Baseplate (from originalRef)');
    }
    return geometry;
  }
  
  // Priority 4: Create from config (fallback)
  if (ctx.basePlate) {
    logDebug('Creating baseplate geometry from config (fallback)');
    geometry = createBaseplateGeometryFromConfig(ctx.basePlate);
    
    if (geometry && ctx.basePlate.position) {
      const transform = new THREE.Matrix4().makeTranslation(
        ctx.basePlate.position.x,
        ctx.basePlate.position.y,
        ctx.basePlate.position.z
      );
      applyWorldTransform(geometry, transform, 'Baseplate (from config)');
    } else if (geometry) {
      logWarn('No basePlate.position available for config-created geometry!');
    }
  }
  
  return geometry;
}

/**
 * Collects support geometries from modified support geometries map
 */
export function collectSupportGeometries(
  modifiedSupportGeometries: Map<string, THREE.BufferGeometry>
): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = [];
  
  if (modifiedSupportGeometries.size > 0) {
    logDebug(`Collecting ${modifiedSupportGeometries.size} modified support geometries`);
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
    logDebug(`Skipping clamp ${clampId} - no support info`);
    return null;
  }
  
  const { polygon, mountSurfaceLocalY, fixturePointY } = clampData.supportInfo;
  
  // Calculate support height
  const mountSurfaceWorldY = clampPosition.y + (mountSurfaceLocalY - fixturePointY);
  const supportHeight = Math.max(1.0, mountSurfaceWorldY - baseTopY);
  
  // Build geometry at origin using the full fillet implementation
  let clampSupportGeometry = buildClampSupportGeometryAtOrigin(polygon, supportHeight, 2);
  if (!clampSupportGeometry) {
    logWarn(`Failed to build clamp support geometry for ${clampId}`);
    return null;
  }
  
  // Apply cutouts (holes) CSG subtraction if cutouts geometry exists
  if (clampData.fixtureCutoutsGeometry && clampData.fixturePointTopCenter) {
    logDebug(`Applying cutouts CSG for clamp ${clampId}`);
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
        logDebug(`Cutouts CSG completed for clamp ${clampId}`);
      }
    } catch (err) {
      logWarn(`Cutouts CSG failed for clamp ${clampId}, using support without holes`, err);
    }
  }
  
  // Transform to world position
  const worldRotationY = THREE.MathUtils.degToRad(clampRotationY);
  const transformMatrix = new THREE.Matrix4()
    .makeRotationY(worldRotationY)
    .setPosition(clampPosition.x, baseTopY, clampPosition.z);
  clampSupportGeometry.applyMatrix4(transformMatrix);
  
  // Log clamp support position
  logDebug(`Added clamp support for ${clampId}`, {
    height: `${supportHeight.toFixed(2)}mm`,
    position: formatPosition(clampPosition) as unknown as Record<string, unknown>,
  });
  
  // Prepare for CSG
  prepareGeometryForCSG(clampSupportGeometry);
  
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
  
  logDebug(`Building ${labels.length} label geometries`);
  
  for (const label of labels) {
    try {
      onProgress?.(`Building label "${label.text}"...`);
      const labelGeometry = await buildLabelGeometry(label);
      if (labelGeometry) {
        logDebug(`Built label "${label.text}"`, {
          position: formatPosition(label.position) as unknown as Record<string, unknown>,
        });
        geometries.push(labelGeometry);
      }
    } catch (err) {
      logWarn(`Failed to build label geometry for "${label.text}"`, err);
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
    logDebug(`Building ${ctx.placedClamps.length} clamp support geometries with cutouts`);
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
    logDebug(`Building per-section export data for ${sectionData.length} sections`);
    
    // Build a lookup map from support ID to sectionId
    const supportSectionMap = new Map<string, string>();
    for (const support of ctx.supports) {
      if (support.sectionId) {
        supportSectionMap.set(support.id, support.sectionId);
      }
    }
    logDebug(`Support section mapping: ${supportSectionMap.size} supports have sectionId`);
    
    for (const section of sectionData) {
      // Find supports that belong to this section by sectionId
      const sectionSupports: THREE.BufferGeometry[] = [];
      
      // Check each support geometry by ID
      ctx.modifiedSupportGeometries.forEach((geom, supportId) => {
        const supportSectionId = supportSectionMap.get(supportId);
        if (supportSectionId === section.id) {
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
      
      logDebug(`Section ${section.id}`, { 
        supports: sectionSupports.length, 
        labels: sectionLabels.length 
      });
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
