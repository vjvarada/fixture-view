import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import type { BasePlateProps } from './BasePlate/types';

const finalizeGeometry = (geometry: THREE.BufferGeometry) => {
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  if (typeof (geometry as any).computeBoundsTree === 'function') {
    (geometry as any).computeBoundsTree();
  }
  return geometry;
};

// Create a rounded rectangle shape
const createRoundedRectShape = (width: number, height: number, cornerRadiusFactor: number = 0.08): THREE.Shape => {
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
  
  return shape;
};

// Create an extruded geometry with 45-degree chamfers, rotated for Y-up baseplate
const createExtrudedBaseplate = (shape: THREE.Shape, depth: number, chamferSizeFactor: number = 0.15): THREE.BufferGeometry => {
  // For a 45-degree chamfer, bevelThickness must equal bevelSize
  const chamferSize = Math.min(1.0, depth * chamferSizeFactor);
  const extrudeDepth = Math.max(0.1, depth - 2 * chamferSize);
  
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: true,
    bevelThickness: chamferSize, // vertical distance
    bevelSize: chamferSize,       // horizontal distance - equal for 45 degrees
    bevelSegments: 1,             // single segment = flat chamfer, not rounded fillet
  });
  
  // Rotate to Y-up and translate so bottom sits at Y=0
  g.rotateX(-Math.PI / 2);
  g.translate(0, chamferSize, 0);
  
  return finalizeGeometry(g);
};

// Create a shape with rounded corners from a polygon (convex hull)
// Points should be in XY plane format (x, y) corresponding to (worldX, -worldZ)
// Uses quadratic Bezier curves for robust corner rounding
const createRoundedPolygonShape = (
  points: Array<{ x: number; y: number }>, 
  cornerRadius: number
): THREE.Shape => {
  const shape = new THREE.Shape();
  const n = points.length;
  
  if (cornerRadius <= 0 || n < 3) {
    // No rounding - just create the polygon
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < n; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();
    return shape;
  }

  // For each corner, compute the offset points where we'll start/end the curve
  const getCornerPoints = (
    prev: { x: number; y: number },
    curr: { x: number; y: number },
    next: { x: number; y: number },
    radius: number
  ) => {
    // Vectors from corner to adjacent points
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    
    if (len1 < 0.001 || len2 < 0.001) {
      return { start: curr, end: curr, control: curr, valid: false };
    }
    
    // Limit offset to not exceed half of either edge length
    const maxOffset = Math.min(len1, len2) * 0.45;
    const offset = Math.min(radius, maxOffset);
    
    // Normalized direction vectors
    const u1x = v1x / len1;
    const u1y = v1y / len1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;
    
    // Points offset from corner along each edge
    const start = {
      x: curr.x + u1x * offset,
      y: curr.y + u1y * offset
    };
    const end = {
      x: curr.x + u2x * offset,
      y: curr.y + u2y * offset
    };
    
    // Control point is the original corner
    return { start, end, control: curr, valid: offset > 0.01 };
  };

  // Compute all corner data
  const cornerData: Array<ReturnType<typeof getCornerPoints>> = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    cornerData.push(getCornerPoints(prev, curr, next, cornerRadius));
  }

  // Build the path
  // Start at the end point of first corner's curve (where edge 0->1 begins)
  const firstCorner = cornerData[0];
  shape.moveTo(firstCorner.end.x, firstCorner.end.y);

  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const nextCorner = cornerData[nextIdx];
    
    // Line from current position to the start of the next corner's curve
    shape.lineTo(nextCorner.start.x, nextCorner.start.y);
    
    // Quadratic curve around the corner
    if (nextCorner.valid) {
      shape.quadraticCurveTo(
        nextCorner.control.x, nextCorner.control.y,
        nextCorner.end.x, nextCorner.end.y
      );
    }
  }

  shape.closePath();
  return shape;
};

