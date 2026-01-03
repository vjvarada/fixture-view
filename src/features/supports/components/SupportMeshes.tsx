import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AnySupport } from '../types';
import { validateAndPreparePolygon, ensureClockwiseWindingXZ } from '../utils/polygonUtils';
import {
  FILLET_RADIUS,
  FILLET_SEGMENTS,
  createCylindricalFilletGeometry,
  createConicalFilletGeometry,
  createRectangularFilletGeometry,
  createPolygonFilletGeometry,
  createBottomCapGeometry,
  createTopCapGeometry,
  getConicalFilletHeight,
  removeBottomCapFaces,
  normalizeGeometryForMerge,
} from '../utils/geometryUtils';

interface SupportMeshProps {
  support: AnySupport;
  preview?: boolean;
  baseTopY?: number;
  selected?: boolean;
  onDoubleClick?: (supportId: string) => void;
}

// Double-click detection threshold in milliseconds
const DOUBLE_CLICK_THRESHOLD_MS = 300;

// Lighter blue color for selection (blue-300 for better contrast with gizmo)
const SELECTION_COLOR = 0x93c5fd;

// Use a non-metallic matte material for supports
const materialFor = (preview?: boolean, selected?: boolean) =>
  new THREE.MeshStandardMaterial({
    color: preview ? 0x3b82f6 : selected ? SELECTION_COLOR : 0x888888,
    transparent: !!preview,
    opacity: preview ? 0.5 : 1,
    metalness: 0.0,
    roughness: 0.7,
    side: THREE.DoubleSide,
    emissive: selected ? SELECTION_COLOR : 0x000000,
    emissiveIntensity: selected ? 0.2 : 0,
  });

// ============================================
// buildFullSupportGeometry - Create complete support geometry for CSG
// ============================================

/**
 * Build a complete merged geometry for a support including fillet and bottom cap.
 * The geometry is positioned in world space ready for CSG operations.
 * The bottom cap ensures watertight geometry for proper CSG subtraction.
 * @param support The support configuration
 * @param baseTopY The Y position of the baseplate top (or where to place the support bottom)
 * @param forceBaseY If true, always use baseTopY instead of support's stored baseY
 * @returns A merged BufferGeometry in world space, or null if creation fails
 */
