import { useState, useCallback } from 'react';
import * as THREE from 'three';
import { ProcessedFile, FileMetadata, SUPPORTED_FORMATS } from '../types';

interface UseFileProcessingReturn {
  processFile: (file: File, units?: string) => Promise<ProcessedFile>;
  isProcessing: boolean;
  error: string | null;
  clearError: () => void;
}

export function useFileProcessing(): UseFileProcessingReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const getUnitScale = (units: string): number => {
    switch (units) {
      case 'mm':
        return 1; // Base unit is mm
      case 'cm':
        return 10; // 1 cm = 10 mm
      case 'inch':
        return 25.4; // 1 inch = 25.4 mm
      default:
        return 1;
    }
  };

  const validateFile = (file: File): void => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_FORMATS.includes(extension)) {
      throw new Error(`Unsupported file format: ${extension}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
    }

    // Check file size (max 100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      throw new Error('File too large. Maximum size is 100MB.');
    }
  };

  const parseSTL = async (arrayBuffer: ArrayBuffer): Promise<THREE.BufferGeometry> => {
    const byteLength = arrayBuffer.byteLength;
    console.log('Parsing STL file, byteLength:', byteLength);

    if (byteLength > 84) {
      const view = new DataView(arrayBuffer);
      const triangleCount = view.getUint32(80, true);
      const expectedByteLength = 84 + triangleCount * 50;

      const headerText = new TextDecoder().decode(new Uint8Array(arrayBuffer, 0, 80)).trim().toLowerCase();
      const headerSuggestsASCII = headerText.startsWith('solid');

      console.log('STL Header:', headerText.substring(0, 50));
      console.log('Triangle count from header:', triangleCount);
      console.log('Expected byte length:', expectedByteLength);
      console.log('Actual byte length:', byteLength);
      console.log('Header suggests ASCII:', headerSuggestsASCII);

      // Better binary detection: check if the expected length matches actual length
      // Binary files have a predictable size based on triangle count
      const isBinaryBySize = Math.abs(expectedByteLength - byteLength) < 100 && triangleCount > 0;
      
      // If the size matches binary format, treat as binary even if header starts with "solid"
      if (isBinaryBySize) {
        console.log('Parsing as binary STL (size matches binary format)');
        return parseBinarySTL(arrayBuffer, triangleCount);
      }
      
      // If header doesn't suggest ASCII and we have valid triangle count, try binary
      if (!headerSuggestsASCII && triangleCount > 0) {
        console.log('Parsing as binary STL (header does not suggest ASCII)');
        return parseBinarySTL(arrayBuffer, triangleCount);
      }
    }

    console.log('Parsing as ASCII STL');
    return parseASCIISTL(new TextDecoder().decode(arrayBuffer));
  };

  const parseBinarySTL = (arrayBuffer: ArrayBuffer, triangleCountFromHeader?: number): THREE.BufferGeometry => {
    const view = new DataView(arrayBuffer);
    const triangleCount = triangleCountFromHeader ?? view.getUint32(80, true);
    const expectedByteLength = 84 + triangleCount * 50;

    if (expectedByteLength > arrayBuffer.byteLength) {
      throw new Error('Binary STL data is incomplete or corrupted.');
    }

    const vertices: number[] = [];
    const normals: number[] = [];
    
    let offset = 84; // Skip header (80 bytes) + triangle count (4 bytes)
    
    for (let i = 0; i < triangleCount; i++) {
      if (offset + 50 > arrayBuffer.byteLength) {
        throw new Error('Unexpected end of binary STL data while reading triangles.');
      }

      // Normal vector (3 floats)
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      offset += 12;
      
      // Three vertices (9 floats total)
      for (let j = 0; j < 3; j++) {
        const vx = view.getFloat32(offset, true);
        const vy = view.getFloat32(offset + 4, true);
        const vz = view.getFloat32(offset + 8, true);
        offset += 12;
        
        vertices.push(vx, vy, vz);
        normals.push(nx, ny, nz);
      }
      
      // Skip attribute byte count (2 bytes)
      offset += 2;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    
    return geometry;
  };

  const parseASCIISTL = (text: string): THREE.BufferGeometry => {
    const vertices: number[] = [];
    const normals: number[] = [];
    
    const lines = text.split('\n');
    let currentNormal: number[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('facet normal')) {
        const parts = trimmed.split(/\s+/);
        currentNormal = [
          parseFloat(parts[2]) || 0,
          parseFloat(parts[3]) || 0,
          parseFloat(parts[4]) || 0
        ];
      } else if (trimmed.startsWith('vertex')) {
        const parts = trimmed.split(/\s+/);
        vertices.push(
          parseFloat(parts[1]) || 0,
          parseFloat(parts[2]) || 0,
          parseFloat(parts[3]) || 0
        );
        normals.push(...currentNormal);
      }
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    
    return geometry;
  };

  const computeMetadata = (geometry: THREE.BufferGeometry, file: File, processingTime: number, units: string): FileMetadata => {
    // Compute bounding box
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox!;

    // Get dimensions and center
    const dimensions = new THREE.Vector3();
    boundingBox.getSize(dimensions);

    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    // Count triangles
    const positionAttribute = geometry.getAttribute('position');
    const triangles = positionAttribute.count / 3;

    return {
      name: file.name,
      size: file.size,
      triangles: Math.floor(triangles),
      boundingBox,
      dimensions,
      center,
      processingTime,
      units
    };
  };

  const processFile = useCallback(async (file: File, units: string = 'mm'): Promise<ProcessedFile> => {
    const startTime = performance.now();
    
    try {
      setIsProcessing(true);
      setError(null);
      
      // Validate file
      validateFile(file);
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Parse geometry based on file type
      let geometry: THREE.BufferGeometry;
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      
      switch (extension) {
        case '.stl':
          geometry = await parseSTL(arrayBuffer);
          break;
        default:
          throw new Error(`Parser for ${extension} not yet implemented`);
      }
      
      // Apply unit scaling - but keep models at their original scale for now
      // We'll scale the grid and axes instead
      // const scale = getUnitScale(units);
      // geometry.scale(scale, scale, scale);
      
      // Rotate geometry so Z is up (STL files often use Y-up convention)
      // Rotate -90 degrees around X axis to convert from Y-up to Z-up
      geometry.rotateX(-Math.PI / 2);

      // Ensure we have normals
      if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
      }

      if (typeof (geometry as any).computeBoundsTree === 'function') {
        geometry.computeBoundsTree();
      }

      // Create material and mesh
      const material = new THREE.MeshStandardMaterial({
        color: 0xb0b0b0, // Neutral gray
        roughness: 0.6,
        metalness: 0.0,
        side: THREE.DoubleSide, // Render both front and back faces
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      console.log('Mesh created successfully:');
      console.log('- Geometry vertices:', geometry.attributes.position.count);
      console.log('- Geometry faces:', geometry.attributes.position.count / 3);
      console.log('- Material:', material);
      console.log('- Mesh:', mesh);

      // Compute metadata
      const processingTime = performance.now() - startTime;
      const metadata = computeMetadata(geometry, file, processingTime, units);

      // Generate unique ID for multi-part support
      const id = `part-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      return { id, mesh, metadata };
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error creating mesh:', err);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    processFile,
    isProcessing,
    error,
    clearError,
  };
}
