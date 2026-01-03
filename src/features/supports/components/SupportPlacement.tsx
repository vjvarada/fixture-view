import React from 'react';
import * as THREE from 'three';
import { AnySupport, SupportType, RectSupport, CylSupport, ConicalSupport } from '../types';
import { computeSupportMetrics as evaluateSupportMetrics } from '../utils/metrics';
import { ensureClockwiseWindingXZ } from '../utils/polygonUtils';
import type { BasePlateSection } from '@/features/baseplate';

interface SupportPlacementProps {
  active: boolean;
  type: SupportType | null;
  initParams?: Record<string, number>;
  onCreate: (support: AnySupport) => void;
  onCancel: () => void;
  defaultCenter?: THREE.Vector2;
  raycastTargets?: THREE.Object3D[];
  baseTopY?: number; // world Y of baseplate top (defaults to 0)
  contactOffset?: number; // gap to keep from model contact in mm
  maxRayHeight?: number; // max height to search above base for intersections
  baseTarget?: THREE.Object3D | null; // actual baseplate mesh for local baseY
  modelBounds?: { min: THREE.Vector3; max: THREE.Vector3 } | null; // model bounding box for fallback height
  existingSupports?: AnySupport[]; // existing supports for snap alignment
  snapThreshold?: number; // snap threshold distance in mm (0 to disable)
  basePlateSections?: BasePlateSection[]; // multi-section baseplate sections for boundary checking
}

/** Alignment information for snapping */
interface SnapAlignment {
  /** Horizontal alignment (same Z) - the support we're aligning to */
  horizontal: AnySupport | null;
  /** Vertical alignment (same X) - the support we're aligning to */
  vertical: AnySupport | null;
  /** The snapped position */
  snappedPosition: THREE.Vector2;
}

/** Default snap threshold in mm */
const DEFAULT_SNAP_THRESHOLD = 3;

/** Alignment guide line extension beyond the supports */
const GUIDE_LINE_EXTENSION = 50;

/**
 * Finds the closest support for horizontal alignment (same Z coordinate).
 */
function findHorizontalAlignment(
  position: THREE.Vector2,
  existingSupports: AnySupport[],
  threshold: number
): AnySupport | null {
  let closestSupport: AnySupport | null = null;
  let minDistance = threshold;

  for (const support of existingSupports) {
    const zDiff = Math.abs(position.y - support.center.y);
    if (zDiff < minDistance) {
      minDistance = zDiff;
      closestSupport = support;
    }
  }

  return closestSupport;
}

/**
 * Finds the closest support for vertical alignment (same X coordinate).
 */
function findVerticalAlignment(
  position: THREE.Vector2,
  existingSupports: AnySupport[],
  threshold: number
): AnySupport | null {
  let closestSupport: AnySupport | null = null;
  let minDistance = threshold;

  for (const support of existingSupports) {
    const xDiff = Math.abs(position.x - support.center.x);
    if (xDiff < minDistance) {
      minDistance = xDiff;
      closestSupport = support;
    }
  }

  return closestSupport;
}

/**
 * Computes snap alignment for a given position.
 * Prevents snapping to the exact center of existing supports.
 */
function computeSnapAlignment(
  rawPosition: THREE.Vector2,
  existingSupports: AnySupport[],
  threshold: number
): SnapAlignment {
  const horizontalSupport = findHorizontalAlignment(rawPosition, existingSupports, threshold);
  const verticalSupport = findVerticalAlignment(rawPosition, existingSupports, threshold);

  const snappedPosition = rawPosition.clone();

  // Check if both alignments would snap to the same support's center
  if (horizontalSupport && verticalSupport && horizontalSupport.id === verticalSupport.id) {
    const xDiff = Math.abs(rawPosition.x - horizontalSupport.center.x);
    const zDiff = Math.abs(rawPosition.y - horizontalSupport.center.y);
    
    if (xDiff < zDiff) {
      snappedPosition.x = verticalSupport.center.x;
      return {
        horizontal: null,
        vertical: verticalSupport,
        snappedPosition,
      };
    } else {
      snappedPosition.y = horizontalSupport.center.y;
      return {
        horizontal: horizontalSupport,
        vertical: null,
        snappedPosition,
      };
    }
  }

  let finalHorizontal = horizontalSupport;
  let finalVertical = verticalSupport;

  if (horizontalSupport) {
    snappedPosition.y = horizontalSupport.center.y;
  }
  if (verticalSupport) {
    snappedPosition.x = verticalSupport.center.x;
  }

  // Check if resulting position is at center of any existing support
  for (const support of existingSupports) {
    const atCenter = 
      Math.abs(snappedPosition.x - support.center.x) < 0.01 &&
      Math.abs(snappedPosition.y - support.center.y) < 0.01;
    
    if (atCenter) {
      const xDiff = Math.abs(rawPosition.x - support.center.x);
      const zDiff = Math.abs(rawPosition.y - support.center.y);
      
      if (xDiff < zDiff) {
        finalHorizontal = null;
        snappedPosition.y = rawPosition.y;
      } else {
        finalVertical = null;
        snappedPosition.x = rawPosition.x;
      }
      break;
    }
  }

  return {
    horizontal: finalHorizontal,
    vertical: finalVertical,
    snappedPosition,
  };
}




