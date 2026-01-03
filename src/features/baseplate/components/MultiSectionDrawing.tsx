/**
 * MultiSectionDrawing
 * 
 * Component for drawing rectangular sections for multi-section baseplates.
 * Allows users to click and drag to create rectangular regions on the XZ plane.
 * Uses visual guidelines similar to support placement.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { BasePlateSection } from '../types';

interface MultiSectionDrawingProps {
  /** Whether drawing mode is active */
  active: boolean;
  /** Y position of the drawing plane (typically 0 or baseplate top) */
  planeY?: number;
  /** Padding to add to drawn sections */
  padding?: number;
  /** Callback when a section is drawn */
  onSectionDrawn: (section: BasePlateSection) => void;
  /** Callback when drawing mode should be cancelled */
  onCancel?: () => void;
  /** Existing sections to display */
  existingSections?: BasePlateSection[];
}

interface DrawingState {
  isDrawing: boolean;
  startPoint: THREE.Vector2 | null;
  currentPoint: THREE.Vector2 | null;
}

/** Guide line extension - large value to extend across entire scene (matches SupportPlacement) */
const GUIDE_LINE_EXTENSION = 2000;

/** Dash pattern configuration */
const DASH_SIZE = 2;
const GAP_SIZE = 1.5;

/** Minimum section size in mm */
const MIN_SECTION_SIZE = 10;

/**
 * Generates dashed line segments for a rectangle outline.
 * Extracted to reduce code duplication and improve maintainability.
 */
const generateDashedRectangle = (
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  dashSize: number = DASH_SIZE,
  gapSize: number = GAP_SIZE
): number[] => {
  const corners = [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];

  const segments: number[] = [];

  corners.forEach((corner, i) => {
    const next = corners[(i + 1) % corners.length];
    const dx = next.x - corner.x;
    const dz = next.z - corner.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    
    if (length === 0) return;
    
    const dirX = dx / length;
    const dirZ = dz / length;

    let distance = 0;
    let shouldDraw = true;

    while (distance < length) {
      const segmentLength = shouldDraw ? dashSize : gapSize;
      const endDistance = Math.min(distance + segmentLength, length);

      if (shouldDraw) {
        const startX = corner.x + dirX * distance;
        const startZ = corner.z + dirZ * distance;
        const endX = corner.x + dirX * endDistance;
        const endZ = corner.z + dirZ * endDistance;
        segments.push(startX, startZ, endX, endZ);
      }

      distance = endDistance;
      shouldDraw = !shouldDraw;
    }
  });

  return segments;
};

/**
 * Calculates center-based rectangle dimensions from start and current points.
 */
const calculateRectDimensions = (start: THREE.Vector2, current: THREE.Vector2) => {
  const centerX = start.x;
  const centerZ = start.y;
  const dx = current.x - centerX;
  const dz = current.y - centerZ;

  const width = Math.abs(dx) * 2;
  const depth = Math.abs(dz) * 2;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  return {
    centerX,
    centerZ,
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth,
    width,
    depth,
  };
};

