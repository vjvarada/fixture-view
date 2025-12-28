/**
 * CSG and geometry building utilities for 3DScene
 */

import * as THREE from 'three';
import type { LabelConfig } from '@/features/labels';

// =============================================================================
// Clamp Support Geometry
// =============================================================================

/**
 * Build a clamp support geometry at origin for CSG operations.
 * This is a simplified version of the ClampSupportMesh geometry creation.
 */
export function buildClampSupportGeometryAtOrigin(
  polygon: Array<[number, number]>,
  height: number,
  cornerRadius: number = 2
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3 || height <= 0) {
    return null;
  }

  // Mirror the Y (which is actually Z in our polygon) coordinates to match the rotation direction
  const workingPolygon: [number, number][] = polygon.map(([x, z]) => [x, -z]);
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

  // Create the extruded body geometry
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { 
    depth: height, 
    bevelEnabled: false, 
    curveSegments: 16 
  });
  
  // Rotate to make Y the up direction (extrusion is along Z by default)
  bodyGeo.rotateX(-Math.PI / 2);
  bodyGeo.computeVertexNormals();
  
  return bodyGeo;
}

// =============================================================================
// Label Geometry
// =============================================================================

/**
 * Build a label geometry for CSG operations.
 * Creates a 3D text geometry positioned and rotated according to the label config.
 */
export async function buildLabelGeometry(label: LabelConfig): Promise<THREE.BufferGeometry | null> {
  console.log('[buildLabelGeometry] Starting for label:', label.id, label.text);
  
  try {
    const { FontLoader } = await import('three/addons/loaders/FontLoader.js');
    const { TextGeometry } = await import('three/addons/geometries/TextGeometry.js');
    
    const fontLoader = new FontLoader();
    const fontFile = label.font === 'roboto' 
      ? '/fonts/roboto_bold.typeface.json'
      : label.font === 'arial'
      ? '/fonts/arial_bold.typeface.json'
      : '/fonts/helvetiker_bold.typeface.json';
    
    return new Promise((resolve) => {
      fontLoader.load(
        fontFile, 
        (font) => {
          try {
            const textGeometry = new TextGeometry(label.text, {
              font: font,
              size: label.fontSize,
              height: label.depth,
              curveSegments: 4,
              bevelEnabled: false,
            });
            
            const posAttr = textGeometry.getAttribute('position');
            if (!posAttr || posAttr.count === 0) {
              console.error('[buildLabelGeometry] TextGeometry has no vertices!');
              resolve(null);
              return;
            }
            
            // Center the text
            textGeometry.computeBoundingBox();
            const bbox = textGeometry.boundingBox;
            if (bbox) {
              const centerX = (bbox.min.x + bbox.max.x) / 2;
              const centerY = (bbox.min.y + bbox.max.y) / 2;
              textGeometry.translate(-centerX, -centerY, 0);
            }
            
            // Apply label position and rotation
            const position = label.position instanceof THREE.Vector3 
              ? label.position 
              : new THREE.Vector3(label.position.x, label.position.y, label.position.z);
            const rotation = label.rotation instanceof THREE.Euler 
              ? label.rotation 
              : new THREE.Euler(label.rotation.x, label.rotation.y, label.rotation.z);
            
            const matrix = new THREE.Matrix4()
              .makeRotationFromEuler(rotation)
              .setPosition(position);
            textGeometry.applyMatrix4(matrix);
            
            textGeometry.computeVertexNormals();
            
            console.log('[buildLabelGeometry] Label geometry ready for:', label.text);
            resolve(textGeometry);
          } catch (err) {
            console.error('[buildLabelGeometry] Error creating TextGeometry:', err);
            resolve(null);
          }
        }, 
        undefined,
        (err) => {
          console.error('[buildLabelGeometry] Failed to load font:', fontFile, err);
          resolve(null);
        }
      );
    });
  } catch (err) {
    console.error('[buildLabelGeometry] Top-level error:', err);
    return null;
  }
}
