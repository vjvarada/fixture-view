import React, { useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AnySupport } from '../types';

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

// Fillet parameters
const FILLET_RADIUS = 2.0; // mm - radius of the fillet curve
const FILLET_SEGMENTS = 24; // number of segments for smooth fillet (increased for better CSG results)

// Create a fillet ring geometry for cylindrical/conical supports
// The fillet curves from the baseplate (y=0) up to meet the support wall (y=filletRadius)
// It's a quarter-torus shape that adds material around the base
const createCylindricalFilletGeometry = (supportRadius: number, filletRadius: number = FILLET_RADIUS, segments: number = FILLET_SEGMENTS): THREE.BufferGeometry => {
  const radialSegments = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  
  // Generate fillet profile - quarter circle curving from baseplate up to the cylinder wall
  // At i=0: at the baseplate, outer edge (x=supportRadius+filletRadius, y=0)
  // At i=segments: at the cylinder wall (x=supportRadius, y=filletRadius)
  // The center of the quarter circle is at (supportRadius + filletRadius, 0)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = Math.PI + t * (Math.PI / 2); // from 180 deg to 270 deg
    const x = (supportRadius + filletRadius) + filletRadius * Math.cos(angle); // starts at supportRadius, ends at supportRadius+filletRadius
    const y = filletRadius * Math.sin(angle) + filletRadius; // starts at 0, ends at filletRadius
    
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      
      positions.push(x * cosTheta, y, x * sinTheta);
    }
  }
  
  // Generate indices - winding order for outward-facing normals
  // Use (a,c,b) and (c,d,b) winding for outward normals on the fillet surface
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      const c = a + 1;
      const d = b + 1;
      
      indices.push(a, c, b);
      indices.push(c, d, b);
    }
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
};

// Helper function to compute the height of a conical fillet
// Returns the Y position where the fillet ends at the top (meeting the cone body)
const getConicalFilletHeight = (baseRadius: number, topRadius: number, coneHeight: number, filletRadius: number): number => {
  // Calculate slope angle
  const radiusDiff = baseRadius - topRadius;
  const slopeAngle = Math.atan2(radiusDiff, coneHeight);
  // Fillet top Y = filletRadius * (1 - sin(slopeAngle))
  return filletRadius * (1 - Math.sin(slopeAngle));
};

// Create a fillet ring geometry for conical supports
// This creates an external fillet tangent to both the horizontal baseplate and the cone's sloped wall
const createConicalFilletGeometry = (
  baseRadius: number, 
  topRadius: number, 
  coneHeight: number,
  filletRadius: number = FILLET_RADIUS, 
  segments: number = FILLET_SEGMENTS
): THREE.BufferGeometry => {
  const radialSegments = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  
  // Calculate the cone's slope angle (angle from vertical)
  const radiusDiff = baseRadius - topRadius;
  const slopeAngle = Math.atan2(radiusDiff, coneHeight);
  
  // For a fillet tangent to both horizontal (baseplate) and the sloped cone wall:
  // - The fillet center needs to be positioned so that tangency is achieved at both surfaces
  // - For horizontal tangency at y=0: center is at distance filletRadius above (y = filletRadius)
  // - For tangency to slope: the fillet must meet the cone wall perpendicularly to the wall's normal
  
  // The cone wall normal points outward at angle (90° - slopeAngle) from horizontal
  // or equivalently at angle slopeAngle from vertical
  
  // For the fillet to be tangent to the slope, the center must be offset from the cone surface
  // by filletRadius in the direction of the surface normal.
  
  // Key insight: The fillet center is at (baseRadius + filletRadius, filletRadius)
  // The arc sweeps from angle 3π/2 (pointing down, tangent to horizontal) 
  // to angle (π + slopeAngle) (tangent to the cone slope)
  
  // Arc angle = (3π/2) - (π + slopeAngle) = π/2 - slopeAngle
  // But we sweep from top (meeting cone) to bottom (meeting baseplate)
  
  const filletCenterR = baseRadius + filletRadius;
  const filletCenterY = filletRadius;
  
  // The arc goes from angle (π + slopeAngle) at the top (tangent to cone slope)
  // to angle (3π/2) at the bottom (tangent to horizontal baseplate)
  const startAngle = Math.PI + slopeAngle;  // tangent to cone slope
  const endAngle = 3 * Math.PI / 2;          // tangent to horizontal (pointing down)
  const arcAngle = endAngle - startAngle;    // = π/2 - slopeAngle
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * arcAngle;
    
    const r = filletCenterR + filletRadius * Math.cos(angle);
    const y = filletCenterY + filletRadius * Math.sin(angle);
    
    // Revolve around Y axis
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      
      positions.push(r * cosTheta, y, r * sinTheta);
    }
  }
  
  // Generate indices - match the winding from circular fillet
  // Use (a,c,b) and (c,d,b) winding for outward normals on the fillet surface
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      const c = a + 1;
      const d = b + 1;
      
      indices.push(a, c, b);
      indices.push(c, d, b);
    }
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
};

