import React from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { AnySupport } from '../types';
import { computeSupportMetrics as evaluateSupportMetrics } from '../utils/metrics';

interface SupportEditOverlayProps {
  support: AnySupport | null;
  baseTopY: number;
  onCommit: (support: AnySupport) => void;
  onCancel: () => void;
  onDragStateChange?: (dragging: boolean) => void;
}

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
const tmpVec3 = new THREE.Vector3();

const SupportEditOverlay: React.FC<SupportEditOverlayProps> = ({ support, baseTopY, onCommit, onCancel, onDragStateChange }) => {
  const [preview, setPreview] = React.useState<AnySupport | null>(support);
  const [draggingHandle, setDraggingHandle] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPreview(support);
    setDraggingHandle(null);
  }, [support]);

  const computeMetrics = React.useCallback(
    (s: AnySupport) =>
      evaluateSupportMetrics({
        support: s,
        baseTopY,
        contactOffset: (s as any).contactOffset ?? 0,
        baseTarget: null,
        modelTargets: null,
        maxRayHeight: undefined,
        raycaster,
      }),
    [baseTopY]
  );

  if (!support || !preview) return null;

  const center = (preview as any).center as THREE.Vector2;
  const type = preview.type;
  const rotation = (preview as any).rotationZ ?? 0;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  const getPlaneHit = (e: any): THREE.Vector3 | null => {
    const ray = e.ray as THREE.Ray | undefined;
    if (!ray) return null;
    const effectiveBaseY = (preview as any).baseY ?? baseTopY;
    plane.constant = -effectiveBaseY;
    const hitPoint = new THREE.Vector3();
    const hasHit = ray.intersectPlane(plane, hitPoint) !== null;
    return hasHit ? hitPoint : null;
  };

  const commitPreview = (s: AnySupport) => {
    const metrics = computeMetrics(s);
    if (metrics) {
      (s as any).height = metrics.height;
      (s as any).baseY = metrics.baseY;
    }
    onCommit(s);
  };

  const handleRadiusDrag = (e: any) => {
    if (!draggingHandle || (type !== 'cylindrical' && type !== 'conical')) return;
    const hit = getPlaneHit(e);
    if (!hit) return;
    const dx = hit.x - center.x;
    const dz = hit.z - center.y;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const next: AnySupport = { ...(preview as any) } as AnySupport;
    if (type === 'cylindrical') {
      (next as any).radius = dist;
    } else {
      if (draggingHandle === 'baseRadius') {
        (next as any).baseRadius = dist;
      } else if (draggingHandle === 'topRadius') {
        (next as any).topRadius = dist;
      }
    }
    setPreview(next);
  };

  const handleRectCornerDrag = (corner: 'tl' | 'tr' | 'bl' | 'br', e: any) => {
    if (!draggingHandle || type !== 'rectangular') return;
    const hit = getPlaneHit(e);
    if (!hit) return;
    const dx = hit.x - center.x;
    const dz = hit.z - center.y;
    const halfW = Math.max(0.5, Math.abs(dx));
    const halfD = Math.max(0.5, Math.abs(dz));
    const next: AnySupport = { ...(preview as any) } as AnySupport;
    (next as any).width = halfW * 2;
    (next as any).depth = halfD * 2;
    setPreview(next);
  };

  const handlePointerMove = (e: any) => {
    if (!draggingHandle) return;
    if (type === 'cylindrical' || type === 'conical') {
      handleRadiusDrag(e);
    } else if (type === 'rectangular') {
      handleRectCornerDrag(draggingHandle as any, e);
    }
  };

  const handlePointerUp = () => {
    if (!draggingHandle || !preview) return;
    commitPreview(preview);
    setDraggingHandle(null);
    onDragStateChange?.(false);
  };

  const effectiveBaseY = (preview as any).baseY ?? baseTopY;
  const y = effectiveBaseY + 0.04;

  const renderEditOverlay = () => {
    const elems: JSX.Element[] = [];
    if (type === 'cylindrical' || type === 'conical') {
      const radius = type === 'cylindrical' ? (preview as any).radius as number : (preview as any).baseRadius as number;
      const handleSize = Math.max(0.9, radius * 0.045);
      elems.push(
        <mesh key="radius-outline" position={[center.x, y, center.y]}>
          <ringGeometry args={[radius * 0.98, radius * 1.02, 96]} />
          <meshBasicMaterial
            color={0x0ea5e9}
            transparent
            opacity={0.7}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      );
      const angle = Math.PI / 4;
      const hx = center.x + Math.cos(angle) * radius;
      const hz = center.y + Math.sin(angle) * radius;
      elems.push(
        <mesh
          key="radial-handle"
          position={[hx, y, hz]}
          onPointerDown={(e: any) => {
            e.stopPropagation();
            setDraggingHandle(type === 'cylindrical' ? 'radius' : 'baseRadius');
            onDragStateChange?.(true);
          }}
        >
          <circleGeometry args={[handleSize, 24]} />
          <meshBasicMaterial color={0x0ea5e9} depthWrite={false} depthTest={false} />
        </mesh>
      );
    } else if (type === 'rectangular') {
      const width = (preview as any).width as number;
      const depth = (preview as any).depth as number;
      const hw = width / 2;
      const hd = depth / 2;
      const baseSize = Math.max(0.9, Math.min(width, depth) * 0.045);
      elems.push(
        <mesh key="rect-outline" position={[center.x, y, center.y]} rotation={[-Math.PI / 2, rotation, 0]}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial
            color={0x0ea5e9}
            transparent
            opacity={0.08}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      );
      const localCorners: Array<[string, number, number]> = [
        ['tl', -hw, -hd],
        ['tr',  hw, -hd],
        ['bl', -hw,  hd],
        ['br',  hw,  hd],
      ];
      const corners: Array<[string, number, number]> = localCorners.map(([id, lx, lz]) => {
        const x = center.x + (lx * cosR - lz * sinR);
        const z = center.y + (lx * sinR + lz * cosR);
        return [id, x, z];
      });
      corners.forEach(([id, x, z]) => {
        elems.push(
          <mesh
            key={`corner-${id}`}
            position={[x, y, z]}
            onPointerDown={(e: any) => {
              e.stopPropagation();
              setDraggingHandle(id);
              onDragStateChange?.(true);
            }}
          >
            <circleGeometry args={[baseSize, 24]} />
            <meshBasicMaterial color={0x0ea5e9} depthWrite={false} depthTest={false} />
          </mesh>
        );
      });
    }
    return elems;
  };

  return (
    <group onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
      {renderEditOverlay()}

      {/* Dimension HUD above support center, similar to placement HUD */}
      <Html
        position={[
          center.x,
          effectiveBaseY + (preview as any).height + 1.2,
          center.y,
        ]}
        distanceFactor={3.2}
      >
        <div
          className="bg-black/70 text-white rounded-full shadow whitespace-nowrap"
          style={{ fontSize: '9px', padding: '1px 6px', border: '1px solid rgba(255,255,255,0.25)' }}
        >
          {type === 'cylindrical' && (
            <>R {(preview as any).radius.toFixed(1)} mm  H {(preview as any).height.toFixed(1)} mm</>
          )}
          {type === 'rectangular' && (
            <>W {(preview as any).width.toFixed(1)} mm  D {(preview as any).depth.toFixed(1)} mm  H {(preview as any).height.toFixed(1)} mm</>
          )}
          {type === 'conical' && (
            <>Rb {(preview as any).baseRadius.toFixed(1)}  Rt {(preview as any).topRadius.toFixed(1)}  H {(preview as any).height.toFixed(1)} mm</>
          )}
          {type === 'custom' && (
            <>Custom  H {(preview as any).height.toFixed(1)} mm</>
          )}
        </div>
      </Html>
    </group>
  );
};

export default SupportEditOverlay;
