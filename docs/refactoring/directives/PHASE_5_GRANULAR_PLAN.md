# Phase 5 Granular Execution Plan

## Overview

Phase 5 has been broken into **micro-steps** that can be tested individually. Each step is:
- **Atomic**: One small change
- **Testable**: Build + manual verification after each step
- **Reversible**: Easy to revert if issues occur

## Current State (Commit 9b12540)

### What's Already Done ✅
1. Extracted modules exist in `src/components/3DScene/`:
   - `hooks/` - 6 state hooks (useSupportState, useClampState, etc.)
   - `utils/` - geometryUtils, colorUtils, csgUtils
   - `renderers/` - ScalableGrid, ModelMesh, DebugVisualization
   - `Scene3DContainer.tsx` - Container with context
   - `types.ts` - TypeScript interfaces
   - `index.ts` - Barrel exports

2. Imports added to 3DScene.tsx with `extracted` prefix (lines 30-54)
3. Original inline code preserved and working

### What's NOT Done Yet ❌
- Inline code NOT replaced with extracted modules
- ~50+ useState hooks still inline in 3DScene.tsx

---

## Phase 5 Micro-Steps

### Step 5.5: Verify Extract/Import Alignment

**Goal**: Ensure extracted hooks match 3DScene.tsx state signatures EXACTLY

**Actions**:
1. Compare each extracted hook's return type with 3DScene.tsx state
2. Document any mismatches
3. Fix mismatches in extracted hooks (not 3DScene.tsx)

**Test**: `npm run build` must pass

**Commit**: `Phase 5.5: Verify hook signatures match`

---

### Step 5.6: Wire Utility Functions (Lowest Risk)

**Goal**: Replace inline utility functions with extracted versions

**Substeps**:

#### 5.6.1: Replace `computeDominantUpQuaternion`
- Location: Lines 75-157 (inline function)
- Replace with: `extractedComputeDominantUpQuaternion`
- Action: 
  1. Comment out inline function
  2. Rename `extractedComputeDominantUpQuaternion` to `computeDominantUpQuaternion` in import
  3. Test
  4. If passes, delete commented code
  
**Test**: Build + verify model orientation still works

#### 5.6.2: Replace `getActualMinYFromMesh`
- Location: Lines 182-219 (inline function)
- Replace with: `extractedGetActualMinYFromMesh`
- Same approach as above

**Test**: Build + verify model sits on baseplate correctly

#### 5.6.3: Replace `getModelColor` and `modelColorPalette`
- Location: Lines 222-243 (inline function + const)
- Replace with: `extractedGetModelColor`, `extractedModelColorPalette`

**Test**: Build + verify models have distinct colors

#### 5.6.4: Replace `buildClampSupportGeometryAtOrigin`
- Location: Lines 251-317 (inline function)
- Replace with: `extractedBuildClampSupportGeometryAtOrigin`

**Test**: Build + verify clamp supports render correctly

**Commit after all 5.6.x**: `Phase 5.6: Wire utility functions`

---

### Step 5.7: Wire Renderer Components

**Goal**: Replace inline JSX with extracted renderer components

**Substeps**:

#### 5.7.1: Replace ScalableGrid
- Find inline grid rendering code
- Replace with `<ExtractedScalableGrid />`
- Ensure props match

**Test**: Build + verify grid renders correctly

#### 5.7.2: Replace DebugPerimeterLine
- Find inline perimeter debug visualization
- Replace with `<ExtractedDebugPerimeterLine />`

**Test**: Build + verify debug visualization (if enabled)

**Commit**: `Phase 5.7: Wire renderer components`

---

### Step 5.8: Wire State Hooks (One at a Time)

**CRITICAL**: Each hook MUST be done separately and tested!

#### 5.8.1: Wire useBaseplateState (Simplest)
**Inline state to replace** (around lines 932-945):
```typescript
const [basePlate, setBasePlate] = useState<BasePlateConfig | null>(null);
const [isMultiSectionDrawingMode, setIsMultiSectionDrawingMode] = useState(false);
const [drawnSections, setDrawnSections] = useState<BasePlateSection[]>([]);
const [multiSectionPadding, setMultiSectionPadding] = useState(0);
const [baseTopY, setBaseTopY] = useState<number>(0);
const [selectedBasePlateSectionId, setSelectedBasePlateSectionId] = useState<string | null>(null);
const [editingBasePlateSectionId, setEditingBasePlateSectionId] = useState<string | null>(null);
const [waitingForSectionSelection, setWaitingForSectionSelection] = useState(false);
```

