# UI Component Library - Architecture Guide

## Overview

This document defines the reusable UI component architecture for building step-wise CAD applications.

---

## Component Hierarchy

```
@rapidtool/cad-ui
├── primitives/        # Base shadcn components (re-exported)
├── layout/            # Layout components
│   ├── AppShell
│   ├── SplitPane
│   ├── Toolbar
│   └── StatusBar
├── viewport/          # 3D viewport components
│   ├── Viewport
│   ├── ViewCube
│   ├── OrbitControls
│   └── GridSystem
├── wizard/            # Step-wise workflow
│   ├── WizardProvider
│   ├── WizardStep
│   ├── StepIndicator
│   └── StepNavigation
├── panels/            # Panel components
│   ├── AccordionPanel
│   ├── PropertiesPanel
│   ├── TreePanel
│   └── CollapsibleSection
├── transform/         # Transform UI
│   ├── PivotGizmo
│   ├── TransformOverlay
│   └── ConstraintIndicator
├── dialogs/           # Modal components
│   ├── ConfirmDialog
│   ├── FileDialog
│   └── SettingsDialog
└── feedback/          # Feedback components
    ├── LoadingOverlay
    ├── ProgressBar
    └── Toast
```

---

## Wizard System

### WizardProvider

Manages workflow state and navigation.

```typescript
// packages/cad-ui/src/wizard/WizardProvider.tsx

export interface WizardStep {
  id: string;
  label: string;
  icon: React.ComponentType;
  component: React.ComponentType<StepProps>;
  canProceed?: (state: any) => boolean;
  onEnter?: (state: any) => void;
  onExit?: (state: any) => void;
}

export interface WizardConfig {
  steps: WizardStep[];
  initialStep?: string;
  allowSkip?: boolean;
  allowBack?: boolean;
  persistState?: boolean;
}

export interface WizardContextValue {
  // State
  currentStep: string;
  stepIndex: number;
  steps: WizardStep[];
  canGoNext: boolean;
  canGoBack: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  
  // Navigation
  goToStep: (stepId: string) => void;
  goNext: () => void;
  goBack: () => void;
  reset: () => void;
  
  // Step-specific state
  stepState: Record<string, any>;
  setStepState: (stepId: string, state: any) => void;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export const WizardProvider: React.FC<{
  config: WizardConfig;
  children: React.ReactNode;
}> = ({ config, children }) => {
  const [currentStepId, setCurrentStepId] = useState(
    config.initialStep || config.steps[0]?.id
  );
  const [stepState, setStepStateMap] = useState<Record<string, any>>({});
  
  const stepIndex = useMemo(
    () => config.steps.findIndex(s => s.id === currentStepId),
    [config.steps, currentStepId]
  );
  
  const currentStepConfig = config.steps[stepIndex];
  
  const canGoNext = useMemo(() => {
    if (!currentStepConfig?.canProceed) return true;
    return currentStepConfig.canProceed(stepState[currentStepId]);
  }, [currentStepConfig, stepState, currentStepId]);
  
  const goToStep = useCallback((stepId: string) => {
    const targetIndex = config.steps.findIndex(s => s.id === stepId);
    if (targetIndex === -1) return;
    
    // Call onExit for current step
    currentStepConfig?.onExit?.(stepState[currentStepId]);
    
    // Call onEnter for target step
    const targetStep = config.steps[targetIndex];
    targetStep?.onEnter?.(stepState[stepId]);
    
    setCurrentStepId(stepId);
  }, [config.steps, currentStepConfig, stepState, currentStepId]);
  
  const goNext = useCallback(() => {
    if (stepIndex < config.steps.length - 1) {
      goToStep(config.steps[stepIndex + 1].id);
    }
  }, [stepIndex, config.steps, goToStep]);
  
  const goBack = useCallback(() => {
    if (stepIndex > 0 && config.allowBack !== false) {
      goToStep(config.steps[stepIndex - 1].id);
    }
  }, [stepIndex, config.steps, config.allowBack, goToStep]);
  
  const value: WizardContextValue = {
    currentStep: currentStepId,
    stepIndex,
    steps: config.steps,
    canGoNext,
    canGoBack: config.allowBack !== false && stepIndex > 0,
    isFirstStep: stepIndex === 0,
    isLastStep: stepIndex === config.steps.length - 1,
    goToStep,
    goNext,
    goBack,
    reset: () => {
      setCurrentStepId(config.initialStep || config.steps[0]?.id);
      setStepStateMap({});
    },
    stepState,
    setStepState: (stepId, state) => {
      setStepStateMap(prev => ({ ...prev, [stepId]: state }));
    }
  };
  
  return (
    <WizardContext.Provider value={value}>
      {children}
    </WizardContext.Provider>
  );
};

export const useWizard = () => {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within WizardProvider');
  }
  return context;
};
```

