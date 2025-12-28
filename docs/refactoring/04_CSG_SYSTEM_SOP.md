# CSG System - Standard Operating Procedure

## Overview

This SOP defines how to consolidate and standardize the CSG (Constructive Solid Geometry) operations used throughout the application.

---

## Current State

### Multiple CSG Implementations

| File | Purpose | Engine | Lines |
|------|---------|--------|-------|
| `lib/csgEngine.ts` | Main CSG engine | three-bvh-csg | 467 |
| `lib/cadOperations.ts` | CAD operations wrapper | Mixed | ~200 |
| `components/CSGOperations.tsx` | CSG panel UI + logic | three-bvh-csg | 404 |
| `components/BooleanOperations.tsx` | Boolean UI | N/A | 273 |
| `lib/offset/index.ts` | Offset mesh + CSG | manifold-3d | ~300 |
| `lib/workers/` | Worker-based CSG | three-bvh-csg | ~500 |

### Issues

1. **Duplicate Logic**: CSG operations implemented in multiple places
2. **Mixed Engines**: Both `three-bvh-csg` and `manifold-3d` used
3. **Inconsistent API**: Different interfaces for same operations
4. **No Caching**: Results computed multiple times
5. **Worker Complexity**: Worker pool management scattered

---

## Target Architecture

### Core CSG Module

```typescript
// packages/cad-core/src/csg/index.ts

export { CSGEngine } from './CSGEngine';
export { BooleanOperations, BooleanOperation } from './BooleanOperations';
export { CSGWorkerPool } from './WorkerPool';
export { CSGCache } from './Cache';
export * from './types';
```

### Unified CSG Engine

```typescript
// packages/cad-core/src/csg/CSGEngine.ts

import { Evaluator, Brush, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import * as THREE from 'three';

export type CSGOperationType = 'union' | 'subtract' | 'intersect';

export interface CSGOperationConfig {
  type: CSGOperationType;
  target: THREE.Mesh;
  tools: THREE.Mesh[];
  options?: {
    depth?: number;          // Sweep depth for subtraction
    offset?: number;         // Tool inflation amount
    direction?: THREE.Vector3; // Sweep direction
    useWorker?: boolean;     // Offload to worker
  };
}

export interface CSGResult {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  operationTime: number;
  triangleCount: number;
}

export class CSGEngine {
  private evaluator: Evaluator;
  private cache: Map<string, CSGResult>;
  
  constructor() {
    this.evaluator = new Evaluator();
    this.cache = new Map();
  }
  
  /**
   * Execute a CSG operation
   */
  async execute(config: CSGOperationConfig): Promise<CSGResult> {
    const cacheKey = this.generateCacheKey(config);
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    const startTime = performance.now();
    
    // Prepare geometries
    const targetBrush = this.prepareBrush(config.target);
    const toolBrushes = config.tools.map(t => this.prepareBrush(t, config.options?.offset));
    
    // Execute operation
    let result: Brush;
    switch (config.type) {
      case 'union':
        result = this.executeUnion(targetBrush, toolBrushes);
        break;
      case 'subtract':
        result = this.executeSubtract(targetBrush, toolBrushes, config.options);
        break;
      case 'intersect':
        result = this.executeIntersect(targetBrush, toolBrushes);
        break;
    }
    
    // Finalize result
    const resultMesh = this.finalizeMesh(result, config.target);
    const operationTime = performance.now() - startTime;
    
    const csgResult: CSGResult = {
      mesh: resultMesh,
      geometry: resultMesh.geometry,
      operationTime,
      triangleCount: resultMesh.geometry.index?.count ?? 0 / 3
    };
    
    // Cache result
    this.cache.set(cacheKey, csgResult);
    
    return csgResult;
  }
  
  /**
   * Subtract with sweep (for fixture negatives)
   */
  private executeSubtract(
    target: Brush, 
    tools: Brush[], 
    options?: CSGOperationConfig['options']
  ): Brush {
    let result = target;
    
    for (const tool of tools) {
      if (options?.depth && options?.direction) {
        // Build swept brushes for accurate subtraction
        const sweptBrushes = this.buildSweptBrushes(
          tool.geometry, 
          options.direction, 
          options.depth
        );
        
        for (const swept of sweptBrushes) {
          result = this.evaluator.evaluate(result, swept, SUBTRACTION);
        }
      } else {
        result = this.evaluator.evaluate(result, tool, SUBTRACTION);
      }
    }
    
    return result;
  }
  
  /**
   * Build swept volume for accurate tool subtraction
   */
  private buildSweptBrushes(
    geometry: THREE.BufferGeometry,
    direction: THREE.Vector3,
    depth: number
  ): Brush[] {
    const brushes: Brush[] = [];
    const dir = direction.clone().normalize();
    
    const maxSegments = 8;
    const minSegmentLength = 0.5;
    const segments = Math.min(maxSegments, Math.ceil(depth / minSegmentLength));
    
    for (let i = 0; i <= segments; i++) {
      const t = (depth * i) / segments;
      const swept = geometry.clone();
      swept.applyMatrix4(
        new THREE.Matrix4().makeTranslation(
          dir.x * t, 
          dir.y * t, 
          dir.z * t
        )
      );
      brushes.push(new Brush(swept));
    }
    
    return brushes;
  }
  
  /**
   * Ensure geometry has required attributes
   */
  private prepareBrush(mesh: THREE.Mesh, offset?: number): Brush {
    const geometry = this.cloneWorldGeometry(mesh);
    
    // Ensure UVs exist
    this.ensureUVs(geometry);
    
    // Apply offset if needed
    if (offset) {
      this.inflateGeometry(geometry, offset);
    }
    
    return new Brush(geometry);
  }
  
  // ... helper methods from existing csgEngine.ts
}
```