// Helper function to create a rounded polygon path with corner radius
const createRoundedPolygon = (polygon: [number, number][], cornerRadius: number): { points: [number, number][], cornerCenters: { cx: number, cz: number, startAngle: number, endAngle: number }[] } => {
  if (polygon.length < 3 || cornerRadius <= 0) {
    return { points: polygon, cornerCenters: [] };
  }
  
  const points: [number, number][] = [];
  const cornerCenters: { cx: number, cz: number, startAngle: number, endAngle: number }[] = [];
  const cornerSegs = 8;
  
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length];
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    
    // Vectors from current vertex to neighbors
    const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
    const toNext = [next[0] - curr[0], next[1] - curr[1]];
    
    const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
    const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);
    
    if (lenPrev < 0.01 || lenNext < 0.01) {
      points.push(curr);
      continue;
    }
    
    // Normalize directions
    const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
    const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
    
    // Angle between edges
    const dot = dirPrev[0] * dirNext[0] + dirPrev[1] * dirNext[1];
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    // Limit corner radius to not exceed half of either edge
    const maxR = Math.min(lenPrev / 2, lenNext / 2, cornerRadius);
    const r = maxR;
    
    if (r < 0.01 || angle < 0.01 || angle > Math.PI - 0.01) {
      points.push(curr);
      continue;
    }
    
    // Distance from vertex to arc tangent points
    const tanDist = r / Math.tan(angle / 2);
    
    // Tangent points
    const tp1: [number, number] = [curr[0] + dirPrev[0] * tanDist, curr[1] + dirPrev[1] * tanDist];
    const tp2: [number, number] = [curr[0] + dirNext[0] * tanDist, curr[1] + dirNext[1] * tanDist];
    
    // Arc center (offset inward from the corner)
    const bisector = [dirPrev[0] + dirNext[0], dirPrev[1] + dirNext[1]];
    const bisLen = Math.sqrt(bisector[0] ** 2 + bisector[1] ** 2);
    if (bisLen < 0.01) {
      points.push(curr);
      continue;
    }
    const bisDir = [bisector[0] / bisLen, bisector[1] / bisLen];
    const centerDist = r / Math.sin(angle / 2);
    const cx = curr[0] + bisDir[0] * centerDist;
    const cz = curr[1] + bisDir[1] * centerDist;
    
    // Calculate start and end angles for the arc
    const startAngle = Math.atan2(tp1[1] - cz, tp1[0] - cx);
    const endAngle = Math.atan2(tp2[1] - cz, tp2[0] - cx);
    
    // Determine arc direction (should go the short way around, following polygon winding)
    let angleDiff = endAngle - startAngle;
    if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // Generate arc points
    for (let j = 0; j <= cornerSegs; j++) {
      const t = j / cornerSegs;
      const a = startAngle + t * angleDiff;
      points.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    
    cornerCenters.push({ cx, cz, startAngle, endAngle: startAngle + angleDiff });
  }
  
  return { points, cornerCenters };
};