export function buildFullSupportGeometry(support: AnySupport, baseTopY: number = 0, forceBaseY: boolean = false): THREE.BufferGeometry | null {
  const { type, height, center } = support as any;
  const rotY = (support as any).rotationY ?? 0;
  // For CSG operations, we may want to force the baseY to extend below the baseplate
  const effectiveBaseY = forceBaseY ? baseTopY : ((support as any).baseY ?? baseTopY);
  
  // Clamp fillet radius to not exceed support height
  const effectiveFilletRadius = Math.min(FILLET_RADIUS, Math.max(0, height - 0.1));
  const bodyHeight = Math.max(0.1, height - effectiveFilletRadius);
  
  let filletGeo: THREE.BufferGeometry | null = null;
  let bodyGeo: THREE.BufferGeometry | null = null;
  
  // Create rotation quaternion for body geometry
  const rotationQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
  
  if (type === 'cylindrical') {
    const { radius } = support as any;
    filletGeo = createCylindricalFilletGeometry(radius, effectiveFilletRadius, FILLET_SEGMENTS);
    // Use openEnded=true to avoid internal face at fillet/body junction
    // We'll add a top cap separately
    bodyGeo = new THREE.CylinderGeometry(radius, radius, bodyHeight, 64, 1, true);
    bodyGeo.translate(0, bodyHeight / 2 + effectiveFilletRadius, 0);
  } else if (type === 'rectangular') {
    const { width, depth, cornerRadius = 0 } = support as any;
    filletGeo = createRectangularFilletGeometry(width, depth, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS);
    
    if (cornerRadius <= 0) {
      // Create walls-only box geometry (no top/bottom caps to avoid internal faces)
      // We'll add top cap separately
      const hw = width / 2;
      const hd = depth / 2;
      const positions: number[] = [];
      const indices: number[] = [];
      const baseIdx = 0;
      
      // 4 walls: front, back, left, right
      // Each wall is a quad (2 triangles)
      const bottomY = effectiveFilletRadius;
      const topY = effectiveFilletRadius + bodyHeight;
      
      // Front wall (-Z face)
      positions.push(-hw, bottomY, -hd,  hw, bottomY, -hd,  hw, topY, -hd,  -hw, topY, -hd);
      // Back wall (+Z face)  
      positions.push(hw, bottomY, hd,  -hw, bottomY, hd,  -hw, topY, hd,  hw, topY, hd);
      // Left wall (-X face)
      positions.push(-hw, bottomY, hd,  -hw, bottomY, -hd,  -hw, topY, -hd,  -hw, topY, hd);
      // Right wall (+X face)
      positions.push(hw, bottomY, -hd,  hw, bottomY, hd,  hw, topY, hd,  hw, topY, -hd);
      
      // Indices for 4 walls (each wall has 4 vertices, 2 triangles)
      for (let wall = 0; wall < 4; wall++) {
        const i = wall * 4;
        indices.push(i, i + 1, i + 2);
        indices.push(i, i + 2, i + 3);
      }
      
      bodyGeo = new THREE.BufferGeometry();
      bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      bodyGeo.setIndex(indices);
      bodyGeo.computeVertexNormals();
    } else {
      const hw = width / 2;
      const hd = depth / 2;
      const r = Math.min(cornerRadius, hw, hd);
      const s = new THREE.Shape();
      s.moveTo(-hw + r, -hd);
      s.lineTo(hw - r, -hd);
      s.quadraticCurveTo(hw, -hd, hw, -hd + r);
      s.lineTo(hw, hd - r);
      s.quadraticCurveTo(hw, hd, hw - r, hd);
      s.lineTo(-hw + r, hd);
      s.quadraticCurveTo(-hw, hd, -hw, hd - r);
      s.lineTo(-hw, -hd + r);
      s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      // ExtrudeGeometry creates both top and bottom caps which cause internal faces
      // Remove the bottom cap to allow proper welding with fillet geometry
      let extruded = new THREE.ExtrudeGeometry(s, { depth: bodyHeight, bevelEnabled: false, curveSegments: 64 });
      extruded.rotateX(-Math.PI / 2);
      extruded.translate(0, effectiveFilletRadius, 0);
      // Remove bottom cap faces (at y = effectiveFilletRadius after translation)
      bodyGeo = removeBottomCapFaces(extruded, effectiveFilletRadius, 0.01);
      extruded.dispose();
    }
  } else if (type === 'conical') {
    const { baseRadius, topRadius } = support as any;
    const estimatedBodyHeight = Math.max(0.1, height - effectiveFilletRadius);
    const radiusDiff = baseRadius - topRadius;
    const slopeAngle = Math.atan2(radiusDiff, estimatedBodyHeight);
    const conicalFilletTopY = effectiveFilletRadius * (1 - Math.sin(slopeAngle));
    const filletTopRadius = baseRadius + effectiveFilletRadius * (1 - Math.cos(slopeAngle));
    const conicalBodyHeight = Math.max(0.1, height - conicalFilletTopY);
    
    filletGeo = createConicalFilletGeometry(baseRadius, topRadius, conicalBodyHeight, effectiveFilletRadius, FILLET_SEGMENTS);
    // Use openEnded=true to avoid internal face at fillet/body junction
    bodyGeo = new THREE.CylinderGeometry(topRadius, filletTopRadius, conicalBodyHeight, 64, 1, true);
    bodyGeo.translate(0, conicalFilletTopY + conicalBodyHeight / 2, 0);
  } else if (type === 'custom') {
    const { polygon, cornerRadius = 0 } = support as any;
    if (!polygon || polygon.length < 3) return null;
    
    // Validate and normalize polygon - removes duplicates, checks for self-intersection
    const validatedPolygon = validateAndPreparePolygon(polygon);
    if (!validatedPolygon || validatedPolygon.length < 3) {
      console.warn('[buildFullSupportGeometry] Custom support has invalid polygon');
      return null;
    }
    
    // The validated polygon is already normalized to CW
    const normalizedPolygon = validatedPolygon;
    
    // Create fillet geometry - uses same CW polygon for consistent corners
    filletGeo = createPolygonFilletGeometry(normalizedPolygon, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS);
    
    // Build the custom shape for the body
    // Apply [x, -y] transform which flips winding: CW in XZ → CCW in Shape's XY
    // THREE.js Shape expects CCW for front-facing geometry
    const workingPolygon: [number, number][] = normalizedPolygon.map(([x, y]: [number, number]) => [x, -y]);
    const safeCornerRadius = Math.max(0, cornerRadius);
    const shape = new THREE.Shape();
    let started = false;
    
    for (let idx = 0; idx < workingPolygon.length; idx++) {
      const curr = workingPolygon[idx];
      const prev = workingPolygon[(idx - 1 + workingPolygon.length) % workingPolygon.length];
      const next = workingPolygon[(idx + 1) % workingPolygon.length];
      
      const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
      const toNext = [next[0] - curr[0], next[1] - curr[1]];
      const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
      const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);
      
      if (lenPrev < 0.01 || lenNext < 0.01 || safeCornerRadius < 0.01) {
        if (!started) {
          shape.moveTo(curr[0], curr[1]);
          started = true;
        } else {
          shape.lineTo(curr[0], curr[1]);
        }
        continue;
      }
      
      const r = Math.min(safeCornerRadius, lenPrev / 2, lenNext / 2);
      const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
      const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
      
      if (r > 0.01) {
        const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
        const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
        
        if (!started) {
          shape.moveTo(insetStart[0], insetStart[1]);
          started = true;
        } else {
          shape.lineTo(insetStart[0], insetStart[1]);
        }
        shape.quadraticCurveTo(curr[0], curr[1], insetEnd[0], insetEnd[1]);
      } else {
        if (!started) {
          shape.moveTo(curr[0], curr[1]);
          started = true;
        } else {
          shape.lineTo(curr[0], curr[1]);
        }
      }
    }
    shape.closePath();
    
    // ExtrudeGeometry creates both top and bottom caps which cause internal faces
    // Remove the bottom cap to allow proper welding with fillet geometry
    let extruded = new THREE.ExtrudeGeometry(shape, { depth: bodyHeight, bevelEnabled: false, curveSegments: 64 });
    extruded.rotateX(-Math.PI / 2);
    extruded.translate(0, effectiveFilletRadius, 0);
    // Remove bottom cap faces (at y = effectiveFilletRadius after translation)
    bodyGeo = removeBottomCapFaces(extruded, effectiveFilletRadius, 0.01);
    extruded.dispose();
  }
  
  if (!filletGeo && !bodyGeo) return null;
  
  // Apply rotation to both geometries
  if (filletGeo) {
    filletGeo.applyQuaternion(rotationQuat);
  }
  if (bodyGeo) {
    bodyGeo.applyQuaternion(rotationQuat);
  }
  
  // Helper function to normalize geometry for merging
  // - Convert to non-indexed (mergeGeometries requires all indexed or all non-indexed)
  // - Remove UV attribute (fillet doesn't have UVs, body does)
  const normalizeGeometry = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const normalized = geo.index ? geo.toNonIndexed() : geo.clone();
    // Remove UV attribute to ensure compatibility
    if (normalized.getAttribute('uv')) {
      normalized.deleteAttribute('uv');
    }
    if (normalized.getAttribute('uv2')) {
      normalized.deleteAttribute('uv2');
    }
    return normalized;
  };
  
  const geometriesToMerge: THREE.BufferGeometry[] = [];
  if (filletGeo) {
    geometriesToMerge.push(normalizeGeometry(filletGeo));
  }
  if (bodyGeo) {
    geometriesToMerge.push(normalizeGeometry(bodyGeo));
  }
  
  // Add bottom cap to seal the support geometry for CSG operations
  // This ensures the cut has faces to connect to at the bottom
  const bottomCap = createBottomCapGeometry(type, support, effectiveFilletRadius);
  if (bottomCap) {
    bottomCap.applyQuaternion(rotationQuat);
    geometriesToMerge.push(normalizeGeometry(bottomCap));
  }
  
  // Add top cap to seal the support at the top
  // This is needed for:
  // - cylindrical/conical: which use CylinderGeometry with openEnded: true
  // - rectangular without cornerRadius: which uses manual wall geometry (no caps)
  // NOT needed for:
  // - rectangular with cornerRadius: uses ExtrudeGeometry which includes top cap
  // - custom polygon: uses ExtrudeGeometry which includes top cap
  const needsSeparateTopCap = 
    type === 'cylindrical' || 
    type === 'conical' || 
    (type === 'rectangular' && ((support as any).cornerRadius || 0) <= 0);
    
  if (needsSeparateTopCap) {
    const topCap = createTopCapGeometry(type, support, height, effectiveFilletRadius);
    if (topCap) {
      topCap.applyQuaternion(rotationQuat);
      geometriesToMerge.push(normalizeGeometry(topCap));
    }
  }
  
  const merged = mergeGeometries(geometriesToMerge, false);
  if (!merged) return null;
  
  // Weld duplicate vertices at seams (fillet/body/cap boundaries) for watertight mesh
  // Use a tolerance of 0.01mm to account for floating-point precision issues
  // between fillet top ring and body bottom ring vertices
  const welded = mergeVertices(merged, 0.01);
  
  // Translate to world position
  welded.translate(center.x, effectiveBaseY, center.y);
  welded.computeVertexNormals();
  
  return welded;
}