### StepIndicator

Visual progress indicator.

```typescript
// packages/cad-ui/src/wizard/StepIndicator.tsx

interface StepIndicatorProps {
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md' | 'lg';
  showLabels?: boolean;
  interactive?: boolean;
  className?: string;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  orientation = 'vertical',
  size = 'md',
  showLabels = true,
  interactive = true,
  className
}) => {
  const { steps, stepIndex, goToStep, canGoBack } = useWizard();
  
  return (
    <div className={cn(
      'flex gap-2',
      orientation === 'vertical' ? 'flex-col' : 'flex-row',
      className
    )}>
      {steps.map((step, index) => {
        const isActive = index === stepIndex;
        const isCompleted = index < stepIndex;
        const isAccessible = interactive && (isCompleted || (canGoBack && index < stepIndex));
        
        return (
          <div
            key={step.id}
            className={cn(
              'flex items-center gap-2',
              isAccessible && 'cursor-pointer hover:opacity-80'
            )}
            onClick={() => isAccessible && goToStep(step.id)}
          >
            <div className={cn(
              'rounded-full flex items-center justify-center',
              sizeClasses[size],
              isActive && 'bg-primary text-primary-foreground',
              isCompleted && 'bg-green-500 text-white',
              !isActive && !isCompleted && 'bg-muted text-muted-foreground'
            )}>
              {isCompleted ? <CheckIcon /> : <step.icon />}
            </div>
            
            {showLabels && (
              <span className={cn(
                'text-sm',
                isActive && 'font-medium',
                !isActive && 'text-muted-foreground'
              )}>
                {step.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
```

---

## Viewport System

### Viewport Component

```typescript
// packages/cad-ui/src/viewport/Viewport.tsx

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';

interface ViewportProps {
  children: React.ReactNode;
  
  // Camera settings
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  
  // Environment settings
  environment?: 'studio' | 'warehouse' | 'sunset' | 'dawn' | 'night';
  shadows?: boolean;
  grid?: boolean;
  
  // Controls
  orbitControls?: boolean;
  viewCube?: boolean;
  
  // Callbacks
  onCreated?: (state: RootState) => void;
  
  className?: string;
}

export const Viewport: React.FC<ViewportProps> = ({
  children,
  cameraPosition = [100, 100, 100],
  cameraFov = 45,
  environment = 'studio',
  shadows = true,
  grid = true,
  orbitControls = true,
  viewCube = true,
  onCreated,
  className
}) => {
  const [orbitControlsRef, setOrbitControlsRef] = useState<OrbitControlsImpl | null>(null);
  
  // Handle orbit controls disable events
  useEffect(() => {
    const handleDisable = (e: CustomEvent<{ disabled: boolean }>) => {
      if (orbitControlsRef) {
        orbitControlsRef.enabled = !e.detail.disabled;
      }
    };
    
    window.addEventListener('disable-orbit-controls', handleDisable as EventListener);
    return () => {
      window.removeEventListener('disable-orbit-controls', handleDisable as EventListener);
    };
  }, [orbitControlsRef]);
  
  return (
    <div className={cn('w-full h-full', className)}>
      <Canvas
        camera={{ position: cameraPosition, fov: cameraFov }}
        shadows={shadows}
        onCreated={(state) => {
          state.gl.setClearColor('#1a1a2e');
          onCreated?.(state);
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
        
        {orbitControls && (
          <OrbitControls
            ref={setOrbitControlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.05}
          />
        )}
        
        {grid && <GridSystem />}
        
        {shadows && (
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.4}
            scale={200}
            blur={2}
          />
        )}
        
        <Environment preset={environment} />
        
        {viewCube && <ViewCube />}
        
        {children}
      </Canvas>
    </div>
  );
};
```

### ViewCube

```typescript
// packages/cad-ui/src/viewport/ViewCube.tsx

import { GizmoHelper, GizmoViewport } from '@react-three/drei';

interface ViewCubeProps {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  size?: number;
}

export const ViewCube: React.FC<ViewCubeProps> = ({
  position = 'top-right',
  size = 80
}) => {
  const alignment = useMemo(() => {
    switch (position) {
      case 'top-left': return 'top-left';
      case 'top-right': return 'top-right';
      case 'bottom-left': return 'bottom-left';
      case 'bottom-right': return 'bottom-right';
    }
  }, [position]);
  
  return (
    <GizmoHelper
      alignment={alignment}
      margin={[size / 2 + 10, size / 2 + 10]}
    >
      <GizmoViewport
        axisHeadScale={0.8}
        labelColor="white"
        axisColors={['#ff4060', '#40ff60', '#4080ff']}
      />
    </GizmoHelper>
  );
};
```