/**
 * Checks if a point (x, z) is within any of the baseplate sections.
 */
function isPointInBasePlateSections(
  x: number,
  z: number,
  sections: BasePlateSection[] | undefined
): boolean {
  if (!sections || sections.length === 0) return false;
  
  return sections.some(section => 
    x >= section.minX && x <= section.maxX &&
    z >= section.minZ && z <= section.maxZ
  );
}

const SupportPlacement: React.FC<SupportPlacementProps> = ({ active, type, initParams, onCreate, onCancel, defaultCenter, raycastTargets = [], baseTopY = 0, contactOffset = 0, maxRayHeight = 2000, baseTarget = null, modelBounds = null, existingSupports = [], snapThreshold = DEFAULT_SNAP_THRESHOLD, basePlateSections }) => {
  const [center, setCenter] = React.useState<THREE.Vector2 | null>(null);
  const [previewSupport, setPreviewSupport] = React.useState<AnySupport | null>(null);
  const [hover, setHover] = React.useState<THREE.Vector2 | null>(null);
  const [customPoints, setCustomPoints] = React.useState<THREE.Vector2[]>([]);
  const [drawingCustom, setDrawingCustom] = React.useState(false);
  const [snapAlignment, setSnapAlignment] = React.useState<SnapAlignment | null>(null);
  const raycasterRef = React.useRef(new THREE.Raycaster());
  // Reusable plane object to avoid GC during mouse moves
  const planeRef = React.useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hitPointRef = React.useRef(new THREE.Vector3());
  // Throttle metrics computation
  const lastMetricsTimeRef = React.useRef(0);
  const pendingPreviewRef = React.useRef<AnySupport | null>(null);

  const computeMetrics = React.useCallback(
    (s: AnySupport) =>
      evaluateSupportMetrics({
        support: s,
        baseTopY,
        contactOffset,
        baseTarget,
        modelTargets: raycastTargets,
        maxRayHeight,
        raycaster: raycasterRef.current,
        modelBounds,
      }),
    [baseTopY, contactOffset, baseTarget, raycastTargets, maxRayHeight, modelBounds]
  );

  const closeThreshold = 2;  // 2mm threshold for highlighting to close the loop
  const joinThreshold = 5;   // 5mm threshold for joining start/end points together

  // When entering via edit mode, we may receive an initial center in initParams.
  React.useEffect(() => {
    if (!active) {
      return;
    }
    if (center) return;
    const cx = initParams?.centerX;
    const cz = initParams?.centerZ;
    if (typeof cx === 'number' && typeof cz === 'number') {
      setCenter(new THREE.Vector2(cx, cz));
    }
  }, [active, initParams, center]);

  const finalizeCustomSupport = React.useCallback((points: THREE.Vector2[]) => {
    if (points.length < 3) return;
    let pts = points.map(p => p.clone());
    
    // If the last point is within joinThreshold of the first point, remove it
    // This ensures a clean closed loop without a tiny gap or overlap
    if (pts.length >= 3) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first.distanceTo(last) <= joinThreshold) {
        pts = pts.slice(0, -1); // Remove the last point
      }
    }
    
    if (pts.length < 3) return; // Need at least 3 points after cleanup
    
    const cx = pts.reduce((sum, v) => sum + v.x, 0) / pts.length;
    const cz = pts.reduce((sum, v) => sum + v.y, 0) / pts.length;
    const centerV = new THREE.Vector2(cx, cz);
    
    // Create polygon in local coordinates (relative to center)
    let polygon = pts.map(v => [v.x - cx, v.y - cz] as [number, number]);
    
    // Normalize winding order to clockwise (in XZ plane)
    // This ensures the resulting 3D geometry is always manifold,
    // regardless of whether the user drew the outline clockwise or anti-clockwise
    polygon = ensureClockwiseWindingXZ(polygon);
    
    const baseHeight = Number(initParams?.height ?? 5);
    const support = {
      id: `sup-${Date.now()}`,
      type: 'custom',
      center: centerV,
      height: baseHeight,
      polygon,
      cornerRadius: Number(initParams?.cornerRadius ?? 2),
      contactOffset,
    } as AnySupport;
    const metrics = computeMetrics(support);
    if (metrics) {
      support.height = metrics.height;
      (support as any).baseY = metrics.baseY;
    }
    onCreate(support);
    setCustomPoints([]);
    setCenter(null);
    setPreviewSupport(null);
    setHover(null);
    setDrawingCustom(false);
  }, [computeMetrics, initParams, onCreate, contactOffset]);

  const toSupport = (c: THREE.Vector2, cursor: THREE.Vector3): AnySupport => {
    const snap = 0.5; // mm grid for smoother drawing updates
    const snapv = (v: number) => Math.round(v / snap) * snap;
    const cx = c.x;
    const cz = c.y;
    const px = snapv(cursor.x);
    const pz = snapv(cursor.z);
    const dx = px - cx;
    const dz = pz - cz;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const footprint = { id: 'tmp', type: type as any, center: c.clone(), height: 0 } as AnySupport;
    if (type === 'rectangular') {
      const rectangularFootprint = footprint as RectSupport;
      rectangularFootprint.width = Number(initParams?.width ?? Math.abs(dx) * 2);
      rectangularFootprint.depth = Number(initParams?.depth ?? Math.abs(dz) * 2);
      rectangularFootprint.cornerRadius = Number(initParams?.cornerRadius ?? 2);
    } else if (type === 'cylindrical') {
      (footprint as CylSupport).radius = Number(initParams?.radius ?? dist);
    } else if (type === 'conical') {
      const conicalFootprint = footprint as ConicalSupport;
      conicalFootprint.baseRadius = Number(initParams?.baseRadius ?? dist);
      // Default top radius is 50% of base radius for a truncated cone
      const defaultTopRadius = conicalFootprint.baseRadius * 0.5;
      conicalFootprint.topRadius = Number(initParams?.topRadius ?? defaultTopRadius);
    }
    const metrics = computeMetrics(footprint);
    const height = metrics?.height ?? Number(initParams?.height ?? 5);
    const baseY = metrics?.baseY ?? baseTopY;
    if (type === 'cylindrical') {
      const radius = Number(initParams?.radius ?? dist);
      return { id: `sup-${Date.now()}`, type, center: new THREE.Vector2(cx, cz), height, radius, baseY, contactOffset } as AnySupport;
    }
    if (type === 'rectangular') {
      const width = Number(initParams?.width ?? Math.abs(dx) * 2);
      const depth = Number(initParams?.depth ?? Math.abs(dz) * 2);
      const cornerRadius = Number(initParams?.cornerRadius ?? 2);
      return { id: `sup-${Date.now()}`, type, center: new THREE.Vector2(cx, cz), height, width, depth, cornerRadius, baseY, contactOffset } as AnySupport;
    }
    if (type === 'conical') {
      const baseRadius = Number(initParams?.baseRadius ?? dist);
      // Default top radius is 50% of base radius for a truncated cone
      const defaultTopRadius = baseRadius * 0.5;
      const topRadius = Number(initParams?.topRadius ?? defaultTopRadius);
      return { id: `sup-${Date.now()}`, type, center: new THREE.Vector2(cx, cz), height, baseRadius, topRadius, baseY, contactOffset } as AnySupport;
    }
    // custom placeholder
    return { id: `sup-${Date.now()}`, type: 'custom', center: new THREE.Vector2(cx, cz), height, polygon: [[-5,-5],[5,-5],[5,5],[-5,5]], baseY, contactOffset } as AnySupport;
  };

  React.useEffect(() => {
    if (!active) {
      setCenter(null);
      setPreviewSupport(null);
      setHover(null);
      setCustomPoints([]);
      return;
    }
  }, [active]);

  const OutlinePreview: React.FC<{ s: AnySupport }> = ({ s }) => {
    const y = baseTopY + 0.02;
    const color = 0x2563eb;
    const dashSize = 2;
    const gapSize = 1.5;
    
    // Helper to create dashed line segments from a series of points
    const createDashedSegments = (points: Array<{x: number, z: number}>, closed: boolean = true) => {
      const dashSegments: number[] = [];
      const numPoints = points.length;
      const edgeCount = closed ? numPoints : numPoints - 1;
      
      for (let i = 0; i < edgeCount; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % numPoints];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        const dirX = dx / length;
        const dirZ = dz / length;
        
        let dist = 0;
        let drawing = true;
        
        while (dist < length) {
          const segLen = drawing ? dashSize : gapSize;
          const endDist = Math.min(dist + segLen, length);
          
          if (drawing) {
            const startX = p1.x + dirX * dist;
            const startZ = p1.z + dirZ * dist;
            const endX = p1.x + dirX * endDist;
            const endZ = p1.z + dirZ * endDist;
            dashSegments.push(startX, y, startZ, endX, y, endZ);
          }
          
          dist = endDist;
          drawing = !drawing;
        }
      }
      
      return new Float32Array(dashSegments);
    };
    
    // Helper to create dashed circle outline - traverses the entire circumference as one path
    const createDashedCircle = (radius: number, segments: number = 64) => {
      const dashSegments: number[] = [];
      const circumference = 2 * Math.PI * radius;
      let dist = 0;
      let drawing = true;
      
      while (dist < circumference) {
        const segLen = drawing ? dashSize : gapSize;
        const endDist = Math.min(dist + segLen, circumference);
        
        if (drawing) {
          const startAngle = (dist / circumference) * Math.PI * 2;
          const endAngle = (endDist / circumference) * Math.PI * 2;
          const startX = Math.cos(startAngle) * radius;
          const startZ = Math.sin(startAngle) * radius;
          const endX = Math.cos(endAngle) * radius;
          const endZ = Math.sin(endAngle) * radius;
          dashSegments.push(startX, y, startZ, endX, y, endZ);
        }
        
        dist = endDist;
        drawing = !drawing;
      }
      
      return new Float32Array(dashSegments);
    };
    
    if (s.type === 'cylindrical') {
      const radius = (s as any).radius as number;
      const dashPositions = createDashedCircle(radius);
      return (
        <lineSegments position={[s.center.x, baseTopY, s.center.y]} renderOrder={1000}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={dashPositions.length / 3} array={dashPositions} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </lineSegments>
      );
    }
    if (s.type === 'rectangular') {
      const width = (s as any).width as number;
      const depth = (s as any).depth as number;
      const hw = width / 2;
      const hd = depth / 2;
      const points = [
        { x: -hw, z: -hd },
        { x: hw, z: -hd },
        { x: hw, z: hd },
        { x: -hw, z: hd }
      ];
      const dashPositions = createDashedSegments(points, true);
      return (
        <lineSegments position={[s.center.x, baseTopY, s.center.y]} renderOrder={1000}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={dashPositions.length / 3} array={dashPositions} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </lineSegments>
      );
    }
    if (s.type === 'conical') {
      const radius = (s as any).baseRadius as number;
      const dashPositions = createDashedCircle(radius);
      return (
        <lineSegments position={[s.center.x, baseTopY, s.center.y]} renderOrder={1000}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={dashPositions.length / 3} array={dashPositions} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </lineSegments>
      );
    }
    if (s.type === 'custom') {
      const poly = (s as any).polygon as Array<[number, number]>;
      const points = poly.map(([x, z]) => ({ x, z }));
      const dashPositions = createDashedSegments(points, true);
      return (
        <lineSegments position={[s.center.x, baseTopY, s.center.y]} renderOrder={1000}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={dashPositions.length / 3} array={dashPositions} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </lineSegments>
      );
    }
    return null;
  };

  const getPlaneHit = (e: any): { point: THREE.Vector3 | null; planePoint: THREE.Vector2 | null; hitOnTarget: boolean } => {
    const ray = e.ray as THREE.Ray | undefined;
    if (!ray) {
      return { point: null, planePoint: null, hitOnTarget: false };
    }

    // Intersect with XZ plane at baseTopY - reuse plane and hitPoint objects
    planeRef.current.constant = -baseTopY;
    const hasPlaneHit = ray.intersectPlane(planeRef.current, hitPointRef.current) !== null;
    if (!hasPlaneHit) {
      return { point: null, planePoint: null, hitOnTarget: false };
    }

    // Check if ray actually hits model or baseplate; only then we want to treat it as a support interaction
    let hitOnTarget = false;
    const targets: THREE.Object3D[] = [];
    if (baseTarget) targets.push(baseTarget);
    if (raycastTargets && raycastTargets.length > 0) {
      targets.push(...raycastTargets);
    }

    if (targets.length > 0) {
      raycasterRef.current.set(ray.origin, ray.direction);
      const intersections = raycasterRef.current.intersectObjects(targets, true);
      if (intersections.length > 0) {
        hitOnTarget = true;
      }
    }

    // For multi-section baseplates, also check if the point is within any section bounds
    if (!hitOnTarget && basePlateSections && basePlateSections.length > 0) {
      hitOnTarget = isPointInBasePlateSections(
        hitPointRef.current.x,
        hitPointRef.current.z,
        basePlateSections
      );
    }

    const planePoint = new THREE.Vector2(hitPointRef.current.x, hitPointRef.current.z);
    return { point: hitPointRef.current.clone(), planePoint, hitOnTarget };
  };

  const handlePointerMove = (e: any) => {
    const { point, planePoint, hitOnTarget } = getPlaneHit(e);

    const hasCenter = !!center;
    const hasCustomPath = customPoints.length > 0 || drawingCustom;
    const isNonCustomPlacing = hasCenter && type !== 'custom';
    const isCustomDrawing = type === 'custom' && hasCustomPath;

    // Before placement starts: only react when hovering over model/baseplate
    // Exception: for custom drawing mode, allow hover anywhere on the plane
    if ((!point || !planePoint) || (!hitOnTarget && !isNonCustomPlacing && !isCustomDrawing && type !== 'custom')) {
      if (!hasCenter && !hasCustomPath) {
        setHover(null);
        setSnapAlignment(null);
      }
      return;
    }

    // For custom drawing, snap hover to first point if close enough to close the loop
    let snappedPoint = planePoint.clone();
    if (type === 'custom' && customPoints.length >= 3) {
      const first = customPoints[0];
      if (planePoint.distanceTo(first) <= closeThreshold) {
        snappedPoint = first.clone();
      }
    }

    // For center-based supports (rect, cyl, conical), compute snap alignment before center is set
    if (!center && type !== 'custom' && snapThreshold > 0 && existingSupports.length > 0) {
      const alignment = computeSnapAlignment(planePoint, existingSupports, snapThreshold);
      setSnapAlignment(alignment);
      snappedPoint = alignment.snappedPosition;
    } else if (center || type === 'custom') {
      // Clear snap alignment once center is set or in custom mode
      setSnapAlignment(null);
    }

    setHover(snappedPoint);
    if (type === 'custom') {
      // Don't modify customPoints on hover - the hover point is stored separately
      // and used for preview line drawing. Points are only added on click.
      return;
    }
    if (!center) return;
    const support = toSupport(center, point);
    if (!support) return;
    
    // Throttle expensive metrics computation to max 30fps (33ms)
    const now = performance.now();
    if (now - lastMetricsTimeRef.current > 33) {
      lastMetricsTimeRef.current = now;
      const metrics = computeMetrics(support);
      if (metrics) {
        (support as any).height = metrics.height;
        (support as any).baseY = metrics.baseY;
      }
    } else {
      // Use cached metrics from pending preview if available
      if (pendingPreviewRef.current) {
        (support as any).height = (pendingPreviewRef.current as any).height;
        (support as any).baseY = (pendingPreviewRef.current as any).baseY;
      }
    }
    pendingPreviewRef.current = support;
    setPreviewSupport(support);
  };

  const handlePointerDown = (e: any) => {
    const { point, planePoint, hitOnTarget } = getPlaneHit(e);

    if (!point || !planePoint) {
      return;
    }

    const hasCenter = !!center;
    const hasCustomPath = customPoints.length > 0 || drawingCustom;

    // For custom drawing, allow first click anywhere on the plane (not just on model/baseplate)
    // For other support types, first click must be on model/baseplate so camera can rotate freely elsewhere
    if (type !== 'custom' && !hasCenter && !hasCustomPath && !hitOnTarget) {
      return;
    }

    // For placement interactions, prevent orbit controls from treating this as a drag
    e.stopPropagation();
    if (type === 'custom') {
      const pt = planePoint.clone();
      
      // Check if we're closing the loop (near the first point with enough points)
      if (customPoints.length >= 3) {
        const first = customPoints[0];
        if (pt.distanceTo(first) <= closeThreshold) {
          // Close the loop - finalize without adding a new point
          finalizeCustomSupport(customPoints);
          return;
        }
      }
      
      if (customPoints.length === 0) {
        setCustomPoints([pt.clone()]);
        setDrawingCustom(true);
      } else {
        setCustomPoints(prev => [...prev, pt.clone()]);
        setDrawingCustom(true);
      }
      return;
    }
    if (!center) {
      // Use snapped position if available, otherwise use raw plane point
      const centerPoint = (snapAlignment && type !== 'custom') 
        ? snapAlignment.snappedPosition.clone() 
        : planePoint.clone();
      setCenter(centerPoint);
      setSnapAlignment(null); // Clear alignment guides once center is set
    } else {
      // Second click finalizes the support
      const support = toSupport(center, point);
      if (!support) return;
      const metrics = computeMetrics(support);
      if (metrics) {
        (support as any).height = metrics.height;
        (support as any).baseY = metrics.baseY;
      }
      onCreate(support);
      setCenter(null);
      setPreviewSupport(null);
    }
  };

  const handlePointerUp = (e: any) => {
    if (type !== 'custom') {
      return;
    }
    if (!drawingCustom) {
      return;
    }

    const { planePoint } = getPlaneHit(e);
    if (!planePoint) {
      return;
    }

    // Apply same snapping logic as in handlePointerMove - check if closing the loop
    if (customPoints.length >= 3) {
      const first = customPoints[0];
      if (planePoint.distanceTo(first) <= closeThreshold) {
        // Snap to first point and finalize
        finalizeCustomSupport(customPoints);
        return;
      }
    }
    
    // Points are added in handlePointerDown, not here
    // This handler only checks for loop closing
  };

  // XY Guides (crosshair + axes through point)
  // hideHorizontal/hideVertical: hide grey lines when blue snap alignment guides replace them
  const XYGuides: React.FC<{ point: THREE.Vector2; hideHorizontal?: boolean; hideVertical?: boolean }> = ({ point, hideHorizontal = false, hideVertical = false }) => {
    const y = baseTopY + 0.03;
    const len = 2000; // extend across scene
    const px = point.x;
    const pz = point.y;
    
    // Build positions array based on which lines to show
    const linePositions: number[] = [];
    if (!hideHorizontal) {
      // Horizontal X line through Z = pz
      linePositions.push(-len, y, pz, len, y, pz);
    }
    if (!hideVertical) {
      // Vertical Z line through X = px
      linePositions.push(px, y, -len, px, y, len);
    }
    
    const positions = new Float32Array(linePositions);
    const cross = new Float32Array([
      px - 1.5, y, pz - 1.5,  px + 1.5, y, pz + 1.5,
      px - 1.5, y, pz + 1.5,  px + 1.5, y, pz - 1.5,
    ]);
    return (
      <group renderOrder={1000}>
        {positions.length > 0 && (
          <lineSegments frustumCulled={false}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color={0x9CA3AF} depthWrite={false} depthTest={false} linewidth={1} />
          </lineSegments>
        )}
        <lineSegments frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={cross.length / 3} array={cross} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color={0x374151} depthWrite={false} depthTest={false} linewidth={1} />
        </lineSegments>
      </group>
    );
  };

  // Construction rectangle matching baseplate extents and dimension lines for supports
  const ConstructionOverlays: React.FC<{ s: AnySupport | null }> = ({ s }) => {
    if (!s) return null;
    const y = baseTopY + 0.018;

    const elems: JSX.Element[] = [];

    // Baseplate-matching rectangle (assuming plate centered at origin)
    if (baseTopY !== undefined) {
      const plateW = 800; // visual extent; does not have to match exact plate, acts as framing
      const plateH = 800;
      const hw = plateW / 2;
      const hh = plateH / 2;
      const rect = new Float32Array([
        -hw, y, -hh,  hw, y, -hh,
         hw, y, -hh,  hw, y,  hh,
         hw, y,  hh, -hw, y,  hh,
        -hw, y,  hh, -hw, y, -hh,
      ]);
      elems.push(
        <lineSegments key="bp" frustumCulled={false} renderOrder={900}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={rect.length / 3} array={rect} itemSize={3} />
          </bufferGeometry>
          <lineDashedMaterial color={0x9ca3af} linewidth={1} depthWrite={false} depthTest={false} dashSize={6} gapSize={4} />
        </lineSegments>
      );
    }

    // Dimension construction lines by type (text shown only in main HUD)
    if (s.type === 'cylindrical' || s.type === 'conical') {
      const center2 = (s as any).center as THREE.Vector2;
      const radius = s.type === 'cylindrical' ? (s as any).radius as number : (s as any).baseRadius as number;
      const angle = Math.PI / 4; // 45° for leader
      const px = center2.x + Math.cos(angle) * radius;
      const pz = center2.y + Math.sin(angle) * radius;
      const leader = new Float32Array([
        center2.x, y, center2.y,
        px,        y, pz,
      ]);
      elems.push(
        <group key="dim-circ" renderOrder={1100}>
          <lineSegments frustumCulled={false}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" count={leader.length / 3} array={leader} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color={0x6b7280} depthWrite={false} depthTest={false} />
          </lineSegments>
        </group>
      );
    } else if (s.type === 'rectangular') {
      const { width, depth } = s as any;
      const c = (s as any).center as THREE.Vector2;
      const hw = width / 2;
      const hd = depth / 2;

      // Horizontal (width) dimension above support
      const wx0 = c.x - hw;
      const wx1 = c.x + hw;
      const wy = y + 0.01;
      const wline = new Float32Array([
        wx0, wy, c.y,
        wx1, wy, c.y,
      ]);
      elems.push(
        <group key="dim-w" renderOrder={1100}>
          <lineSegments frustumCulled={false}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" count={wline.length / 3} array={wline} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color={0x6b7280} depthWrite={false} depthTest={false} />
          </lineSegments>
        </group>
      );

      // Vertical (depth) dimension to the right
      const dz0 = c.y - hd;
      const dz1 = c.y + hd;
      const dx = c.x + hw + 2;
      const dline = new Float32Array([
        dx, y, dz0,
        dx, y, dz1,
      ]);
      elems.push(
        <group key="dim-d" renderOrder={1100}>
          <lineSegments frustumCulled={false}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" count={dline.length / 3} array={dline} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color={0x6b7280} depthWrite={false} depthTest={false} />
          </lineSegments>
        </group>
      );
    }

    return <>{elems}</>;
  };

  // Custom polygon drawing preview (points + live segment). Standalone so JSX can reference it.
  const CustomPreview: React.FC = () => {
    // Show preview as soon as we have hover in custom mode, even before first click
    if (type !== 'custom' || !hover) return null;
    const y = baseTopY + 0.035;
    const pts = [...customPoints];
    
    // Check if hover is close to first point (loop about to close)
    // Use the same threshold as the snap logic (2mm)
    let isClosing = false;
    if (customPoints.length >= 3) {
      const first = customPoints[0];
      const dist = Math.sqrt(
        Math.pow(hover.x - first.x, 2) + Math.pow(hover.y - first.y, 2)
      );
      isClosing = dist <= closeThreshold;
    }
    
    // Only add hover point if not closing (when closing, the line goes back to first point automatically)
    if (hover && !isClosing) {
      pts.push(hover.clone());
    }
    
    // Before any points are placed, show the red start marker at hover position
    if (customPoints.length === 0) {
      return (
        <mesh position={[hover.x, y, hover.y]} renderOrder={1001} rotation={[-Math.PI/2,0,0]}>
          <circleGeometry args={[0.9, 20]} />
          <meshBasicMaterial color={0xef4444} depthTest={false} depthWrite={false} />
        </mesh>
      );
    }
    
    if (pts.length < 2) {
      return (
        <>
          {customPoints.map((v, i) => (
            <mesh key={`p-${i}`} position={[v.x, y, v.y]} renderOrder={1001} rotation={[-Math.PI/2,0,0]}>
              <circleGeometry args={[0.9, 20]} />
              <meshBasicMaterial color={i === 0 ? 0xef4444 : 0x2563eb} depthTest={false} depthWrite={false} />
            </mesh>
          ))}
        </>
      );
    }
    
    // Create dashed line as individual segments
    const dashSize = 2;
    const gapSize = 1.5;
    const dashSegments: number[] = [];
    
    // Close the loop
    const closedPts = [...pts, pts[0]];
    
    for (let i = 0; i < closedPts.length - 1; i++) {
      const p1 = closedPts[i];
      const p2 = closedPts[i + 1];
      const dx = p2.x - p1.x;
      const dz = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dz * dz);
      const dirX = dx / length;
      const dirZ = dz / length;
      
      let dist = 0;
      let drawing = true;
      while (dist < length) {
        const segLen = drawing ? dashSize : gapSize;
        const endDist = Math.min(dist + segLen, length);
        
        if (drawing) {
          const startX = p1.x + dirX * dist;
          const startZ = p1.y + dirZ * dist;
          const endX = p1.x + dirX * endDist;
          const endZ = p1.y + dirZ * endDist;
          dashSegments.push(startX, y, startZ, endX, y, endZ);
        }
        
        dist = endDist;
        drawing = !drawing;
      }
    }
    
    const lineColor = isClosing ? 0x22c55e : 0x2563eb;
    const dashPositions = new Float32Array(dashSegments);
    
    return (
      <>
        {customPoints.map((v, i) => (
          <mesh key={`p-${i}`} position={[v.x, y, v.y]} renderOrder={1001} rotation={[-Math.PI/2,0,0]}>
            <circleGeometry args={[isClosing && i === 0 ? 1.4 : 0.9, 20]} />
            <meshBasicMaterial color={i === 0 ? (isClosing ? 0x22c55e : 0xef4444) : 0x2563eb} depthTest={false} depthWrite={false} />
          </mesh>
        ))}
        <lineSegments renderOrder={1000}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={dashPositions.length / 3} array={dashPositions} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color={lineColor} depthTest={false} depthWrite={false} />
        </lineSegments>
      </>
    );
  };

  // Alignment guide component for snap visualization
  const AlignmentGuide: React.FC<{ 
    from: THREE.Vector2; 
    to: THREE.Vector2; 
    direction: 'horizontal' | 'vertical';
  }> = ({ from, to, direction }) => {
    const y = baseTopY + 0.15; // Slightly above the surface (same as holes)
    const color = 0x00aaff; // Blue for both directions
    const dashSize = 2;
    const gapSize = 1.5;

    // Compute line endpoints with extension
    let x1: number, z1: number, x2: number, z2: number;
    
    if (direction === 'horizontal') {
      // Same Z line (horizontal alignment)
      const z = to.y;
      x1 = Math.min(from.x, to.x) - GUIDE_LINE_EXTENSION;
      x2 = Math.max(from.x, to.x) + GUIDE_LINE_EXTENSION;
      z1 = z;
      z2 = z;
    } else {
      // Same X line (vertical alignment)
      const x = to.x;
      z1 = Math.min(from.y, to.y) - GUIDE_LINE_EXTENSION;
      z2 = Math.max(from.y, to.y) + GUIDE_LINE_EXTENSION;
      x1 = x;
      x2 = x;
    }

    // Create dashed line segments
    const dashSegments: number[] = [];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    const dirX = dx / length;
    const dirZ = dz / length;

    let dist = 0;
    let drawing = true;
    while (dist < length) {
      const segLen = drawing ? dashSize : gapSize;
      const endDist = Math.min(dist + segLen, length);
      
      if (drawing) {
        const startX = x1 + dirX * dist;
        const startZ = z1 + dirZ * dist;
        const endX = x1 + dirX * endDist;
        const endZ = z1 + dirZ * endDist;
        dashSegments.push(startX, y, startZ, endX, y, endZ);
      }
      
      dist = endDist;
      drawing = !drawing;
    }

    const positions = new Float32Array(dashSegments);

    return (
      <lineSegments renderOrder={1000}>
        <bufferGeometry>
          <bufferAttribute 
            attach="attributes-position" 
            count={positions.length / 3} 
            array={positions} 
            itemSize={3} 
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </lineSegments>
    );
  };

  return (
    <>
      {/* Large transparent plane aligned to XZ at baseTopY to capture pointer events */}
      <mesh
        position={[0, baseTopY + 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* XY Guides: prefer center, then hover, then defaultCenter for hint */}
      {/* Hide individual grey lines when blue snap alignment guides replace them */}
      {(center || hover || defaultCenter) && (
        <XYGuides 
          point={(center || hover || defaultCenter) as THREE.Vector2} 
          hideHorizontal={!!(snapAlignment && hover && !center && type !== 'custom' && snapAlignment.horizontal)}
          hideVertical={!!(snapAlignment && hover && !center && type !== 'custom' && snapAlignment.vertical)}
        />
      )}

      {/* Snap alignment guides - show dotted lines when aligning to existing supports */}
      {snapAlignment && hover && !center && type !== 'custom' && (
        <>
          {snapAlignment.horizontal && (
            <AlignmentGuide 
              from={hover} 
              to={snapAlignment.horizontal.center} 
              direction="horizontal" 
            />
          )}
          {snapAlignment.vertical && (
            <AlignmentGuide 
              from={hover} 
              to={snapAlignment.vertical.center} 
              direction="vertical" 
            />
          )}
        </>
      )}

      {/* Center marker (show only after first click) */}
      {center && (
        <mesh position={[center.x, baseTopY + 0.035, center.y]} renderOrder={1001} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6, 1.2, 24]} />
          <meshBasicMaterial color={0x374151} transparent opacity={0.9} depthTest={false} depthWrite={false} />
        </mesh>
      )}

      {/* 2D Outline Preview (non-custom) */}
      {previewSupport && type !== 'custom' && <OutlinePreview s={previewSupport} />}

      {/* Construction overlays and dimension callouts */}
      {previewSupport && <ConstructionOverlays s={previewSupport} />}

      {/* Custom drawing overlay */}
      <CustomPreview />
    </>
  );
};

export default SupportPlacement;