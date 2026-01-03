# Documentation

This folder contains architectural and development documentation for the RapidTool Fixture View application.

## For AI Coding Agents

**Start here in this order:**

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture, layers, state management, and critical systems
2. **[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** - How to add features, modify code, and follow patterns
3. **[COORDINATE_SYSTEM.md](./COORDINATE_SYSTEM.md)** - 3D coordinate system handling (read if working with transforms)

## Quick Reference

| I want to... | Read... |
|--------------|---------|
| Understand the codebase structure | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Add a new feature | [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) |
| Work with 3D transforms | [COORDINATE_SYSTEM.md](./COORDINATE_SYSTEM.md) |
| Find where state lives | [ARCHITECTURE.md#state-management](./ARCHITECTURE.md#5-state-management) |
| Understand hook patterns | [ARCHITECTURE.md#3dscene-hook-architecture](./ARCHITECTURE.md#4-3dscene-hook-architecture) |
| Avoid common mistakes | [DEVELOPMENT_GUIDE.md#common-mistakes](./DEVELOPMENT_GUIDE.md#8-common-mistakes-to-avoid) |

## Key Architecture Decisions

1. **Three-layer architecture**: Application → UI Library → Core Logic
2. **Hook-based decomposition**: 3DScene uses specialized hooks for state, handlers, and operations
3. **Event-based communication**: Custom events for cross-component 3D operations
4. **Zustand stores**: Global state with backward-compatible hook wrappers

## Critical Files

| File | Purpose | Risk Level |
|------|---------|------------|
| `src/components/3DScene.tsx` | Main 3D scene | 🔴 HIGH |
| `src/layout/AppShell.tsx` | App orchestration | 🔴 HIGH |
| `packages/cad-core/src/mesh/meshAnalysis.ts` | Mesh processing | 🔴 HIGH |
| `packages/cad-core/src/offset/offsetHeightmap.ts` | Cavity generation | 🔴 HIGH |

---

*Last updated: January 1, 2026*