// Create a fillet for custom polygon supports
// This traces the polygon edges and creates fillet strips along each edge
const createPolygonFilletGeometry = (polygon: [number, number][], cornerRadius: number = 0, filletRadius: number = FILLET_RADIUS, segments: number = FILLET_SEGMENTS): THREE.BufferGeometry => {
  if (polygon.length < 3) {
    return new THREE.BufferGeometry();
  }
  
  // The polygon coordinates are [x, y] and we work directly in XZ space.
  // The body uses Shape [x, -y] + rotateX(-PI/2), which results in world coords (x, height, y).
  // So body's z_world = original y. The fillet uses [x, z] directly where z = original y.
  // We just need to use the polygon as-is for [x, z] positioning.
  // However, the body's [x, -y] + rotation effectively reverses the winding when viewed from above.
  // To match this, we reverse the polygon order for the fillet.
  const workingPolygon: [number, number][] = [...polygon].reverse();
  
  const positions: number[] = [];
  const indices: number[] = [];
  
  // Determine polygon winding order (CW vs CCW) by computing signed area
  let signedArea = 0;
  for (let i = 0; i < workingPolygon.length; i++) {
    const [x1, z1] = workingPolygon[i];
    const [x2, z2] = workingPolygon[(i + 1) % workingPolygon.length];
    signedArea += (x2 - x1) * (z2 + z1);
  }
  // If signedArea > 0, polygon is CW; if < 0, polygon is CCW
  const isCW = signedArea > 0;
  
  // For each vertex, compute the outward normal direction
  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return [0, 0];
    // Perpendicular: (dz, -dx) or (-dz, dx) depending on winding
    if (isCW) {
      return [-dz / len, dx / len]; // outward for CW
    } else {
      return [dz / len, -dx / len]; // outward for CCW
    }
  };
  
  // Helper to add a fillet strip along an edge
  const addEdgeFillet = (x1: number, z1: number, x2: number, z2: number, nx: number, nz: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.01) return;
    
    const stripSegments = Math.max(2, Math.ceil(length / 5));
    const baseIdx = positions.length / 3;
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = Math.PI + t * (Math.PI / 2);
      const outDist = filletRadius + filletRadius * Math.cos(angle);
      const y = filletRadius * Math.sin(angle) + filletRadius;
      
      for (let j = 0; j <= stripSegments; j++) {
        const s = j / stripSegments;
        const px = x1 + s * dx + nx * outDist;
        const pz = z1 + s * dz + nz * outDist;
        
        positions.push(px, y, pz);
      }
    }
    
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < stripSegments; j++) {
        const a = baseIdx + i * (stripSegments + 1) + j;
        const b = a + stripSegments + 1;
        const c = a + 1;
        const d = b + 1;
        
        // Use (a,b,c) and (c,b,d) winding for polygon fillets
        // This is opposite to cylindrical/rectangular fillets because the polygon
        // uses reverse() which inverts the effective winding direction
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }
  };
  
  // Helper to add a corner fillet that follows a quadratic Bezier curve
  // The support body uses quadraticCurveTo(vertex, insetEnd), so the fillet must follow the same path
  const addCornerFillet = (
    vx: number, vz: number,  // vertex (control point of Bezier)
    insetStartX: number, insetStartZ: number,  // start of Bezier (from previous edge)
    insetEndX: number, insetEndZ: number,  // end of Bezier (to next edge)
    n1x: number, n1z: number,  // normal at start
    n2x: number, n2z: number,  // normal at end
    r: number  // corner radius (used to determine if corner is rounded)
  ) => {
    // If no corner radius, just add a simple corner fillet at the vertex
    if (r < 0.01) {
      // Sharp corner - compute angle sweep from n1 to n2
      const startAngle = Math.atan2(n1z, n1x);
      const endAngle = Math.atan2(n2z, n2x);
      let angleDiff = endAngle - startAngle;
      
      if (isCW) {
        if (angleDiff > 0) angleDiff -= 2 * Math.PI;
      } else {
        if (angleDiff < 0) angleDiff += 2 * Math.PI;
      }
      
      if (Math.abs(angleDiff) < 0.01 || Math.abs(angleDiff) > 2 * Math.PI - 0.01) return;
      
      const baseIdx = positions.length / 3;
      const cornerSegs = Math.max(4, Math.ceil(Math.abs(angleDiff) / (Math.PI / 8)));
      
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const filletAngle = Math.PI + t * (Math.PI / 2);
        const outDist = filletRadius + filletRadius * Math.cos(filletAngle);
        const y = filletRadius * Math.sin(filletAngle) + filletRadius;
        
        for (let j = 0; j <= cornerSegs; j++) {
          const theta = startAngle + (j / cornerSegs) * angleDiff;
          positions.push(vx + outDist * Math.cos(theta), y, vz + outDist * Math.sin(theta));
        }
      }
      
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < cornerSegs; j++) {
          const a = baseIdx + i * (cornerSegs + 1) + j;
          const b = a + cornerSegs + 1;
          const c = a + 1;
          const d = b + 1;
          // Use (a,b,c) and (c,b,d) winding for polygon fillets (opposite to cylindrical)
          indices.push(a, b, c);
          indices.push(c, b, d);
        }
      }
      return;
    }
    
    // Rounded corner - follow the quadratic Bezier path
    // Bezier: B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
    // P0 = insetStart, P1 = vertex (control), P2 = insetEnd
    const baseIdx = positions.length / 3;
    const cornerSegs = 8;  // segments along the Bezier
    
    for (let i = 0; i <= segments; i++) {
      const filletT = i / segments;
      const filletAngle = Math.PI + filletT * (Math.PI / 2);
      const outDist = filletRadius + filletRadius * Math.cos(filletAngle);
      const y = filletRadius * Math.sin(filletAngle) + filletRadius;
      
      for (let j = 0; j <= cornerSegs; j++) {
        const t = j / cornerSegs;
        const omt = 1 - t;
        
        // Bezier point
        const bx = omt * omt * insetStartX + 2 * omt * t * vx + t * t * insetEndX;
        const bz = omt * omt * insetStartZ + 2 * omt * t * vz + t * t * insetEndZ;
        
        // Bezier tangent (derivative)
        const tx = 2 * omt * (vx - insetStartX) + 2 * t * (insetEndX - vx);
        const tz = 2 * omt * (vz - insetStartZ) + 2 * t * (insetEndZ - vz);
        const tLen = Math.sqrt(tx * tx + tz * tz);
        
        // Outward normal (perpendicular to tangent)
        // The Bezier curves inward toward the vertex (control point), so the outward
        // normal for the fillet is on the opposite side of what the curve direction suggests
        // We need to flip the normal direction from what the winding would suggest
        let nx: number, nz: number;
        if (tLen > 0.001) {
          if (isCW) {
            // For CW winding, flip to get outward normal for the fillet
            nx = -tz / tLen;
            nz = tx / tLen;
          } else {
            // For CCW winding, flip to get outward normal for the fillet
            nx = tz / tLen;
            nz = -tx / tLen;
          }
        } else {
          // Fallback: interpolate between start and end normals
          nx = n1x * (1 - t) + n2x * t;
          nz = n1z * (1 - t) + n2z * t;
          const nLen = Math.sqrt(nx * nx + nz * nz);
          if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
        }
        
        // Position = Bezier point + outward normal * outDist
        positions.push(bx + nx * outDist, y, bz + nz * outDist);
      }
    }
    
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < cornerSegs; j++) {
        const a = baseIdx + i * (cornerSegs + 1) + j;
        const b = a + cornerSegs + 1;
        const c = a + 1;
        const d = b + 1;
        // Use (a,b,c) and (c,b,d) winding for polygon fillets (opposite to cylindrical)
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }
  };
  
  // Process each edge and corner using mirrored polygon
  const n = workingPolygon.length;
  const edgeNormals: [number, number][] = [];
  
  // Compute all edge normals first
  for (let i = 0; i < n; i++) {
    const p1 = workingPolygon[i];
    const p2 = workingPolygon[(i + 1) % n];
    edgeNormals.push(getEdgeNormal(p1, p2));
  }
  
  // Compute corner inset positions for rounded corners
  const cornerData: { vx: number, vz: number, cx: number, cz: number, insetStart: [number, number], insetEnd: [number, number], r: number }[] = [];
  
  for (let i = 0; i < n; i++) {
    const prev = workingPolygon[(i - 1 + n) % n];
    const curr = workingPolygon[i];
    const next = workingPolygon[(i + 1) % n];
    
    const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
    const toNext = [next[0] - curr[0], next[1] - curr[1]];
    const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
    const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);
    
    if (lenPrev < 0.01 || lenNext < 0.01) {
      cornerData.push({ vx: curr[0], vz: curr[1], cx: curr[0], cz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
      continue;
    }
    
    const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
    const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
    
    // Always apply corner radius for simple convex shapes
    const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
    
    if (r > 0.01) {
      // Calculate inset points
      const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
      const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
      
      // Calculate arc center - offset inward along the angle bisector
      // The bisector direction is the normalized sum of the two inward directions
      const bisectorX = dirPrev[0] + dirNext[0];
      const bisectorZ = dirPrev[1] + dirNext[1];
      const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorZ * bisectorZ);
      
      // Distance from vertex to arc center along bisector
      // For a 90-degree corner: distance = r / sin(45°) = r * sqrt(2)
      // General formula: distance = r / sin(angle/2)
      const halfAngle = Math.acos(Math.max(-1, Math.min(1, -(dirPrev[0] * dirNext[0] + dirPrev[1] * dirNext[1])))) / 2;
      const distToCenter = halfAngle > 0.01 ? r / Math.sin(halfAngle) : r;
      
      let cx = curr[0];
      let cz = curr[1];
      if (bisectorLen > 0.01) {
        cx = curr[0] + (bisectorX / bisectorLen) * distToCenter;
        cz = curr[1] + (bisectorZ / bisectorLen) * distToCenter;
      }
      
      cornerData.push({ vx: curr[0], vz: curr[1], cx, cz, insetStart, insetEnd, r });
    } else {
      cornerData.push({ vx: curr[0], vz: curr[1], cx: curr[0], cz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
    }
  }
  
  // Now add edge fillets (between inset points) and corner fillets
  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];
    
    // Edge goes from currCorner.insetEnd to nextCorner.insetStart
    const edgeStart = currCorner.insetEnd;
    const edgeEnd = nextCorner.insetStart;
    
    addEdgeFillet(edgeStart[0], edgeStart[1], edgeEnd[0], edgeEnd[1], normal[0], normal[1]);
    
    // Add corner fillet at nextCorner
    // The corner fillet follows the quadratic Bezier from insetStart through vertex to insetEnd
    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];
    
    addCornerFillet(
      nextCorner.vx, nextCorner.vz,  // vertex (Bezier control point)
      nextCorner.insetStart[0], nextCorner.insetStart[1],  // Bezier start (from incoming edge)
      nextCorner.insetEnd[0], nextCorner.insetEnd[1],  // Bezier end (to outgoing edge)
      prevNormal[0], prevNormal[1],  // normal at start
      nextNormal[0], nextNormal[1],  // normal at end
      nextCorner.r  // corner radius
    );
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
};