const SupportMesh: React.FC<SupportMeshProps> = ({ support, preview, baseTopY = 0, selected, onDoubleClick }) => {
  const { type, height, center } = support as any;
  const rotY = (support as any).rotationY ?? 0;
  const effectiveBaseY = (support as any).baseY ?? baseTopY;
  
  // Double-click detection
  const lastClickTimeRef = useRef<number>(0);
  
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    
    if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD_MS) {
      // Double-click detected - navigate to supports step and highlight
      onDoubleClick?.(support.id);
      
      // Dispatch navigation event to open step and accordion
      window.dispatchEvent(new CustomEvent('highlight-component', {
        detail: { category: 'support', id: support.id }
      }));
      
      lastClickTimeRef.current = 0; // Reset to prevent triple-click
    } else {
      lastClickTimeRef.current = now;
    }
  }, [support.id, onDoubleClick]);
  
  // Clamp fillet radius to not exceed support height (leave at least 0.1mm for body)
  const effectiveFilletRadius = Math.min(FILLET_RADIUS, Math.max(0, height - 0.1));
  
  // The main body starts at fillet height and goes up
  const bodyHeight = Math.max(0.1, height - effectiveFilletRadius);
  const bodyCenter = effectiveBaseY + effectiveFilletRadius + bodyHeight / 2;

  // Track geometries for cleanup
  const geometriesRef = useRef<THREE.BufferGeometry[]>([]);
  const materialRef = useRef<THREE.Material | null>(null);

  // Cleanup geometries and material on unmount
  useEffect(() => {
    return () => {
      geometriesRef.current.forEach(geo => geo.dispose());
      geometriesRef.current = [];
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);

  const mat = React.useMemo(() => {
    // Dispose previous material if exists
    if (materialRef.current) {
      materialRef.current.dispose();
    }
    const newMat = materialFor(preview, selected);
    materialRef.current = newMat;
    return newMat;
  }, [preview, selected]);

  // Helper to register a geometry for cleanup
  const registerGeometry = useCallback(<T extends THREE.BufferGeometry>(geo: T): T => {
    geometriesRef.current.push(geo);
    return geo;
  }, []);

  if (type === 'cylindrical') {
    const { radius } = support as any;
    const geo = React.useMemo(() => registerGeometry(new THREE.CylinderGeometry(radius, radius, bodyHeight, 64)), [radius, bodyHeight, registerGeometry]);
    const filletGeo = React.useMemo(() => registerGeometry(createCylindricalFilletGeometry(radius, effectiveFilletRadius, FILLET_SEGMENTS)), [radius, effectiveFilletRadius, registerGeometry]);
    const bottomCapGeo = React.useMemo(() => {
      const outerRadius = radius + effectiveFilletRadius;
      const cap = new THREE.CircleGeometry(outerRadius, 64);
      cap.rotateX(Math.PI / 2); // Face downward
      return registerGeometry(cap);
    }, [radius, effectiveFilletRadius, registerGeometry]);
    
    return (
      <group onClick={handleClick}>
        <mesh geometry={bottomCapGeo} position={[center.x, effectiveBaseY, center.y]} material={mat} />
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} material={mat} />
        <group position={[center.x, bodyCenter, center.y]}>
          <mesh geometry={geo} material={mat} />
        </group>
      </group>
    );
  }

  if (type === 'rectangular') {
    const { width, depth, cornerRadius = 0 } = support as any;
    const filletGeo = React.useMemo(() => registerGeometry(createRectangularFilletGeometry(width, depth, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS)), [width, depth, cornerRadius, effectiveFilletRadius, registerGeometry]);
    
    // Bottom cap geometry
    const bottomCapGeo = React.useMemo(() => {
      const capWidth = width + effectiveFilletRadius * 2;
      const capDepth = depth + effectiveFilletRadius * 2;
      const capCornerRadius = cornerRadius + effectiveFilletRadius;
      
      if (capCornerRadius <= 0.01) {
        const cap = new THREE.PlaneGeometry(capWidth, capDepth);
        cap.rotateX(Math.PI / 2); // Face downward
        return registerGeometry(cap);
      } else {
        const hw = capWidth / 2;
        const hd = capDepth / 2;
        const r = Math.min(capCornerRadius, hw, hd);
        const shape = new THREE.Shape();
        shape.moveTo(-hw + r, -hd);
        shape.lineTo(hw - r, -hd);
        shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
        shape.lineTo(hw, hd - r);
        shape.quadraticCurveTo(hw, hd, hw - r, hd);
        shape.lineTo(-hw + r, hd);
        shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
        shape.lineTo(-hw, -hd + r);
        shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
        const cap = new THREE.ShapeGeometry(shape, 32);
        cap.rotateX(Math.PI / 2); // Face downward
        return registerGeometry(cap);
      }
    }, [width, depth, cornerRadius, effectiveFilletRadius, registerGeometry]);
    
    if (cornerRadius <= 0) {
      const geo = React.useMemo(() => registerGeometry(new THREE.BoxGeometry(width, bodyHeight, depth)), [width, bodyHeight, depth, registerGeometry]);
      return (
        <group onClick={handleClick}>
          <mesh geometry={bottomCapGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
          <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
          <group position={[center.x, bodyCenter, center.y]} rotation={[0, rotY, 0]}>
            <mesh geometry={geo} material={mat} />
          </group>
        </group>
      );
    }
    
    const rrGeo = React.useMemo(() => {
      const hw = width / 2;
      const hd = depth / 2;
      const r = Math.min(cornerRadius, hw, hd);
      const s = new THREE.Shape();
      s.moveTo(-hw + r, -hd);
      s.lineTo(hw - r, -hd);
      s.quadraticCurveTo(hw, -hd, hw, -hd + r);
      s.lineTo(hw, hd - r);
      s.quadraticCurveTo(hw, hd, hw - r, hd);
      s.lineTo(-hw + r, hd);
      s.quadraticCurveTo(-hw, hd, -hw, hd - r);
      s.lineTo(-hw, -hd + r);
      s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      const e = new THREE.ExtrudeGeometry(s, { depth: bodyHeight, bevelEnabled: false, curveSegments: 64 });
      e.rotateX(-Math.PI / 2);
      // Extrude upward (positive Y direction)
      return registerGeometry(e);
    }, [width, depth, cornerRadius, bodyHeight, registerGeometry]);
    
    return (
      <group onClick={handleClick}>
        <mesh geometry={bottomCapGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
        <group position={[center.x, effectiveBaseY + effectiveFilletRadius, center.y]} rotation={[0, rotY, 0]}>
          <mesh geometry={rrGeo} material={mat} />
        </group>
      </group>
    );
  }

  if (type === 'conical') {
    const { baseRadius, topRadius } = support as any;
    
    // For conical supports, calculate the fillet height based on the cone's slope
    const totalHeight = height;
    
    // Calculate slope angle based on estimated body height
    const estimatedBodyHeight = Math.max(0.1, totalHeight - effectiveFilletRadius);
    const radiusDiff = baseRadius - topRadius;
    const slopeAngle = Math.atan2(radiusDiff, estimatedBodyHeight);
    
    // The fillet top Y (relative to fillet position) = filletRadius * (1 - sin(slopeAngle))
    // At start angle (π + slopeAngle): y = filletRadius + filletRadius * sin(π + slopeAngle)
    //                                    = filletRadius - filletRadius * sin(slopeAngle)
    //                                    = filletRadius * (1 - sin(slopeAngle))
    const conicalFilletTopY = effectiveFilletRadius * (1 - Math.sin(slopeAngle));
    
    // The fillet top radius (where it meets the cone)
    // At start angle: r = (baseRadius + filletRadius) + filletRadius * cos(π + slopeAngle)
    //                   = baseRadius + filletRadius - filletRadius * cos(slopeAngle)
    //                   = baseRadius + filletRadius * (1 - cos(slopeAngle))
    const filletTopRadius = baseRadius + effectiveFilletRadius * (1 - Math.cos(slopeAngle));
    
    // The cone body starts where the fillet ends
    // Cone bottom is at y = effectiveBaseY + conicalFilletTopY with radius = filletTopRadius
    const conicalBodyHeight = Math.max(0.1, totalHeight - conicalFilletTopY);
    const conicalBodyCenter = effectiveBaseY + conicalFilletTopY + conicalBodyHeight / 2;
    
    // The cone geometry: bottom radius should match where the fillet ends
    const geo = React.useMemo(() => registerGeometry(new THREE.CylinderGeometry(topRadius, filletTopRadius, conicalBodyHeight, 64)), [topRadius, filletTopRadius, conicalBodyHeight, registerGeometry]);
    const filletGeo = React.useMemo(() => registerGeometry(createConicalFilletGeometry(baseRadius, topRadius, conicalBodyHeight, effectiveFilletRadius, FILLET_SEGMENTS)), [baseRadius, topRadius, conicalBodyHeight, effectiveFilletRadius, registerGeometry]);
    const bottomCapGeo = React.useMemo(() => {
      const outerRadius = baseRadius + effectiveFilletRadius;
      const cap = new THREE.CircleGeometry(outerRadius, 64);
      cap.rotateX(Math.PI / 2); // Face downward
      return registerGeometry(cap);
    }, [baseRadius, effectiveFilletRadius, registerGeometry]);
    
    return (
      <group onClick={handleClick}>
        <mesh geometry={bottomCapGeo} position={[center.x, effectiveBaseY, center.y]} material={mat} />
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} material={mat} />
        <group position={[center.x, conicalBodyCenter, center.y]}>
          <mesh geometry={geo} material={mat} />
        </group>
      </group>
    );
  }

  if (type === 'custom') {
    const { polygon, cornerRadius = 0 } = support as any;
    
    // Memoize polygon string to avoid recalculating on every render
    const polygonKey = React.useMemo(() => JSON.stringify(polygon), [polygon]);
    
    // Validate polygon before creating geometry
    const validPolygon = React.useMemo(() => {
      if (!Array.isArray(polygon) || polygon.length < 3) return null;
      // Check for valid numeric coordinates
      for (const pt of polygon) {
        if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
          return null;
        }
      }
      return polygon as [number, number][];
    }, [polygonKey]);
    
    // Clamp corner radius to a safe value
    const safeCornerRadius = React.useMemo(() => {
      if (!validPolygon || cornerRadius <= 0) return 0;
      // Find minimum edge length to clamp corner radius
      let minEdgeLen = Infinity;
      for (let i = 0; i < validPolygon.length; i++) {
        const curr = validPolygon[i];
        const next = validPolygon[(i + 1) % validPolygon.length];
        const len = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
        if (len < minEdgeLen) minEdgeLen = len;
      }
      // Corner radius should be at most half the shortest edge
      return Math.max(0, Math.min(cornerRadius, minEdgeLen / 2 - 0.1));
    }, [validPolygon, cornerRadius]);
    
    const filletGeo = React.useMemo(() => {
      if (!validPolygon) return registerGeometry(new THREE.BufferGeometry());
      return registerGeometry(createPolygonFilletGeometry(validPolygon, safeCornerRadius, effectiveFilletRadius, FILLET_SEGMENTS));
    }, [validPolygon, safeCornerRadius, effectiveFilletRadius, registerGeometry]);
    
    const bottomCapGeo = React.useMemo(() => {
      if (!validPolygon) return registerGeometry(new THREE.BufferGeometry());
      return registerGeometry(createBottomCapGeometry('custom', { polygon: validPolygon, cornerRadius: safeCornerRadius }, effectiveFilletRadius));
    }, [validPolygon, safeCornerRadius, effectiveFilletRadius, registerGeometry]);
    
    const geo = React.useMemo(() => {
      if (!validPolygon) return registerGeometry(new THREE.BufferGeometry());
      
      const shape = new THREE.Shape();
      const n = validPolygon.length;
      
      // Mirror the Y coordinates to match the rotation direction
      const workingPolygon: [number, number][] = validPolygon.map(([x, y]: [number, number]) => [x, -y]);
      
      if (safeCornerRadius <= 0) {
        // No rounding - simple polygon
        shape.moveTo(workingPolygon[0][0], workingPolygon[0][1]);
        for (let i = 1; i < n; i++) {
          shape.lineTo(workingPolygon[i][0], workingPolygon[i][1]);
        }
        shape.closePath();
      } else {
        // Build rounded polygon using quadratic curves at all corners
        // For a simple convex polygon like a rectangle, all exterior corners should be rounded
        let started = false;
        
        for (let i = 0; i < n; i++) {
          const prev = workingPolygon[(i - 1 + n) % n];
          const curr = workingPolygon[i];
          const next = workingPolygon[(i + 1) % n];
          
          const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
          const toNext = [next[0] - curr[0], next[1] - curr[1]];
          const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
          const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);
          
          if (lenPrev < 0.01 || lenNext < 0.01) {
            if (!started) {
              shape.moveTo(curr[0], curr[1]);
              started = true;
            } else {
              shape.lineTo(curr[0], curr[1]);
            }
            continue;
          }
          
          // Apply safe corner radius
          const r = Math.min(safeCornerRadius, lenPrev / 2, lenNext / 2);
          
          const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
          const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
          
          if (r > 0.01) {
            // Calculate inset points for the arc
            const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
            const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
            
            if (!started) {
              shape.moveTo(insetStart[0], insetStart[1]);
              started = true;
            } else {
              shape.lineTo(insetStart[0], insetStart[1]);
            }
            // Use quadratic curve through the original corner point
            shape.quadraticCurveTo(curr[0], curr[1], insetEnd[0], insetEnd[1]);
          } else {
            if (!started) {
              shape.moveTo(curr[0], curr[1]);
              started = true;
            } else {
              shape.lineTo(curr[0], curr[1]);
            }
          }
        }
        shape.closePath();
      }
      
      const e = new THREE.ExtrudeGeometry(shape, { depth: bodyHeight, bevelEnabled: false, curveSegments: 64 });
      e.rotateX(-Math.PI / 2);
      // Extrude upward (positive Y direction)
      return registerGeometry(e);
    }, [validPolygon, safeCornerRadius, bodyHeight, registerGeometry]);
    
    return (
      <group onClick={handleClick}>
        {bottomCapGeo && <mesh geometry={bottomCapGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />}
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
        <group position={[center.x, effectiveBaseY + effectiveFilletRadius, center.y]} rotation={[0, rotY, 0]}>
          <mesh geometry={geo} material={mat} />
        </group>
      </group>
    );
  }

  return null;
};

// Memoize SupportMesh to prevent unnecessary re-renders when other supports change
const MemoizedSupportMesh = React.memo(SupportMesh, (prevProps, nextProps) => {
  // Only re-render if this support's data changed
  return (
    prevProps.support === nextProps.support &&
    prevProps.preview === nextProps.preview &&
    prevProps.baseTopY === nextProps.baseTopY &&
    prevProps.selected === nextProps.selected &&
    prevProps.onDoubleClick === nextProps.onDoubleClick
  );
});

export default MemoizedSupportMesh;
