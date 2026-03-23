## 1. Project Setup (TresJS → Hybrid Three.js)

- [x] 1.1 Initialize Vue3 + Vite + JavaScript project (already existed)
- [x] 1.2 Install TresJS packages (`@tresjs/core`, `@tresjs/cientos`, `@tresjs/post-processing`) + Three.js
- [x] 1.3 Configure Vite for Vue3 + TresJS
- [x] 1.4 Create base project structure (components, composables, assets)

## 2. Data Parsing

- [x] 2.1 Load and parse `city.json` from `src/json/`
- [x] 2.2 Create data parser function for raw city.json format
- [x] 2.3 Transform raw station coordinates (grid to 3D position)
- [x] 2.4 Filter and group stations by line (初始只处理1号线和2号线)

## 3. 3D Scene Components (Hybrid TresJS + Three.js)

- [x] 3.1 Create `SubwayScene.vue` component with TresCanvas wrapper
- [x] 3.2 Configure camera and OrbitControls
- [x] 3.3 Setup Three.js scene (ground, grid, lighting, starfield)
- [x] 3.4 Implement line rendering with TubeGeometry + breathing animation
- [x] 3.5 Implement station markers with glow effects
- [x] 3.6 Implement station name labels with CanvasTexture sprites
- [x] 3.7 Implement station breathing pulse effect (亮度/透明度同步呼吸)

## 4. Train Particle Assembly Animation

- [x] 4.1 Create particle initial state (能量球形态 - 300 particles)
- [x] 4.2 Implement Phase 1 animation (粒子随机漂浮 + 能量球脉动)
- [x] 4.3 Implement Phase 2 animation (0.5-2s: 粒子凝聚砸向目标)
- [x] 4.4 Transition from particle to solid train mesh
- [x] 4.5 Energy ball shrink and disappear during assembly

## 5. Train Movement Animation

- [x] 5.1 Implement train position interpolation along CatmullRomCurve3
- [x] 5.2 Add multiple trains per line with different speeds
- [x] 5.3 Implement train wrapping (t=1 → t=0)
- [x] 5.4 Add train rotation to follow curve direction

## 6. Camera Controls

- [x] 6.1 Configure OrbitControls with smooth damping
- [x] 6.2 Set initial camera position to view full map
- [x] 6.3 Add zoom limits and pan constraints

## 7. Integration and Polish

- [x] 7.1 Integrate all components in App.vue
- [x] 7.2 Add responsive canvas sizing
- [x] 7.3 Add cyberpunk HUD (legend, stats, corners)
- [x] 7.4 Sync breathing lines effect
- [x] 7.5 Add scanline overlay effect
- [x] 7.6 Verify full animation loop works correctly

## Pending (Future Enhancement)

- [ ] 8.1 Integrate @tresjs/post-processing for UnrealBloom
- [ ] 8.2 Add HolographicMaterial for enhanced cyberpunk aesthetic
- [ ] 8.3 Energy trail particles around moving train