---

## Worker Pool Architecture

```typescript
// packages/cad-core/src/csg/WorkerPool.ts

export class CSGWorkerPool {
  private workers: Worker[] = [];
  private taskQueue: CSGTask[] = [];
  private maxWorkers: number;
  
  constructor(maxWorkers = navigator.hardwareConcurrency || 4) {
    this.maxWorkers = maxWorkers;
  }
  
  async executeAsync(config: CSGOperationConfig): Promise<CSGResult> {
    return new Promise((resolve, reject) => {
      const task: CSGTask = {
        config,
        resolve,
        reject
      };
      
      this.taskQueue.push(task);
      this.processQueue();
    });
  }
  
  /**
   * Execute batch operations in parallel
   */
  async executeBatch(configs: CSGOperationConfig[]): Promise<CSGResult[]> {
    return Promise.all(configs.map(c => this.executeAsync(c)));
  }
  
  private processQueue() {
    while (
      this.taskQueue.length > 0 && 
      this.workers.length < this.maxWorkers
    ) {
      const task = this.taskQueue.shift()!;
      this.executeInWorker(task);
    }
  }
  
  private executeInWorker(task: CSGTask) {
    const worker = new Worker(
      new URL('./csg.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    this.workers.push(worker);
    
    worker.onmessage = (e) => {
      task.resolve(e.data);
      this.releaseWorker(worker);
    };
    
    worker.onerror = (e) => {
      task.reject(e);
      this.releaseWorker(worker);
    };
    
    // Serialize and send task
    worker.postMessage(this.serializeTask(task));
  }
  
  private releaseWorker(worker: Worker) {
    const index = this.workers.indexOf(worker);
    if (index !== -1) {
      this.workers.splice(index, 1);
      worker.terminate();
    }
    this.processQueue();
  }
}
```

---

## Operation Presets

### Cavity Subtraction (Fixture Negative)

```typescript
export const CAVITY_PRESET: Partial<CSGOperationConfig> = {
  type: 'subtract',
  options: {
    depth: 10,
    offset: 0.1,  // Small clearance
    direction: new THREE.Vector3(0, -1, 0),  // Down
  }
};
```

### Hole Subtraction

```typescript
export const HOLE_PRESET: Partial<CSGOperationConfig> = {
  type: 'subtract',
  options: {
    depth: 50,  // Through hole
    offset: 0,
    direction: new THREE.Vector3(0, -1, 0),
  }
};
```

### Support Union (Combining multiple supports)

```typescript
export const SUPPORT_UNION_PRESET: Partial<CSGOperationConfig> = {
  type: 'union',
  options: {
    useWorker: true,  // Large operations
  }
};
```

---

## React Hook

```typescript
// packages/cad-ui/src/hooks/useCSG.ts

import { CSGEngine, CSGOperationConfig, CSGResult } from '@rapidtool/cad-core';

interface UseCSGOptions {
  useWorker?: boolean;
  cacheResults?: boolean;
}

export function useCSG(options: UseCSGOptions = {}) {
  const engine = useRef(new CSGEngine());
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  
  const execute = useCallback(async (config: CSGOperationConfig): Promise<CSGResult | null> => {
    setIsProcessing(true);
    setProgress(0);
    setError(null);
    
    try {
      const result = await engine.current.execute({
        ...config,
        options: {
          ...config.options,
          useWorker: options.useWorker
        }
      });
      
      setProgress(100);
      return result;
    } catch (err) {
      setError(err as Error);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [options.useWorker]);
  
  const executeBatch = useCallback(async (
    configs: CSGOperationConfig[]
  ): Promise<CSGResult[]> => {
    setIsProcessing(true);
    setProgress(0);
    
    const results: CSGResult[] = [];
    
    for (let i = 0; i < configs.length; i++) {
      const result = await execute(configs[i]);
      if (result) results.push(result);
      setProgress(((i + 1) / configs.length) * 100);
    }
    
    setIsProcessing(false);
    return results;
  }, [execute]);
  
  return {
    execute,
    executeBatch,
    isProcessing,
    progress,
    error,
    clearError: () => setError(null)
  };
}
```

---

## Migration Steps

### Step 1: Create Core CSG Module

1. Create `packages/cad-core/src/csg/`
2. Port `CSGEngine` from `lib/csgEngine.ts`
3. Add caching layer
4. Add worker pool support
5. Create presets

### Step 2: Update 3DScene.tsx

Replace direct CSG calls with hook usage:

```typescript
// Before
const csgEngine = new CSGEngine();
const result = csgEngine.createNegativeSpace(baseMesh, fixtures);

// After
const { execute } = useCSG();
const result = await execute({
  type: 'subtract',
  target: baseMesh,
  tools: fixtures,
  ...CAVITY_PRESET
});
```

### Step 3: Consolidate UI Components

1. Remove `BooleanOperations.tsx`
2. Simplify `CSGOperations.tsx` to use hook
3. Update cavity step to use new system

### Step 4: Cleanup

1. Delete redundant CSG files
2. Update all imports
3. Test all CSG operations

---

## Testing Checklist

- [ ] Simple union works
- [ ] Simple subtraction works
- [ ] Simple intersection works
- [ ] Swept subtraction works (cavity)
- [ ] Hole subtraction works
- [ ] Multiple tool operations work
- [ ] Worker pool processes correctly
- [ ] Cache returns cached results
- [ ] Progress reporting works
- [ ] Error handling works
- [ ] Large mesh operations don't freeze UI