// Create a fillet for rectangular supports
const createRectangularFilletGeometry = (width: number, depthVal: number, cornerRadius: number = 0, filletRadius: number = FILLET_RADIUS, segments: number = FILLET_SEGMENTS): THREE.BufferGeometry => {
  const hw = width / 2;
  const hd = depthVal / 2;
  const r = Math.max(0, Math.min(cornerRadius, hw - 0.01, hd - 0.01));
  
  const positions: number[] = [];
  const indices: number[] = [];
  
  // Helper to add a fillet strip along a straight edge
  // The fillet curves from the baseplate (y=0) up to the wall (y=filletRadius)
  const addFilletStrip = (x1: number, z1: number, x2: number, z2: number, outwardX: number, outwardZ: number) => {
    const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    if (length < 0.01) return;
    const stripSegments = Math.max(2, Math.ceil(length / 5));
    
    const baseIdx = positions.length / 3;
    
    // i=0: at baseplate outer edge (outDist=filletRadius, y=0)
    // i=segments: at the wall (outDist=0, y=filletRadius)
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = Math.PI + t * (Math.PI / 2); // from 180 to 270 degrees
      const outDist = filletRadius + filletRadius * Math.cos(angle); // filletRadius to 0
      const y = filletRadius * Math.sin(angle) + filletRadius; // 0 to filletRadius
      
      for (let j = 0; j <= stripSegments; j++) {
        const s = j / stripSegments;
        const px = x1 + s * (x2 - x1) + outwardX * outDist;
        const pz = z1 + s * (z2 - z1) + outwardZ * outDist;
        
        positions.push(px, y, pz);
      }
    }
    
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < stripSegments; j++) {
        const a = baseIdx + i * (stripSegments + 1) + j;
        const b = a + stripSegments + 1;
        const c = a + 1;
        const d = b + 1;
        
        // Use (a,c,b) and (c,d,b) winding for outward normals
        indices.push(a, c, b);
        indices.push(c, d, b);
      }
    }
  };
  
  // Helper to add a quarter-torus corner fillet
  const addCornerFillet = (cx: number, cz: number, startAngle: number) => {
    const cornerR = Math.max(r, 0.01);
    const baseIdx = positions.length / 3;
    const cornerSegs = 8;
    
    // i=0: at baseplate outer edge (outDist=cornerR+filletRadius, y=0)
    // i=segments: at the corner wall (outDist=cornerR, y=filletRadius)
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const filletAngle = Math.PI + t * (Math.PI / 2); // 180 to 270 degrees
      const outDist = cornerR + filletRadius + filletRadius * Math.cos(filletAngle); // cornerR+filletRadius to cornerR
      const y = filletRadius * Math.sin(filletAngle) + filletRadius; // 0 to filletRadius
      
      for (let j = 0; j <= cornerSegs; j++) {
        const theta = startAngle + (j / cornerSegs) * (Math.PI / 2);
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        
        positions.push(cx + outDist * cosT, y, cz + outDist * sinT);
      }
    }
    
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < cornerSegs; j++) {
        const a = baseIdx + i * (cornerSegs + 1) + j;
        const b = a + cornerSegs + 1;
        const c = a + 1;
        const d = b + 1;
        
        // Use (a,c,b) and (c,d,b) winding for outward normals
        indices.push(a, c, b);
        indices.push(c, d, b);
      }
    }
  };
  
  // Add the four edge fillets
  addFilletStrip(-hw + r, -hd, hw - r, -hd, 0, -1);
  addFilletStrip(hw - r, hd, -hw + r, hd, 0, 1);
  addFilletStrip(-hw, hd - r, -hw, -hd + r, -1, 0);
  addFilletStrip(hw, -hd + r, hw, hd - r, 1, 0);
  
  // Add the four corner fillets
  addCornerFillet(hw - r, -hd + r, -Math.PI / 2);
  addCornerFillet(hw - r, hd - r, 0);
  addCornerFillet(-hw + r, hd - r, Math.PI / 2);
  addCornerFillet(-hw + r, -hd + r, Math.PI);
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
};

