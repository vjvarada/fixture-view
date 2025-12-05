import React from 'react';
import * as THREE from 'three';
import { AnySupport } from './types';

interface SupportMeshProps {
  support: AnySupport;
  preview?: boolean;
  baseTopY?: number;
}

// Use a non-metallic matte material for supports
const materialFor = (preview?: boolean) =>
  new THREE.MeshStandardMaterial({
    color: preview ? 0x3b82f6 : 0x888888,
    transparent: !!preview,
    opacity: preview ? 0.5 : 1,
    metalness: 0.0,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });

// Fillet parameters
const FILLET_RADIUS = 2.0; // mm - radius of the fillet curve
const FILLET_SEGMENTS = 12; // number of segments for smooth fillet

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
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      const c = a + 1;
      const d = b + 1;
      
      indices.push(a, b, c);
      indices.push(c, b, d);
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
  
  // The polygon coordinates are [x, z] in world space.
  // The support body mirrors Y for the shape then rotates, ending up with world (x, height, z).
  // That mirroring also reverses the winding order.
  // The fillet builds directly in world XZ space, so we need to reverse the polygon order
  // to match the winding of the support body (so outward normals point the same way).
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
      let endAngle = Math.atan2(n2z, n2x);
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
        
        indices.push(a, b, c);
        indices.push(c, b, d);
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
        
        indices.push(a, b, c);
        indices.push(c, b, d);
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

const SupportMesh: React.FC<SupportMeshProps> = ({ support, preview, baseTopY = 0 }) => {
  const { type, height, center } = support as any;
  const rotY = (support as any).rotationZ ?? 0;
  const effectiveBaseY = (support as any).baseY ?? baseTopY;
  
  // Clamp fillet radius to not exceed support height (leave at least 0.1mm for body)
  const effectiveFilletRadius = Math.min(FILLET_RADIUS, Math.max(0, height - 0.1));
  
  // The main body starts at fillet height and goes up
  const bodyHeight = Math.max(0.1, height - effectiveFilletRadius);
  const bodyCenter = effectiveBaseY + effectiveFilletRadius + bodyHeight / 2;

  const handleSelect = () => {
    if (preview) return;
    window.dispatchEvent(new CustomEvent('support-edit', { detail: support }));
  };

  const mat = React.useMemo(() => materialFor(preview), [preview]);

  if (type === 'cylindrical') {
    const { radius } = support as any;
    const geo = React.useMemo(() => new THREE.CylinderGeometry(radius, radius, bodyHeight, 64), [radius, bodyHeight]);
    const filletGeo = React.useMemo(() => createCylindricalFilletGeometry(radius, effectiveFilletRadius, FILLET_SEGMENTS), [radius, effectiveFilletRadius]);
    
    return (
      <group onClick={handleSelect}>
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} material={mat} />
        <group position={[center.x, bodyCenter, center.y]}>
          <mesh geometry={geo} material={mat} />
          <lineSegments renderOrder={2}>
            <edgesGeometry args={[geo, 70]} />
            <lineBasicMaterial color={0x9ca3af} depthTest={false} depthWrite={false} />
          </lineSegments>
        </group>
      </group>
    );
  }

  if (type === 'rectangular') {
    const { width, depth, cornerRadius = 0 } = support as any;
    const filletGeo = React.useMemo(() => createRectangularFilletGeometry(width, depth, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS), [width, depth, cornerRadius, effectiveFilletRadius]);
    
    if (cornerRadius <= 0) {
      const geo = React.useMemo(() => new THREE.BoxGeometry(width, bodyHeight, depth), [width, bodyHeight, depth]);
      return (
        <group onClick={handleSelect}>
          <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
          <group position={[center.x, bodyCenter, center.y]} rotation={[0, rotY, 0]}>
            <mesh geometry={geo} material={mat} />
            <lineSegments renderOrder={2}>
              <edgesGeometry args={[geo]} />
              <lineBasicMaterial color={0x9ca3af} depthTest={false} depthWrite={false} />
            </lineSegments>
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
      return e;
    }, [width, depth, cornerRadius, bodyHeight]);
    
    return (
      <group onClick={handleSelect}>
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} rotation={[0, rotY, 0]} material={mat} />
        <group position={[center.x, effectiveBaseY + effectiveFilletRadius, center.y]} rotation={[0, rotY, 0]}>
          <mesh geometry={rrGeo} material={mat} />
          <lineSegments renderOrder={2}>
            <edgesGeometry args={[rrGeo, 45]} />
            <lineBasicMaterial color={0x9ca3af} depthTest={false} depthWrite={false} />
          </lineSegments>
        </group>
      </group>
    );
  }

  if (type === 'conical') {
    const { baseRadius, topRadius } = support as any;
    const geo = React.useMemo(() => new THREE.CylinderGeometry(topRadius, baseRadius, bodyHeight, 64), [topRadius, baseRadius, bodyHeight]);
    const filletGeo = React.useMemo(() => createCylindricalFilletGeometry(baseRadius, effectiveFilletRadius, FILLET_SEGMENTS), [baseRadius, effectiveFilletRadius]);
    
    return (
      <group onClick={handleSelect}>
        <mesh geometry={filletGeo} position={[center.x, effectiveBaseY, center.y]} material={mat} />
        <group position={[center.x, bodyCenter, center.y]}>
          <mesh geometry={geo} material={mat} />
          <lineSegments renderOrder={2}>
            <edgesGeometry args={[geo, 70]} />
            <lineBasicMaterial color={0x9ca3af} depthTest={false} depthWrite={false} />
          </lineSegments>
        </group>
      </group>
    );
  }

  if (type === 'custom') {
    const { polygon, cornerRadius = 0 } = support as any;
    console.log('Custom support rendering with cornerRadius:', cornerRadius);
    const filletGeo = React.useMemo(() => createPolygonFilletGeometry(polygon, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS), [JSON.stringify(polygon), cornerRadius, effectiveFilletRadius]);
    const geo = React.useMemo(() => {
      const shape = new THREE.Shape();
      const n = polygon.length;
      
      if (n < 3) {
        return new THREE.BufferGeometry();
      }
      
      // Mirror the Y coordinates to match the rotation direction
      const workingPolygon: [number, number][] = polygon.map(([x, y]: [number, number]) => [x, -y]);
      
      if (cornerRadius <= 0) {
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
          
          // Always try to apply corner radius (for simple convex shapes)
          const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
          
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
      return e;
    }, [JSON.stringify(polygon), cornerRadius, bodyHeight]);
    
    return (
      <group onClick={handleSelect}>
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