**Replace with**:
```typescript
const baseplateState = useBaseplateState();
const { 
  basePlate, setBasePlate,
  isMultiSectionDrawingMode, setIsMultiSectionDrawingMode,
  drawnSections, setDrawnSections,
  multiSectionPadding, setMultiSectionPadding,
  baseTopY, setBaseTopY,
  selectedBasePlateSectionId, setSelectedBasePlateSectionId,
  editingBasePlateSectionId, setEditingBasePlateSectionId,
  waitingForSectionSelection, setWaitingForSectionSelection,
} = baseplateState;
```

**Test**: 
- Build passes
- Can create baseplate
- Can draw multi-section baseplate
- Sections selectable

**Commit**: `Phase 5.8.1: Wire useBaseplateState hook`

---

#### 5.8.2: Wire useHoleState
**Inline state to replace** (around lines 1166-1191):
```typescript
const [mountingHoles, setMountingHoles] = useState<PlacedHole[]>([]);
const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null);
const [editingHoleId, setEditingHoleId] = useState<string | null>(null);
const [isDraggingHole, setIsDraggingHole] = useState(false);
const [holePlacementMode, setHolePlacementMode] = useState<{...}>(...)
const [holeSnapEnabled, setHoleSnapEnabled] = useState(true);
const [waitingForHoleSectionSelection, setWaitingForHoleSectionSelection] = useState(false);
const [pendingHoleConfig, setPendingHoleConfig] = useState<{...} | null>(null);
```

**Test**:
- Build passes
- Can place holes on baseplate
- Holes are selectable/draggable
- Snap alignment works

**Commit**: `Phase 5.8.2: Wire useHoleState hook`

---

#### 5.8.3: Wire useLabelState
**Inline state to replace** (around lines 1099-1100, 1188, 1190):
```typescript
const [labels, setLabels] = useState<LabelConfig[]>([]);
const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
const [waitingForLabelSectionSelection, setWaitingForLabelSectionSelection] = useState(false);
const [pendingLabelConfig, setPendingLabelConfig] = useState<LabelConfig | null>(null);
```

**Test**:
- Build passes
- Can add labels
- Labels render correctly
- Labels selectable/draggable

**Commit**: `Phase 5.8.3: Wire useLabelState hook`

---

#### 5.8.4: Wire useSupportState
**Inline state to replace** (around lines 1093-1096, 1194):
```typescript
const [placing, setPlacing] = useState<{ active: boolean; type: SupportType | null; initParams?: Record<string, number> }>({ active: false, type: null });
const [supports, setSupports] = useState<AnySupport[]>([]);
const [supportsTrimPreview, setSupportsTrimPreview] = useState<THREE.Mesh[]>([]);
const [supportsTrimProcessing, setSupportsTrimProcessing] = useState(false);
const [supportSnapEnabled, setSupportSnapEnabled] = useState(true);
// Plus refs: isDraggingSupportRef, editingSupportRef
```

**Test**:
- Build passes
- Can place supports
- Supports draggable
- Trim preview works

**Commit**: `Phase 5.8.4: Wire useSupportState hook`

---

#### 5.8.5: Wire useClampState (Most Complex)
**Inline state to replace** (around lines 1112-1163):
```typescript
const [placedClamps, setPlacedClamps] = useState<PlacedClamp[]>([]);
const [selectedClampId, setSelectedClampId] = useState<string | null>(null);
const [showClampDebug, setShowClampDebug] = useState(false);
const [clampMinOffsets, setClampMinOffsets] = useState<Map<string, number>>(new Map());
const [clampSupportInfos, setClampSupportInfos] = useState<Map<string, {...}>>(new Map());
const [clampDebugPoints, setClampDebugPoints] = useState<{...}>({...});
const [clampPlacementMode, setClampPlacementMode] = useState<{...}>({...});
const [debugPerimeter, setDebugPerimeter] = useState<Array<...> | null>(null);
const [debugClampSilhouette, setDebugClampSilhouette] = useState<Array<...> | null>(null);
const [waitingForClampSectionSelection, setWaitingForClampSectionSelection] = useState(false);
```