const MultiSectionDrawing: React.FC<MultiSectionDrawingProps> = ({
  active,
  planeY = 0,
  padding = 0,
  onSectionDrawn,
  onCancel,
  existingSections = [],
}) => {
  const { camera, gl, size } = useThree();
  const [drawingState, setDrawingState] = useState<DrawingState>({
    isDrawing: false,
    startPoint: null,
    currentPoint: null,
  });
  const [hoverPoint, setHoverPoint] = useState<THREE.Vector2 | null>(null);
  
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY));
  const raycasterRef = useRef(new THREE.Raycaster());

  // Update plane height when planeY changes
  useEffect(() => {
    planeRef.current.constant = -planeY;
  }, [planeY]);

  // Get intersection point with XZ plane from ThreeEvent
  const getPlaneIntersectionFromEvent = useCallback((e: ThreeEvent<PointerEvent>): THREE.Vector3 | null => {
    // Use the ray from the event directly
    const intersection = new THREE.Vector3();
    const hit = e.ray.intersectPlane(planeRef.current, intersection);
    return hit ? intersection : null;
  }, []);

  // Handle pointer down - start drawing
  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!active) return;
    
    const intersection = getPlaneIntersectionFromEvent(e);
    if (!intersection) return;
    
    e.stopPropagation();
    
    setDrawingState({
      isDrawing: true,
      startPoint: new THREE.Vector2(intersection.x, intersection.z),
      currentPoint: new THREE.Vector2(intersection.x, intersection.z),
    });
  }, [active, getPlaneIntersectionFromEvent]);

  // Handle pointer move - update current point
  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const intersection = getPlaneIntersectionFromEvent(e);
    if (!intersection) {
      setHoverPoint(null);
      return;
    }
    
    const point = new THREE.Vector2(intersection.x, intersection.z);
    setHoverPoint(point);
    
    if (drawingState.isDrawing && drawingState.startPoint) {
      setDrawingState(prev => ({
        ...prev,
        currentPoint: point,
      }));
    }
  }, [drawingState.isDrawing, drawingState.startPoint, getPlaneIntersectionFromEvent]);

  // Handle pointer up - finish drawing
  const handlePointerUp = useCallback(() => {
    if (!drawingState.isDrawing || !drawingState.startPoint || !drawingState.currentPoint) {
      setDrawingState({ isDrawing: false, startPoint: null, currentPoint: null });
      return;
    }
    
    const rect = calculateRectDimensions(drawingState.startPoint, drawingState.currentPoint);
    
    // Only create section if it meets minimum size requirements
    if (rect.width >= MIN_SECTION_SIZE && rect.depth >= MIN_SECTION_SIZE) {
      const section: BasePlateSection = {
        id: `section-${Date.now()}`,
        minX: rect.minX,
        maxX: rect.maxX,
        minZ: rect.minZ,
        maxZ: rect.maxZ,
        // Store original size (not position) for maintaining minimum dimensions
        originalWidth: rect.width,
        originalDepth: rect.depth,
        // Store original center for shrinking back when items are removed
        originalCenterX: (rect.minX + rect.maxX) / 2,
        originalCenterZ: (rect.minZ + rect.maxZ) / 2,
      };
      
      onSectionDrawn(section);
    }
    
    setDrawingState({ isDrawing: false, startPoint: null, currentPoint: null });
  }, [drawingState, onSectionDrawn]);

  // Handle escape key to cancel drawing, Enter key to confirm
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      
      if (e.key === 'Escape') {
        setDrawingState({ isDrawing: false, startPoint: null, currentPoint: null });
        onCancel?.();
      } else if (e.key === 'Enter') {
        // If currently drawing, finish the current section first
        if (drawingState.isDrawing && drawingState.startPoint && drawingState.currentPoint) {
          const rect = calculateRectDimensions(drawingState.startPoint, drawingState.currentPoint);
          
          // Only create section if it meets minimum size requirements
          if (rect.width >= MIN_SECTION_SIZE && rect.depth >= MIN_SECTION_SIZE) {
            const section: BasePlateSection = {
              id: `section-${Date.now()}`,
              minX: rect.minX,
              maxX: rect.maxX,
              minZ: rect.minZ,
              maxZ: rect.maxZ,
              originalWidth: rect.width,
              originalDepth: rect.depth,
              originalCenterX: (rect.minX + rect.maxX) / 2,
              originalCenterZ: (rect.minZ + rect.maxZ) / 2,
            };
            onSectionDrawn(section);
          }
          setDrawingState({ isDrawing: false, startPoint: null, currentPoint: null });
        }
        
        // Dispatch event to confirm and create the baseplate with all drawn sections
        if (existingSections && existingSections.length > 0) {
          window.dispatchEvent(new CustomEvent('create-baseplate', {
            detail: { 
              type: 'baseplate',
              option: 'multi-section',
              dimensions: {
                padding,
                height: 5, // Default height
                sections: existingSections
              }
            }
          }));
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onCancel, drawingState, existingSections, padding, onSectionDrawn]);

  // Calculate preview rectangle dimensions (center-based like supports)
  // Must be called before early return to satisfy Rules of Hooks
  const previewRect = useMemo(() => {
    if (!drawingState.isDrawing || !drawingState.startPoint || !drawingState.currentPoint) {
      return null;
    }
    return calculateRectDimensions(drawingState.startPoint, drawingState.currentPoint);
  }, [drawingState.isDrawing, drawingState.startPoint, drawingState.currentPoint]);

  if (!active) return null;

  // XY Guide lines component (gray crosshairs extending to view edges)
  // Matches the style used in SupportPlacement for consistency
  const XYGuides: React.FC<{ point: THREE.Vector2 }> = ({ point }) => {
    const y = planeY + 0.02;
    const color = 0x9CA3AF; // Same gray as SupportPlacement
    const len = GUIDE_LINE_EXTENSION;
    const px = point.x;
    const pz = point.y;
    
    // Lines extend from -len to +len through the cursor point (matching SupportPlacement)
    const positions = new Float32Array([
      // Horizontal line (along X axis) through Z = pz
      -len, y, pz, len, y, pz,
      // Vertical line (along Z axis) through X = px
      px, y, -len, px, y, len,
    ]);
    
    // Small cross marker at cursor position
    const cross = new Float32Array([
      px - 1.5, y, pz - 1.5, px + 1.5, y, pz + 1.5,
      px - 1.5, y, pz + 1.5, px + 1.5, y, pz - 1.5,
    ]);
    
    return (
      <group renderOrder={999}>
        {/* Main guide lines extending to edges */}
        <lineSegments frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={positions.length / 3}
              array={positions}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} linewidth={1} />
        </lineSegments>
        {/* Cross marker at cursor */}
        <lineSegments frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={cross.length / 3}
              array={cross}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={0x374151} depthTest={false} depthWrite={false} linewidth={1} />
        </lineSegments>
      </group>
    );
  };

  // Dashed outline component for preview rectangle
  const DashedOutline: React.FC<{ rect: typeof previewRect; color: number }> = ({ rect, color }) => {
    if (!rect) return null;
    
    const y = planeY + 0.035;
    const segments2D = generateDashedRectangle(rect.minX, rect.maxX, rect.minZ, rect.maxZ);
    
    // Convert 2D segments to 3D by inserting Y coordinate
    const segments3D = new Float32Array(segments2D.length / 4 * 6);
    for (let i = 0, j = 0; i < segments2D.length; i += 4, j += 6) {
      segments3D[j] = segments2D[i];       // x1
      segments3D[j + 1] = y;               // y1
      segments3D[j + 2] = segments2D[i + 1]; // z1
      segments3D[j + 3] = segments2D[i + 2]; // x2
      segments3D[j + 4] = y;               // y2
      segments3D[j + 5] = segments2D[i + 3]; // z2
    }
    
    return (
      <lineSegments renderOrder={1000}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={segments3D.length / 3}
            array={segments3D}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </lineSegments>
    );
  };

  // Dimension lines component
  const DimensionLines: React.FC<{ rect: typeof previewRect }> = ({ rect }) => {
    if (!rect) return null;
    
    const y = planeY + 0.035;
    const color = 0x6b7280;
    const centerX = (rect.minX + rect.maxX) / 2;
    const centerZ = (rect.minZ + rect.maxZ) / 2;
    
    return (
      <>
        {/* Width dimension line (top edge) */}
        <lineSegments renderOrder={1100}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([
                rect.minX, y, centerZ,
                rect.maxX, y, centerZ,
              ])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </lineSegments>
        
        {/* Depth dimension line (right edge) */}
        <lineSegments renderOrder={1100}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([
                centerX, y, rect.minZ,
                centerX, y, rect.maxZ,
              ])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </lineSegments>
      </>
    );
  };

  return (
    <group>
      {/* Invisible plane for capturing pointer events */}
      <mesh
        position={[0, planeY + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        visible={false}
      >
        <planeGeometry args={[10000, 10000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* XY guide lines - show during hover or when drawing */}
      {(hoverPoint || drawingState.startPoint) && (
        <XYGuides point={drawingState.startPoint || hoverPoint!} />
      )}

      {/* Center marker (ring) after first click */}
      {drawingState.startPoint && drawingState.isDrawing && (
        <mesh 
          position={[drawingState.startPoint.x, planeY + 0.035, drawingState.startPoint.y]} 
          renderOrder={1001} 
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.6, 1.2, 24]} />
          <meshBasicMaterial color={0x374151} transparent opacity={0.9} depthTest={false} depthWrite={false} />
        </mesh>
      )}

      {/* Dashed outline preview */}
      {previewRect && <DashedOutline rect={previewRect} color={0x2563eb} />}

      {/* Dimension lines */}
      {previewRect && <DimensionLines rect={previewRect} />}

      {/* Filled rectangle preview (subtle) */}
      {previewRect && (
        <mesh
          position={[
            (previewRect.minX + previewRect.maxX) / 2,
            planeY + 0.025,
            (previewRect.minZ + previewRect.maxZ) / 2,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={998}
        >
          <planeGeometry args={[previewRect.maxX - previewRect.minX, previewRect.maxZ - previewRect.minZ]} />
          <meshBasicMaterial color={0x2563eb} transparent opacity={0.1} depthTest={false} depthWrite={false} />
        </mesh>
      )}

      {/* Dimension label for preview */}
      {previewRect && (
        <Html
          position={[
            (previewRect.minX + previewRect.maxX) / 2,
            planeY + 2,
            (previewRect.minZ + previewRect.maxZ) / 2,
          ]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-black/80 text-white rounded-md px-2 py-1 text-xs font-mono whitespace-nowrap">
            {previewRect.width.toFixed(1)} × {previewRect.depth.toFixed(1)} mm
          </div>
        </Html>
      )}

      {/* Existing sections - show with green color */}
      {existingSections.map((section) => {
        const sectionWidth = section.maxX - section.minX;
        const sectionDepth = section.maxZ - section.minZ;
        const centerX = (section.minX + section.maxX) / 2;
        const centerZ = (section.minZ + section.maxZ) / 2;
        const color = 0x10b981;
        const sectionRect = { ...section, width: sectionWidth, depth: sectionDepth };
        
        return (
          <group key={section.id}>
            {/* Subtle fill */}
            <mesh
              position={[centerX, planeY + 0.025, centerZ]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={998}
            >
              <planeGeometry args={[sectionWidth, sectionDepth]} />
              <meshBasicMaterial color={color} transparent opacity={0.1} depthTest={false} depthWrite={false} />
            </mesh>
            
            {/* Dashed outline */}
            <DashedOutline rect={sectionRect} color={color} />
          </group>
        );
      })}

      {/* Drawing mode indicator */}
      {!drawingState.isDrawing && (
        <Html position={[0, planeY + 5, 0]} center>
          <div
            className="bg-primary/90 text-white rounded-lg px-3 py-2 text-xs font-tech whitespace-nowrap shadow-lg"
            style={{ pointerEvents: 'none' }}
          >
            {existingSections && existingSections.length > 0 
              ? 'Click and drag to draw another section • ENTER to confirm • ESC to cancel'
              : 'Click and drag to draw a baseplate section • ESC to cancel'}
          </div>
        </Html>
      )}
    </group>
  );
};

export default MultiSectionDrawing;