---

## Panel System

### AccordionPanel

```typescript
// packages/cad-ui/src/panels/AccordionPanel.tsx

interface AccordionPanelProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  badge?: string | number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const AccordionPanel: React.FC<AccordionPanelProps> = ({
  title,
  icon: Icon,
  defaultOpen = true,
  badge,
  actions,
  children,
  className
}) => {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? 'content' : undefined}
      className={cn('border rounded-lg', className)}
    >
      <AccordionItem value="content" className="border-0">
        <AccordionTrigger className="px-4 py-3 hover:no-underline">
          <div className="flex items-center gap-2 flex-1">
            {Icon && <Icon className="w-4 h-4" />}
            <span className="font-medium">{title}</span>
            {badge !== undefined && (
              <Badge variant="secondary" className="ml-auto mr-2">
                {badge}
              </Badge>
            )}
          </div>
          {actions && (
            <div 
              className="flex items-center gap-1 mr-2"
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
```

### PropertiesPanel

```typescript
// packages/cad-ui/src/panels/PropertiesPanel.tsx

interface PropertyField {
  key: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'checkbox' | 'slider' | 'color';
  value: any;
  onChange: (value: any) => void;
  options?: { label: string; value: any }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}

interface PropertiesPanelProps {
  title: string;
  fields: PropertyField[];
  className?: string;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  title,
  fields,
  className
}) => {
  return (
    <div className={cn('space-y-4', className)}>
      <h3 className="font-semibold text-sm">{title}</h3>
      
      <div className="space-y-3">
        {fields.map((field) => (
          <PropertyFieldRenderer key={field.key} field={field} />
        ))}
      </div>
    </div>
  );
};

const PropertyFieldRenderer: React.FC<{ field: PropertyField }> = ({ field }) => {
  switch (field.type) {
    case 'number':
      return (
        <div className="flex items-center justify-between">
          <Label className="text-sm">{field.label}</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={field.value}
              onChange={(e) => field.onChange(parseFloat(e.target.value))}
              className="w-20 h-8 text-right"
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={field.disabled}
            />
            {field.unit && (
              <span className="text-xs text-muted-foreground">{field.unit}</span>
            )}
          </div>
        </div>
      );
    
    case 'slider':
      return (
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm">{field.label}</Label>
            <span className="text-sm text-muted-foreground">
              {field.value}{field.unit}
            </span>
          </div>
          <Slider
            value={[field.value]}
            onValueChange={([v]) => field.onChange(v)}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={field.disabled}
          />
        </div>
      );
    
    case 'select':
      return (
        <div className="flex items-center justify-between">
          <Label className="text-sm">{field.label}</Label>
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    
    case 'checkbox':
      return (
        <div className="flex items-center justify-between">
          <Label className="text-sm">{field.label}</Label>
          <Checkbox
            checked={field.value}
            onCheckedChange={field.onChange}
            disabled={field.disabled}
          />
        </div>
      );
    
    default:
      return null;
  }
};
```

---

## Usage Example

```typescript
// Building a CAD application with cad-ui

import {
  WizardProvider,
  StepIndicator,
  Viewport,
  ViewCube,
  AccordionPanel,
  PropertiesPanel,
  PivotGizmo
} from '@rapidtool/cad-ui';

const MyCADApp = () => {
  const wizardConfig = {
    steps: [
      { id: 'import', label: 'Import', icon: Upload, component: ImportStep },
      { id: 'setup', label: 'Setup', icon: Settings, component: SetupStep },
      { id: 'edit', label: 'Edit', icon: Edit, component: EditStep },
      { id: 'export', label: 'Export', icon: Download, component: ExportStep },
    ]
  };
  
  return (
    <WizardProvider config={wizardConfig}>
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className="w-64 border-r p-4">
          <StepIndicator orientation="vertical" />
        </div>
        
        {/* Main content */}
        <div className="flex-1 flex">
          {/* 3D Viewport */}
          <Viewport
            className="flex-1"
            viewCube
            grid
          >
            <MyScene />
          </Viewport>
          
          {/* Properties panel */}
          <div className="w-80 border-l p-4">
            <CurrentStepContent />
          </div>
        </div>
      </div>
    </WizardProvider>
  );
};
```