/**
 * Create a bottom cap geometry for sealing supports during CSG operations.
 * The cap is a flat disc/shape at y=0 that matches the fillet's outer footprint.
 */
const createBottomCapGeometry = (
  type: string, 
  support: any, 
  filletRadius: number
): THREE.BufferGeometry | null => {
  if (type === 'cylindrical') {
    const { radius } = support;
    // Outer radius = support radius + fillet radius (where fillet touches baseplate)
    const outerRadius = radius + filletRadius;
    const cap = new THREE.CircleGeometry(outerRadius, 64);
    // CircleGeometry starts in XY plane with normal +Z
    // rotateX(+PI/2) rotates normal from +Z to -Y (facing downward)
    cap.rotateX(Math.PI / 2);
    return cap;
  } else if (type === 'rectangular') {
    const { width, depth, cornerRadius = 0 } = support;
    // Add fillet radius to dimensions
    const capWidth = width + filletRadius * 2;
    const capDepth = depth + filletRadius * 2;
    const capCornerRadius = cornerRadius + filletRadius;
    
    if (capCornerRadius <= 0.01) {
      const cap = new THREE.PlaneGeometry(capWidth, capDepth);
      // PlaneGeometry starts in XY plane with normal +Z
      // rotateX(+PI/2) rotates normal from +Z to -Y (facing downward)
      cap.rotateX(Math.PI / 2);
      return cap;
    } else {
      // Create rounded rectangle cap
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
      // ShapeGeometry is in XY plane with normal +Z
      // rotateX(+PI/2) rotates normal from +Z to -Y (facing downward)
      cap.rotateX(Math.PI / 2);
      return cap;
    }
  } else if (type === 'conical') {
    const { baseRadius } = support;
    // For conical, outer radius at base = baseRadius + filletRadius
    const outerRadius = baseRadius + filletRadius;
    const cap = new THREE.CircleGeometry(outerRadius, 64);
    // CircleGeometry starts in XY plane with normal +Z
    // rotateX(+PI/2) rotates normal from +Z to -Y (facing downward)
    cap.rotateX(Math.PI / 2);
    return cap;
  } else if (type === 'custom') {
    const { polygon, cornerRadius = 0 } = support;
    if (!polygon || polygon.length < 3) return null;
    
    // The fillet geometry uses reverse() on the polygon to match the body's effective winding.
    // The bottom cap must use the same transformation to match the fillet's outer perimeter.
    const workingPolygon: [number, number][] = [...polygon].reverse();
    
    // Determine winding for outward offset direction (same logic as fillet)
    let signedArea = 0;
    for (let i = 0; i < workingPolygon.length; i++) {
      const [x1, z1] = workingPolygon[i];
      const [x2, z2] = workingPolygon[(i + 1) % workingPolygon.length];
      signedArea += (x2 - x1) * (z2 + z1);
    }
    const isCW = signedArea > 0;
    
    // Compute edge normals (same as fillet)
    const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
      const dx = p2[0] - p1[0];
      const dz = p2[1] - p1[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) return [0, 0];
      if (isCW) {
        return [-dz / len, dx / len];
      } else {
        return [dz / len, -dx / len];
      }
    };
    
    const n = workingPolygon.length;
    const edgeNormals: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const p1 = workingPolygon[i];
      const p2 = workingPolygon[(i + 1) % n];
      edgeNormals.push(getEdgeNormal(p1, p2));
    }
    
    // Compute corner data (same as fillet geometry)
    const cornerData: { vx: number, vz: number, cx: number, cz: number, insetStart: [number, number], insetEnd: [number, number], r: number }[] = [];
    
    for (let i = 0; i < n; i++) {
      const prev = workingPolygon[(i - 1 + n) % n];
      const curr = workingPolygon[i];
      const next = workingPolygon[(i + 1) % n];
      
      const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
      const toNext = [next[0] - curr[0], next[1] - curr[1]];
      const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
      const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);
      
      if (lenPrev < 0.01 || lenNext < 0.01) {
        cornerData.push({ vx: curr[0], vz: curr[1], cx: curr[0], cz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
        continue;
      }
      
      const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
      const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
      
      const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
      
      if (r > 0.01) {
        const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
        const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
        
        const bisectorX = dirPrev[0] + dirNext[0];
        const bisectorZ = dirPrev[1] + dirNext[1];
        const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorZ * bisectorZ);
        
        const halfAngle = Math.acos(Math.max(-1, Math.min(1, -(dirPrev[0] * dirNext[0] + dirPrev[1] * dirNext[1])))) / 2;
        const distToCenter = halfAngle > 0.01 ? r / Math.sin(halfAngle) : r;
        
        let cx = curr[0];
        let cz = curr[1];
        if (bisectorLen > 0.01) {
          cx = curr[0] + (bisectorX / bisectorLen) * distToCenter;
          cz = curr[1] + (bisectorZ / bisectorLen) * distToCenter;
        }
        
        cornerData.push({ vx: curr[0], vz: curr[1], cx, cz, insetStart, insetEnd, r });
      } else {
        cornerData.push({ vx: curr[0], vz: curr[1], cx: curr[0], cz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
      }
    }
    
    // Build the outer perimeter of the cap at Y=0
    // This matches the fillet's outer edge (at the bottom where y=0)
    // For each edge: offset the edge outward by filletRadius
    // For each corner: if r=0, add arc sweep; if r>0, add offset Bezier arc
    const perimeterPoints: [number, number][] = [];
    const cornerSegs = 8;
    
    for (let i = 0; i < n; i++) {
      const currCorner = cornerData[i];
      const nextCorner = cornerData[(i + 1) % n];
      const normal = edgeNormals[i];
      
      // Edge from currCorner.insetEnd to nextCorner.insetStart, offset by filletRadius
      const edgeStartX = currCorner.insetEnd[0] + normal[0] * filletRadius;
      const edgeStartZ = currCorner.insetEnd[1] + normal[1] * filletRadius;
      const edgeEndX = nextCorner.insetStart[0] + normal[0] * filletRadius;
      const edgeEndZ = nextCorner.insetStart[1] + normal[1] * filletRadius;
      
      // Add edge start point
      perimeterPoints.push([edgeStartX, edgeStartZ]);
      // Add edge end point (corner will add its arc starting from here)
      perimeterPoints.push([edgeEndX, edgeEndZ]);
      
      // Add corner arc at nextCorner
      const prevNormal = edgeNormals[i];
      const nextNormal = edgeNormals[(i + 1) % n];
      
      if (nextCorner.r < 0.01) {
        // Sharp corner - add arc sweep from prevNormal direction to nextNormal direction
        const startAngle = Math.atan2(prevNormal[1], prevNormal[0]);
        const endAngle = Math.atan2(nextNormal[1], nextNormal[0]);
        let angleDiff = endAngle - startAngle;
        
        if (isCW) {
          if (angleDiff > 0) angleDiff -= 2 * Math.PI;
        } else {
          if (angleDiff < 0) angleDiff += 2 * Math.PI;
        }
        
        if (Math.abs(angleDiff) > 0.01 && Math.abs(angleDiff) < 2 * Math.PI - 0.01) {
          for (let j = 1; j < cornerSegs; j++) {
            const t = j / cornerSegs;
            const theta = startAngle + t * angleDiff;
            perimeterPoints.push([
              nextCorner.vx + filletRadius * Math.cos(theta),
              nextCorner.vz + filletRadius * Math.sin(theta)
            ]);
          }
        }
      } else {
        // Rounded corner - follow offset Bezier curve
        for (let j = 1; j < cornerSegs; j++) {
          const t = j / cornerSegs;
          const omt = 1 - t;
          
          // Bezier point (same as fillet)
          const bx = omt * omt * nextCorner.insetStart[0] + 2 * omt * t * nextCorner.vx + t * t * nextCorner.insetEnd[0];
          const bz = omt * omt * nextCorner.insetStart[1] + 2 * omt * t * nextCorner.vz + t * t * nextCorner.insetEnd[1];
          
          // Bezier tangent
          const tx = 2 * omt * (nextCorner.vx - nextCorner.insetStart[0]) + 2 * t * (nextCorner.insetEnd[0] - nextCorner.vx);
          const tz = 2 * omt * (nextCorner.vz - nextCorner.insetStart[1]) + 2 * t * (nextCorner.insetEnd[1] - nextCorner.vz);
          const tLen = Math.sqrt(tx * tx + tz * tz);
          
          let nx: number, nz: number;
          if (tLen > 0.001) {
            if (isCW) {
              nx = -tz / tLen;
              nz = tx / tLen;
            } else {
              nx = tz / tLen;
              nz = -tx / tLen;
            }
          } else {
            nx = prevNormal[0] * (1 - t) + nextNormal[0] * t;
            nz = prevNormal[1] * (1 - t) + nextNormal[1] * t;
            const nLen = Math.sqrt(nx * nx + nz * nz);
            if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
          }
          
          perimeterPoints.push([bx + nx * filletRadius, bz + nz * filletRadius]);
        }
      }
    }
    
    // Create triangulated cap using fan triangulation from centroid
    const positions: number[] = [];
    const indices: number[] = [];
    
    // Calculate centroid
    let centroidX = 0, centroidZ = 0;
    for (const [x, z] of perimeterPoints) {
      centroidX += x;
      centroidZ += z;
    }
    centroidX /= perimeterPoints.length;
    centroidZ /= perimeterPoints.length;
    
    // Add center vertex at Y=0 (bottom of fillet)
    positions.push(centroidX, 0, centroidZ);
    
    // Add perimeter vertices
    for (const [x, z] of perimeterPoints) {
      positions.push(x, 0, z);
    }
    
    // Fan triangulation - normal should point downward (-Y)
    // The custom polygon fillet uses opposite winding to other fillets (due to reverse()),
    // so the cap also needs opposite winding to match.
    // Use (0, next+1, i+1) instead of (0, i+1, next+1) to flip the normal direction.
    for (let i = 0; i < perimeterPoints.length; i++) {
      const next = (i + 1) % perimeterPoints.length;
      // Center is at index 0, vertices start at index 1
      // Reversed winding for downward normal matching the fillet's winding convention
      indices.push(0, next + 1, i + 1);
    }
    
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    cap.setIndex(indices);
    cap.computeVertexNormals();
    return cap;
  }
  
  return null;
};