const BasePlate: React.FC<BasePlateProps> = ({
  type,
  width = 100,
  height = 100,
  depth = 10,
  radius = 50,
  position = new THREE.Vector3(0, 0, 0),
  material = 'metal',
  onSelect,
  selected = false,
  modelGeometry,
  modelMatrixWorld,
  modelGeometries = [], // Support for multiple geometries
  modelOrigin,
  oversizeXY = 10,
  pitch = 20,
  holeDiameter = 6,
  onPointerDown, onPointerMove, onPointerUp,
  meshRef: externalMeshRef,
  additionalHullPoints = [],
  livePositionDelta = null,
  cornerRadius = 0,
}) => {
  const internalMeshRef = useRef<THREE.Mesh>(null);
  const meshRef = externalMeshRef || internalMeshRef;
  const groupRef = useRef<THREE.Group>(null);

  // Material properties based on type (with transparency for perforated panels)
  const materialProps = useMemo(() => {
    let base: any;
    switch (material) {
      case 'metal':
        base = {
          color: selected ? 0x0066cc : 0x888888,
          metalness: 0.0,
          roughness: 0.7,
        };
        break;
      case 'wood':
        base = {
          color: selected ? 0xcc6600 : 0x8B4513,
          metalness: 0.1,
          roughness: 0.8
        };
        break;
      case 'plastic':
        base = {
          color: selected ? 0x66cc00 : 0x333333,
          metalness: 0.0,
          roughness: 0.3
        };
        break;
      default:
        base = {
          color: 0x888888,
          metalness: 0.0,
          roughness: 0.7
        };
    }
    if (type === 'perforated-panel') {
      base = {
        ...base,
        transparent: true,
        opacity: 0.35,
      };
    }
    return base;
  }, [material, selected, type]);

  // Create geometry based on type
  const geometry = useMemo(() => {
    switch (type) {
      case 'convex-hull':
        // Sample model geometry and optionally apply live position delta
        // Support both single geometry (backward compatibility) and multiple geometries
        const geometriesToProcess: Array<{geometry: THREE.BufferGeometry, matrixWorld?: THREE.Matrix4}> = [];
        
        // Add single geometry if provided (backward compatibility)
        if (modelGeometry && modelGeometry.attributes && modelGeometry.attributes.position) {
          geometriesToProcess.push({ geometry: modelGeometry, matrixWorld: modelMatrixWorld });
        }
        
        // Add multiple geometries if provided
        if (modelGeometries && modelGeometries.length > 0) {
          for (const geo of modelGeometries) {
            if (geo.geometry && geo.geometry.attributes && geo.geometry.attributes.position) {
              geometriesToProcess.push({ geometry: geo.geometry, matrixWorld: geo.matrixWorld });
            }
          }
        }
        
        if (geometriesToProcess.length > 0) {
          try {
            // === STEP 1: Collect all XZ points from all models (top-down shadow) ===
            const xzPoints: Array<{x: number; z: number}> = [];
            const dedupe = new Set<string>();
            
            // NOTE: For convex-hull, we don't use livePositionDelta because the matrixWorld
            // passed in from the mesh refs already includes the live pivot transform.
            // The mesh is a child of the PivotControls group, so its matrixWorld is always current.
            
            // Process each geometry
            for (const geoInfo of geometriesToProcess) {
              const positions = geoInfo.geometry.attributes.position as THREE.BufferAttribute;
              const sampleStep = Math.max(1, Math.floor(positions.count / 5000));
              const v = new THREE.Vector3();
              
              for (let i = 0; i < positions.count; i += sampleStep) {
                v.set(positions.getX(i), positions.getY(i), positions.getZ(i));
                if (geoInfo.matrixWorld) {
                  v.applyMatrix4(geoInfo.matrixWorld);
                }
                // Project to XZ plane (the floor) - matrixWorld already has full world transform
                const key = `${Math.round(v.x * 100)}:${Math.round(v.z * 100)}`;
                if (!dedupe.has(key)) {
                  dedupe.add(key);
                  xzPoints.push({ x: v.x, z: v.z });
                }
              }
            }
            
            // === STEP 1b: Add additional hull points (e.g., from supports) ===
            for (const pt of additionalHullPoints) {
              const key = `${Math.round(pt.x * 100)}:${Math.round(pt.z * 100)}`;
              if (!dedupe.has(key)) {
                dedupe.add(key);
                xzPoints.push({ x: pt.x, z: pt.z });
              }
            }

            if (xzPoints.length < 3) {
              throw new Error('Not enough points for convex hull');
            }

            // === STEP 2: Compute 2D convex hull using monotone chain ===
            // Sort points by x, then by z
            const sorted = xzPoints.slice().sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
            
            // Cross product for 2D points (using x and z)
            const cross = (o: {x: number; z: number}, a: {x: number; z: number}, b: {x: number; z: number}) => 
              (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
            
            // Build lower hull
            const lower: Array<{x: number; z: number}> = [];
            for (const p of sorted) {
              while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
              }
              lower.push(p);
            }
            
            // Build upper hull
            const upper: Array<{x: number; z: number}> = [];
            for (let i = sorted.length - 1; i >= 0; i--) {
              const p = sorted[i];
              while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
              }
              upper.push(p);
            }
            
            // Concatenate hulls (remove last point of each as it's repeated)
            // This produces a CCW hull in XZ space
            const hull = lower.slice(0, lower.length - 1).concat(upper.slice(0, upper.length - 1));

            // === STEP 3: Apply padding by offsetting each vertex outward ===
            const margin = typeof oversizeXY === 'number' ? oversizeXY : 0;
            let finalHull = hull;
            
            if (margin > 0) {
              // Compute centroid of the hull
              let cx = 0, cz = 0;
              for (const p of hull) {
                cx += p.x;
                cz += p.z;
              }
              cx /= hull.length;
              cz /= hull.length;
              
              // Offset each vertex outward from centroid by margin
              // This is a simple radial offset that always expands the polygon
              finalHull = hull.map(p => {
                const dx = p.x - cx;
                const dz = p.z - cz;
                const dist = Math.hypot(dx, dz);
                if (dist < 0.001) return p; // Point is at centroid, don't move
                // Move point outward by margin amount
                const scale = (dist + margin) / dist;
                return {
                  x: cx + dx * scale,
                  z: cz + dz * scale
                };
              });
            }

            // === STEP 4: Create THREE.Shape ===
            // Shape is defined in XY plane, we'll rotate to XZ after extrusion
            // Map our XZ coordinates to Shape's XY: shape.x = world.x, shape.y = -world.z
            // We negate Z because rotateX(-PI/2) will flip the Y axis
            
            // Convert hull points to XY format for shape creation
            const hullPointsXY = finalHull.map(p => ({ x: p.x, y: -p.z }));
            
            // Create shape with optional rounded corners
            const shape = cornerRadius > 0 
              ? createRoundedPolygonShape(hullPointsXY, cornerRadius)
              : (() => {
                  const s = new THREE.Shape();
                  s.moveTo(hullPointsXY[0].x, hullPointsXY[0].y);
                  for (let i = 1; i < hullPointsXY.length; i++) {
                    s.lineTo(hullPointsXY[i].x, hullPointsXY[i].y);
                  }
                  s.closePath();
                  return s;
                })();

            // === STEP 5: Extrude and position with 45-degree chamfer ===
            // For a 45-degree chamfer, bevelThickness must equal bevelSize
            const chamferSize = Math.min(1.0, depth * 0.15);
            // Reduce extrusion depth so total height (including chamfers) equals specified depth
            const extrudeDepth = Math.max(0.1, depth - 2 * chamferSize);
            
            const g = new THREE.ExtrudeGeometry(shape, { 
              depth: extrudeDepth, 
              bevelEnabled: true,
              bevelThickness: chamferSize, // vertical distance
              bevelSize: chamferSize,       // horizontal distance - equal for 45 degrees
              bevelSegments: 1,             // single segment = flat chamfer, not rounded fillet
            });
            
            // After rotation, geometry spans Y=-chamferSize to Y=extrudeDepth+chamferSize
            // = Y=-chamferSize to Y=(depth-2*chamfer)+chamfer = Y=-chamferSize to Y=depth-chamferSize
            // Translate up by chamferSize so bottom sits at Y=0, top at Y=depth
            g.rotateX(-Math.PI / 2);
            g.translate(0, chamferSize, 0);
            
            return finalizeGeometry(g);
          } catch (error) {
            console.warn('Error creating convex hull geometry, falling back to rectangular:', error);
          }
        }
        // Fallback to simple rounded rectangle if no model geometry or error
        {
          const fallbackWidth = width || 100;
          const fallbackHeight = height || 100;
          const fallbackShape = createRoundedRectShape(fallbackWidth, fallbackHeight, 0.1);
          const g = new THREE.ExtrudeGeometry(fallbackShape, {
            depth: depth,
            bevelEnabled: false
          });
          g.rotateX(-Math.PI / 2);
          return finalizeGeometry(g);
        }

      case 'perforated-panel':
        // Rounded rectangle with slight bevel for soft edges
        return createExtrudedBaseplate(createRoundedRectShape(width, height, 0.08), depth);

      case 'metal-wooden-plate':
        // Slightly smaller corner radius for metal/wooden plates
        return createExtrudedBaseplate(createRoundedRectShape(width, height, 0.06), depth, 0.2);

      case 'rectangular':
      default:
        return createExtrudedBaseplate(createRoundedRectShape(width, height, 0.08), depth);
    }
  }, [type, width, height, depth, radius, modelGeometry, modelMatrixWorld, modelOrigin, oversizeXY, additionalHullPoints, livePositionDelta, cornerRadius]);

  // Update geometry when props change
  React.useEffect(() => {
    if (meshRef.current) {
      meshRef.current.geometry.dispose();
      meshRef.current.geometry = geometry;
    }
  }, [geometry]);

  // Add perforation holes for perforated panel type
  const perforationMeshes = useMemo(() => {
    if (type !== 'perforated-panel') return null;

    const meshes: JSX.Element[] = [];
    const holeSpacing = typeof pitch === 'number' ? pitch : 20;
    const holeRadius = (typeof holeDiameter === 'number' ? holeDiameter : 6) / 2;
    const panelWidth = width;
    const panelHeight = height;

    for (let x = -panelWidth/2 + holeSpacing; x < panelWidth/2; x += holeSpacing) {
      for (let y = -panelHeight/2 + holeSpacing; y < panelHeight/2; y += holeSpacing) {
        meshes.push(
          <mesh key={`hole-${x}-${y}`} position={[x, depth/2 + 0.1, y]}>
            <cylinderGeometry args={[holeRadius, holeRadius, 0.5, 12]} />
            <meshBasicMaterial color={0x444444} />
          </mesh>
        );
      }
    }

    return meshes;
  }, [type, width, height, depth, pitch, holeDiameter]);

  return (
    <group ref={groupRef} position={position}>
      <mesh
        ref={meshRef}
        onClick={onSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        geometry={geometry}
        material={new THREE.MeshStandardMaterial(materialProps)}
        receiveShadow
        castShadow
      />

      {/* Add perforation holes for perforated panel */}
      {perforationMeshes && perforationMeshes.map((mesh, index) => (
        <React.Fragment key={index}>
          {mesh}
        </React.Fragment>
      ))}

      {/* Add visual indicators for different types */}
      {selected && (
        <mesh position={[0, depth/2 + 1, 0]}>
          <ringGeometry args={[radius * 0.8, radius * 0.9, 32]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
};

export default BasePlate;