**Test**:
- Build passes
- Can place clamps
- Clamps auto-position on edges
- Debug visualization works

**Commit**: `Phase 5.8.5: Wire useClampState hook`

---

#### 5.8.6: Wire useSceneState (Largest)
**Inline state to replace** (scattered throughout):
```typescript
const [placedComponents, setPlacedComponents] = useState<...>([]);
const [selectedComponent, setSelectedComponent] = useState<...>(null);
const [modelDimensions, setModelDimensions] = useState<...>(undefined);
const [orbitControlsEnabled, setOrbitControlsEnabled] = useState(true);
const [modelColors, setModelColors] = useState<Map<...>>(new Map());
const [modelBounds, setModelBounds] = useState<BoundsSummary | null>(null);
const [partBounds, setPartBounds] = useState<Map<...>>(new Map());
const [currentOrientation, setCurrentOrientation] = useState<ViewOrientation>('iso');
const [modelTransform, setModelTransform] = useState({...});
const [liveTransform, setLiveTransform] = useState<...>(null);
const [itemBoundsUpdateTrigger, setItemBoundsUpdateTrigger] = useState(0);
const [isDraggingAnyItem, setIsDraggingAnyItem] = useState(false);
const [cavityPreview, setCavityPreview] = useState<THREE.Mesh | null>(null);
const [offsetMeshPreviews, setOffsetMeshPreviews] = useState<Map<...>>(new Map());
const [offsetMeshProcessing, setOffsetMeshProcessing] = useState(false);
const [showOffsetPreview, setShowOffsetPreview] = useState(true);
```

**Test**:
- Build passes
- Models import and display
- Transform controls work
- CSG operations work

**Commit**: `Phase 5.8.6: Wire useSceneState hook`

---

## Verification Checklist

After completing ALL Phase 5 steps, verify:

### Core Features
- [ ] Import STL file
- [ ] Model renders with correct orientation
- [ ] Model has correct color
- [ ] Transform gizmo works (translate/rotate)

### Baseplate
- [ ] Add simple baseplate
- [ ] Draw multi-section baseplate
- [ ] Section selection works
- [ ] Baseplate transform works

### Supports
- [ ] Place support on model
- [ ] Support dragging works
- [ ] Support snap alignment works
- [ ] Trim preview works

### Clamps
- [ ] Place clamp on perimeter
- [ ] Clamp auto-rotation works
- [ ] Clamp support geometry renders
- [ ] Debug visualization (when enabled)

### Holes
- [ ] Add mounting hole
- [ ] Hole placement on baseplate
- [ ] Hole snap alignment
- [ ] Multiple hole patterns

### Labels
- [ ] Add label
- [ ] Label renders with text
- [ ] Label position/rotation works

### Export
- [ ] CSG merge generates valid geometry
- [ ] Export STL works

---

## Rollback Strategy

If ANY step fails:

1. **Immediate**: `git checkout -- .` to discard changes
2. **After commit**: `git reset --hard HEAD~1` to undo last commit
3. **Multiple commits**: `git reset --hard 9b12540` to return to known-good state

---

## Timeline Estimate

| Step | Estimated Time | Risk |
|------|----------------|------|
| 5.5 Verify signatures | 30 min | 🟢 Low |
| 5.6 Wire utilities | 45 min | 🟢 Low |
| 5.7 Wire renderers | 30 min | 🟡 Medium |
| 5.8.1 useBaseplateState | 30 min | 🟡 Medium |
| 5.8.2 useHoleState | 30 min | 🟡 Medium |
| 5.8.3 useLabelState | 20 min | 🟡 Medium |
| 5.8.4 useSupportState | 30 min | 🟡 Medium |
| 5.8.5 useClampState | 45 min | 🔴 High |
| 5.8.6 useSceneState | 60 min | 🔴 High |

**Total: ~5-6 hours** (with testing)

---

*Created: December 29, 2025*
*Known-good commit: 9b12540*