/**
 * Create a top cap geometry for sealing supports during CSG operations.
 * The cap matches the body's cross-section at the top of the support.
 * @param type Support type
 * @param support Support configuration
 * @param height Total support height
 * @param filletRadius Fillet radius used
 * @returns BufferGeometry positioned at the top of the support, or null
 */
const createTopCapGeometry = (
  type: string, 
  support: any, 
  height: number,
  filletRadius: number
): THREE.BufferGeometry | null => {
  const topY = height; // Cap is at the top of the support
  
  if (type === 'cylindrical') {
    const { radius } = support;
    const cap = new THREE.CircleGeometry(radius, 64);
    // CircleGeometry starts in XY plane with normal +Z
    // rotateX(-PI/2) rotates normal from +Z to +Y (facing upward)
    cap.rotateX(-Math.PI / 2);
    cap.translate(0, topY, 0);
    return cap;
  } else if (type === 'rectangular') {
    const { width, depth, cornerRadius = 0 } = support;
    
    if (cornerRadius <= 0.01) {
      const cap = new THREE.PlaneGeometry(width, depth);
      cap.rotateX(-Math.PI / 2); // Face upward
      cap.translate(0, topY, 0);
      return cap;
    } else {
      const hw = width / 2;
      const hd = depth / 2;
      const r = Math.min(cornerRadius, hw, hd);
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
      cap.rotateX(-Math.PI / 2); // Face upward
      cap.translate(0, topY, 0);
      return cap;
    }
  } else if (type === 'conical') {
    const { topRadius } = support;
    const cap = new THREE.CircleGeometry(topRadius, 64);
    cap.rotateX(-Math.PI / 2); // Face upward
    cap.translate(0, topY, 0);
    return cap;
  } else if (type === 'custom') {
    const { polygon, cornerRadius = 0 } = support;
    if (!polygon || polygon.length < 3) return null;
    
    // Mirror Y to match the body geometry
    const workingPolygon: [number, number][] = polygon.map(([x, y]: [number, number]) => [x, -y]);
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
        if (!started) { shape.moveTo(curr[0], curr[1]); started = true; }
        else { shape.lineTo(curr[0], curr[1]); }
        continue;
      }
      
      const r = Math.min(safeCornerRadius, lenPrev / 2, lenNext / 2);
      const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
      const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
      
      if (r > 0.01) {
        const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
        const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
        
        if (!started) { shape.moveTo(insetStart[0], insetStart[1]); started = true; }
        else { shape.lineTo(insetStart[0], insetStart[1]); }
        shape.quadraticCurveTo(curr[0], curr[1], insetEnd[0], insetEnd[1]);
      } else {
        if (!started) { shape.moveTo(curr[0], curr[1]); started = true; }
        else { shape.lineTo(curr[0], curr[1]); }
      }
    }
    shape.closePath();
    
    const cap = new THREE.ShapeGeometry(shape, 32);
    cap.rotateX(-Math.PI / 2); // Face upward
    cap.translate(0, topY, 0);
    return cap;
  }
  
  return null;
};

/**
 * Remove the bottom cap faces from an ExtrudeGeometry.
 * ExtrudeGeometry creates both top and bottom caps which cause internal faces
 * when merged with fillet geometry. This function removes faces at the bottom.
 * @param geometry The ExtrudeGeometry (must be non-indexed or will be converted)
 * @param bottomY The Y coordinate of the bottom cap to remove
 * @param tolerance Tolerance for Y comparison
 */
const removeBottomCapFaces = (geometry: THREE.BufferGeometry, bottomY: number, tolerance: number = 0.01): THREE.BufferGeometry => {
  // Convert to non-indexed if necessary
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = nonIndexed.getAttribute('position');
  const normals = nonIndexed.getAttribute('normal');
  
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  
  // Process triangles (3 vertices each)
  for (let i = 0; i < positions.count; i += 3) {
    const y1 = positions.getY(i);
    const y2 = positions.getY(i + 1);
    const y3 = positions.getY(i + 2);
    
    // Check if all three vertices are at the bottom Y (within tolerance)
    const isBottomFace = 
      Math.abs(y1 - bottomY) < tolerance &&
      Math.abs(y2 - bottomY) < tolerance &&
      Math.abs(y3 - bottomY) < tolerance;
    
    // Also check if the face normal points downward (bottom cap faces point -Y)
    // This helps distinguish cap faces from vertical wall faces that happen to be at bottomY
    let isDownwardFacing = false;
    if (normals) {
      const ny1 = normals.getY(i);
      const ny2 = normals.getY(i + 1);
      const ny3 = normals.getY(i + 2);
      // Average normal Y component - bottom caps should have normal pointing -Y
      const avgNy = (ny1 + ny2 + ny3) / 3;
      isDownwardFacing = avgNy < -0.9; // Strong downward normal
    }
    
    // Skip this triangle if it's a bottom cap face
    if (isBottomFace && isDownwardFacing) {
      continue;
    }
    
    // Keep this triangle
    for (let j = 0; j < 3; j++) {
      newPositions.push(
        positions.getX(i + j),
        positions.getY(i + j),
        positions.getZ(i + j)
      );
      if (normals) {
        newNormals.push(
          normals.getX(i + j),
          normals.getY(i + j),
          normals.getZ(i + j)
        );
      }
    }
  }
  
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  if (newNormals.length > 0) {
    result.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
  }
  
  return result;
};

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
    
    filletGeo = createPolygonFilletGeometry(polygon, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS);
    
    // Build the custom shape for the body
    // Mirror the Y coordinates to match the rotation direction (same as SupportMesh component)
    const workingPolygon: [number, number][] = polygon.map(([x, y]: [number, number]) => [x, -y]);
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
      // Double-click detected
      onDoubleClick?.(support.id);
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

export default SupportMesh;
