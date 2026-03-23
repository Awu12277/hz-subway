<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import cityData from '../json/city.json'
import { parseCityData, computeBounds } from '../utils/subwayData.js'

// ─── 数据解析 (显示所有线路) ───────────────────────────────
const parsed = parseCityData(cityData)
const subwayLines = ref(parsed.lines)
const bounds = computeBounds(parsed.lines)

// ─── Refs ───────────────────────────────────────────────────
const containerRef = ref(null)

// ─── 场景状态 ───────────────────────────────────────────────
let scene, camera, renderer, orbitCtrl, animationId
let composer, bloomEffect

// ─── 相机飞行状态 ─────────────────────────────────────────
let flyTarget = null
let flyStartPos = null
let flyEndPos = null
let flyStartTarget = null
let flyEndTarget = null
let flyProgress = 0
const FLY_DURATION = 1500 // 飞行时间 ms

// ─── 对象池 (避免每帧创建新对象) ───────────────────────────
const stationObjects = [] // { core, ring, ring2, glow, materials }
const trainObjects = [] // { mesh, userData }
const lineObjects = [] // { lineMat1, lineMat2, glowMat }

// ─── 粒子系统 ───────────────────────────────────────────────
const PARTICLE_COUNT = 300
let particlePoints = null
let particlePositions = null
let particleVelocities = null
let energyBall = null
const trainAssembleState = ref('particles')
const assembleStartTime = ref(null)

// ─── 线路选择 ─────────────────────────────────────────────
const selectedLine = ref(null) // null = 全选

function selectLine(lineName) {
  if (selectedLine.value === lineName) {
    selectedLine.value = null // 取消选择，显示全部
  } else {
    selectedLine.value = lineName
    // 飞向选中线路的第一个站点
    flyToFirstStation(lineName)
  }
}

// ─── 相机飞行 ─────────────────────────────────────────────
function flyToFirstStation(lineName) {
  const line = subwayLines.value.find(l => l.name === lineName)
  if (!line || line.stations.length === 0) return

  const station = line.stations[0]
  const pos = station.position
  const offsetDist = bounds.size * 0.3

  // 记录飞行起点
  flyStartPos = camera.position.clone()
  flyStartTarget = orbitCtrl.target.clone()

  // 计算目标位置
  flyEndPos = new THREE.Vector3(pos.x, offsetDist * 0.8, pos.z + offsetDist * 0.5)
  flyEndTarget = new THREE.Vector3(pos.x, 0, pos.z)

  flyProgress = 0
  orbitCtrl.enabled = false // 飞行时禁用控制
}

// ─── 缓动函数 ─────────────────────────────────────────────
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

// ─── 更新相机飞行 ─────────────────────────────────────────
function updateFlyCamera(delta) {
  if (flyProgress >= 1 || !flyStartPos || !flyEndPos) return

  flyProgress += delta / (FLY_DURATION / 1000)
  if (flyProgress > 1) flyProgress = 1

  const t = easeOutCubic(flyProgress)

  // 插值位置
  camera.position.lerpVectors(flyStartPos, flyEndPos, t)

  // 插值目标点
  orbitCtrl.target.lerpVectors(flyStartTarget, flyEndTarget, t)

  if (flyProgress >= 1) {
    orbitCtrl.enabled = true
    flyStartPos = null
    flyEndPos = null
    flyStartTarget = null
    flyEndTarget = null
  }
}

// ─── 预计算常量 ─────────────────────────────────────────────
const BREATH_DURATION = 3000
const TWO_PI = Math.PI * 2

// ─── 线路颜色 (使用原始数据颜色) ───────────────────────────
function getLineColor(lineData) {
  return lineData.colorInt || 0x00ffff
}

// ─── 预创建几何体 (复用) ───────────────────────────────────
const octahedronGeo = new THREE.OctahedronGeometry(5, 0)
const torusGeo = new THREE.TorusGeometry(10, 1.2, 8, 24)
const torus2Geo = new THREE.TorusGeometry(14, 0.6, 8, 24)
const sphereGeo = new THREE.SphereGeometry(16, 12, 12)

// ─── 预创建材质工厂 ─────────────────────────────────────────
function createStationMaterials(colorInt) {
  return {
    coreMat: new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 1 }),
    innerMat: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    ringMat: new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }),
    ring2Mat: new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }),
    glowMat: new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.08, side: THREE.BackSide, blending: THREE.AdditiveBlending })
  }
}

// ─── 预创建线条材质 ─────────────────────────────────────────
function createLineMaterials(colorInt) {
  return {
    lineMat1: new THREE.LineDashedMaterial({ color: colorInt, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
    lineMat2: new THREE.LineDashedMaterial({ color: colorInt, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
    glowMat: new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.12, side: THREE.BackSide, blending: THREE.AdditiveBlending })
  }
}

// ─── 构建地铁线路 ─────────────────────────────────────────
function buildSubwayLines() {
  for (const lineData of subwayLines.value) {
    if (lineData.stations.length < 2) continue

    const colorInt = getLineColor(lineData)
    const points = lineData.stations.map(s => new THREE.Vector3(s.position.x, s.position.y, s.position.z))
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)

    // 双虚线
    const linePoints = curve.getPoints(200)
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints)

    const mats = createLineMaterials(colorInt)

    const line1 = new THREE.Line(lineGeometry.clone(), mats.lineMat1)
    line1.position.y = 0.5
    line1.computeLineDistances()
    scene.add(line1)

    const line2 = new THREE.Line(lineGeometry.clone(), mats.lineMat2)
    line2.position.y = -0.5
    line2.computeLineDistances()
    scene.add(line2)

    // 外层光晕
    const glowMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 100, 4, 8, false), mats.glowMat)
    scene.add(glowMesh)

    lineObjects.push({
      lineName: lineData.name,
      mats,
      line1,
      line2,
      glowMesh,
      curve
    })

    // 站点
    for (const station of lineData.stations) {
      createStation(station, colorInt, lineData.name)
    }
  }
}

// ─── 创建站点 (优化: 复用几何体) ───────────────────────────
function createStation(station, colorInt, lineName) {
  const mats = createStationMaterials(colorInt)
  const group = new THREE.Group()
  group.position.set(station.position.x, station.position.y, station.position.z)

  // 核心八面体
  const core = new THREE.Mesh(octahedronGeo, mats.coreMat)
  group.add(core)

  // 内层发光
  const inner = new THREE.Mesh(octahedronGeo.clone(), mats.innerMat)
  inner.scale.setScalar(0.6)
  group.add(inner)

  // 外层光环
  const ring = new THREE.Mesh(torusGeo, mats.ringMat)
  ring.rotation.x = Math.PI / 2
  group.add(ring)

  // 第二层光环
  const ring2 = new THREE.Mesh(torus2Geo, mats.ring2Mat)
  ring2.rotation.x = Math.PI / 2
  ring2.rotation.z = Math.PI / 4
  group.add(ring2)

  // 光晕球
  const glow = new THREE.Mesh(sphereGeo, mats.glowMat)
  group.add(glow)

  // 标签
  const label = createStationLabel(station.name, colorInt)
  label.position.set(0, 60, 0)
  group.add(label)

  scene.add(group)
  stationObjects.push({ lineName, core, ring, ring2, glow, mats, label })
}

// ─── 创建站点标签 (每个标签独立的 canvas) ───────────────
function createStationLabel(name, colorInt) {
  // 为每个标签创建独立的 canvas
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, 256, 64)

  const hexColor = '#' + colorInt.toString(16).padStart(6, '0')
  ctx.shadowColor = hexColor
  ctx.shadowBlur = 15
  ctx.font = 'bold 36px Microsoft YaHei, PingFang SC'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(name, 128, 32)

  const texture = new THREE.CanvasTexture(canvas)

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, blending: THREE.AdditiveBlending })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(120, 30, 1)
  return sprite
}

// ─── 初始化粒子系统 ─────────────────────────────────────────
function initParticles() {
  particlePositions = new Float32Array(PARTICLE_COUNT * 3)
  particleVelocities = []

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const theta = Math.random() * TWO_PI
    const phi = Math.random() * Math.PI
    const r = 3 + Math.random() * 4

    particlePositions[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * r
    particlePositions[i * 3 + 1] = 12 + Math.random() * 6
    particlePositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r

    particleVelocities.push({ x: 0, y: 0, z: 0 })
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))

  // 使用第一条线路的颜色
  const firstLineColor = subwayLines.value[0]?.colorInt || 0xff00ff

  const material = new THREE.PointsMaterial({
    size: 3,
    color: firstLineColor,
    transparent: true,
    opacity: 1,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  })

  particlePoints = new THREE.Points(geometry, material)
  scene.add(particlePoints)

  // 能量球
  energyBall = new THREE.Mesh(
    new THREE.SphereGeometry(6, 24, 24),
    new THREE.MeshBasicMaterial({ color: firstLineColor, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
  )
  energyBall.position.set(0, 15, 0)
  scene.add(energyBall)
}

// ─── 初始化列车 ─────────────────────────────────────────────
function initTrains() {
  const speeds = [0.00012, 0.00018]
  const offsets = [0, 0.4]

  for (const lineObj of lineObjects) {
    for (let j = 0; j < 2; j++) {
      const train = createTrain(lineObj.mats.lineMat1.color)
      train.visible = false
      train.userData = { t: offsets[j], speed: speeds[j], curve: lineObj.curve, direction: 1 }
      scene.add(train)
      trainObjects.push(train)
    }
  }
}

// ─── 创建赛博朋克列车 (优化: 简化结构) ─────────────────────
function createTrain(colorInt) {
  const group = new THREE.Group()

  // 车身
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x111111, emissive: colorInt, emissiveIntensity: 0.8 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6), bodyMat)
  group.add(body)

  // 霓虹灯带
  const stripMat = new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
  const strip = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.5, 6.5), stripMat)
  group.add(strip)

  // 头部
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  const head = new THREE.Mesh(new THREE.ConeGeometry(3, 6, 4), headMat)
  head.rotation.x = Math.PI / 2
  head.position.z = 4
  group.add(head)

  // 外发光
  const glowMat = new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.1, side: THREE.BackSide, blending: THREE.AdditiveBlending })
  const glow = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 8), glowMat)
  group.add(glow)

  return group
}

// ─── 初始化灯光 ─────────────────────────────────────────────
function initLights() {
  scene.add(new THREE.AmbientLight(0x001133, 0.4))
  scene.add(new THREE.HemisphereLight(0xff00ff, 0x00ffff, 0.2))
}

// ─── 初始化地面 ─────────────────────────────────────────────
function initGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10000, 10000), new THREE.MeshBasicMaterial({ color: 0x050510 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -20
  scene.add(ground)

  const grid1 = new THREE.GridHelper(10000, 100, 0x00ffff, 0x001133)
  grid1.position.y = -18
  grid1.material.transparent = true
  grid1.material.opacity = 0.3
  scene.add(grid1)

  const grid2 = new THREE.GridHelper(10000, 500, 0xff00ff, 0x050010)
  grid2.position.y = -19
  grid2.material.transparent = true
  grid2.material.opacity = 0.1
  scene.add(grid2)
}

// ─── 初始化星空 ─────────────────────────────────────────────
function initStarfield() {
  const count = 2000
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const neonColors = [[1, 0, 1], [0, 1, 1], [1, 1, 0]]

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 20000
    positions[i * 3 + 1] = Math.random() * 8000 + 500
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20000

    const c = neonColors[i % 3]
    colors[i * 3] = c[0]
    colors[i * 3 + 1] = c[1]
    colors[i * 3 + 2] = c[2]
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, sizeAttenuation: true })

  scene.add(new THREE.Points(geo, mat))
}

// ─── 初始化后期处理 ─────────────────────────────────────────
async function initPostProcessing() {
  const { EffectComposer, RenderPass, BloomEffect, EffectPass } = await import('postprocessing')

  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  bloomEffect = new BloomEffect({ luminanceThreshold: 0.2, luminanceSmoothing: 0.9, intensity: 1.2 })
  composer.addPass(new EffectPass(camera, bloomEffect))
}

// ─── 场景初始化 ─────────────────────────────────────────────
async function init() {
  if (!containerRef.value) return

  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight

  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x050510, 0.00012)

  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 50000)
  const dist = bounds.size * 0.6
  camera.position.set(bounds.center.x, dist * 0.8, bounds.center.z + dist * 0.5)
  camera.lookAt(bounds.center.x, 0, bounds.center.z)

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x050510, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  containerRef.value.appendChild(renderer.domElement)

  orbitCtrl = new OrbitControls(camera, renderer.domElement)
  orbitCtrl.enableDamping = true
  orbitCtrl.dampingFactor = 0.03
  orbitCtrl.minDistance = bounds.size * 0.15
  orbitCtrl.maxDistance = bounds.size * 2.5
  orbitCtrl.maxPolarAngle = Math.PI * 0.8
  orbitCtrl.target.set(bounds.center.x, 0, bounds.center.z)

  // 构建场景
  initLights()
  initGround()
  initStarfield()
  buildSubwayLines()
  initTrains()
  initParticles()
  await initPostProcessing()

  // 粒子凝聚动画
  setTimeout(() => {
    trainAssembleState.value = 'assembling'
    assembleStartTime.value = Date.now()
  }, 2000)

  setTimeout(() => {
    trainAssembleState.value = 'complete'
  }, 4000)

  // 动画循环
  let lastTime = performance.now()

  function animate(time) {
    animationId = requestAnimationFrame(animate)

    const delta = Math.min((time - lastTime) / 1000, 0.1) // 限制 delta 防止跳帧
    lastTime = time
    const elapsed = time / 1000

    updateBreathing(elapsed, delta)
    updateParticles(delta, elapsed)
    updateTrains(delta)
    updateFlyCamera(delta)
    orbitCtrl.update()

    composer.render()
  }

  animate(0)
  window.addEventListener('resize', onResize)
}

// ─── 呼吸动画 (优化: 减少计算) ─────────────────────────────
function updateBreathing(elapsed, delta) {
  const t = elapsed * 1000
  const breathPhase = (t % BREATH_DURATION) / BREATH_DURATION
  const breath = Math.sin(breathPhase * TWO_PI)
  const currentSelected = selectedLine.value

  // 线路呼吸
  for (let i = 0; i < lineObjects.length; i++) {
    const obj = lineObjects[i]
    const phaseOffset = i * 0.3
    const adjBreath = Math.sin((breathPhase + phaseOffset) * TWO_PI)

    // 选择高亮或全亮时的呼吸透明度
    const breathOpacity = currentSelected === null || currentSelected === obj.lineName
      ? 0.7 + adjBreath * 0.3
      : 0.15 + adjBreath * 0.05

    const dash = currentSelected === null || currentSelected === obj.lineName
      ? 6 + adjBreath * 2
      : 4
    const gap = currentSelected === null || currentSelected === obj.lineName
      ? 4 + adjBreath * 1.5
      : 6

    obj.mats.lineMat1.dashSize = dash
    obj.mats.lineMat1.gapSize = gap
    obj.mats.lineMat1.opacity = breathOpacity

    obj.mats.lineMat2.dashSize = dash
    obj.mats.lineMat2.gapSize = gap
    obj.mats.lineMat2.opacity = breathOpacity

    const isLineSelected = currentSelected === null || currentSelected === obj.lineName
    obj.mats.glowMat.opacity = isLineSelected ? 0.08 + adjBreath * 0.07 : 0
    obj.glowMesh.visible = isLineSelected
  }

  // 站点呼吸
  for (let i = 0; i < stationObjects.length; i++) {
    const obj = stationObjects[i]
    const phaseOffset = i * 0.15
    const adjBreath = Math.sin((breathPhase + phaseOffset) * TWO_PI)

    obj.core.rotation.y += delta * 0.5
    obj.core.rotation.x += delta * 0.3
    obj.ring.rotation.z += delta * 0.8

    const isSelected = currentSelected === null || currentSelected === obj.lineName
    const baseBreathOpacity = isSelected ? 0.6 + adjBreath * 0.4 : 0.2 + adjBreath * 0.1

    obj.mats.glowMat.opacity = isSelected ? 0.08 * baseBreathOpacity : 0
    obj.mats.ringMat.opacity = isSelected ? 0.7 * (0.6 + adjBreath * 0.4) : 0
    obj.mats.ring2Mat.opacity = isSelected ? 0.4 * (0.6 + adjBreath * 0.4) : 0
    obj.core.material.opacity = isSelected ? 1 : 0
    obj.mats.innerMat.opacity = isSelected ? 0.9 : 0
    obj.label.material.opacity = isSelected ? 0.9 : 0
  }

  // Bloom 呼吸
  if (bloomEffect) {
    bloomEffect.blur = 1 + breath * 0.2
  }
}

// ─── 粒子更新 (优化: 减少对象创建) ───────────────────────────
function updateParticles(delta, elapsed) {
  if (!particlePoints) return

  const state = trainAssembleState.value

  if (state === 'particles') {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = elapsed * 0.5 + i * 0.01
      particlePositions[i * 3 + 0] += Math.sin(angle) * 0.02
      particlePositions[i * 3 + 1] += 0.01
      particlePositions[i * 3 + 2] += Math.cos(angle) * 0.02
    }

    if (energyBall) {
      const pulse = 1 + Math.sin(elapsed * 4) * 0.15
      energyBall.scale.setScalar(pulse)
      energyBall.rotation.y = elapsed * 0.5
    }
  } else if (state === 'assembling' && assembleStartTime.value) {
    const progress = Math.min((Date.now() - assembleStartTime.value) / 2000, 1)
    const ease = progress * progress * progress

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particlePositions[i * 3 + 0] *= (1 - ease * 0.1)
      particlePositions[i * 3 + 1] += (8 - particlePositions[i * 3 + 1]) * ease * 0.08
      particlePositions[i * 3 + 2] *= (1 - ease * 0.1)
    }

    if (energyBall) {
      const scale = Math.max(0, 1 - progress * 1.2)
      energyBall.scale.setScalar(scale)
      if (scale <= 0) {
        scene.remove(energyBall)
        energyBall = null
      }
    }

    if (progress > 0.7) {
      for (const train of trainObjects) {
        train.visible = true
      }
    }
  }

  particlePoints.geometry.attributes.position.needsUpdate = true

  if (state === 'complete' && particlePoints) {
    scene.remove(particlePoints)
    particlePoints = null
  }
}

// ─── 列车更新 (优化: 缓存计算) ───────────────────────────────
const tempPos = new THREE.Vector3()
const tempLookAt = new THREE.Vector3()

function updateTrains(delta) {
  if (trainAssembleState.value !== 'complete') return

  for (const train of trainObjects) {
    const ud = train.userData
    ud.t += ud.speed * delta * 60 * ud.direction
    if (ud.t > 1) ud.t = 0
    if (ud.t < 0) ud.t = 1

    tempPos.copy(ud.curve.getPointAt(ud.t))
    tempPos.y = 8
    train.position.copy(tempPos)

    tempLookAt.copy(ud.curve.getPointAt(Math.min(ud.t + 0.008, 0.999)))
    tempLookAt.y = 8
    train.lookAt(tempLookAt)
  }
}

// ─── 窗口调整 ───────────────────────────────────────────────
function onResize() {
  if (!containerRef.value || !camera || !renderer || !composer) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
}

// ─── 清理 (优化: 正确释放资源) ──────────────────────────────
function dispose() {
  if (animationId) cancelAnimationFrame(animationId)
  window.removeEventListener('resize', onResize)

  if (orbitCtrl) orbitCtrl.dispose()

  // 清理站点对象
  for (const obj of stationObjects) {
    obj.core.geometry.dispose?.()
    obj.ring.geometry.dispose?.()
    obj.ring2.geometry.dispose?.()
    obj.glow.geometry.dispose?.()
    obj.mats.coreMat.dispose()
    obj.mats.innerMat.dispose()
    obj.mats.ringMat.dispose()
    obj.mats.ring2Mat.dispose()
    obj.mats.glowMat.dispose()
  }

  // 清理线条对象
  for (const obj of lineObjects) {
    obj.line1.geometry.dispose()
    obj.line2.geometry.dispose()
    obj.mats.lineMat1.dispose()
    obj.mats.lineMat2.dispose()
    obj.mats.glowMat.dispose()
  }

  // 清理列车
  for (const train of trainObjects) {
    train.traverse(child => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    })
  }

  // 清理粒子
  if (particlePoints) {
    particlePoints.geometry.dispose()
    particlePoints.material.dispose()
  }
  if (energyBall) {
    energyBall.geometry.dispose()
    energyBall.material.dispose()
  }

  if (composer) composer.dispose()
  if (renderer) {
    renderer.dispose()
    if (containerRef.value && renderer.domElement) {
      containerRef.value.removeChild(renderer.domElement)
    }
  }
}

// ─── 生命周期 ───────────────────────────────────────────────
onMounted(init)
onUnmounted(dispose)

// ─── 导出计算属性 ───────────────────────────────────────────
const trainCount = ref(0)
</script>

<template>
  <div class="subway-wrapper">
    <div ref="containerRef" class="canvas-container"></div>

    <!-- HUD -->
    <div class="hud-top">
      <div class="hud-title">
        <span class="hud-city">{{ parsed.cityName }}</span>
        <span class="hud-subtitle">CYBER TRANSIT</span>
      </div>
      <div class="hud-hint">拖拽旋转 · 滚轮缩放 · 右键平移</div>
    </div>

    <div class="hud-legend">
      <div class="legend-item"
           v-for="line in subwayLines"
           :key="line.id"
           :class="{ 'legend-selected': selectedLine === line.name }"
           @click="selectLine(line.name)">
        <div class="legend-dot" :style="{ background: '#' + line.colorInt.toString(16).padStart(6, '0'), boxShadow: '0 0 12px #' + line.colorInt.toString(16).padStart(6, '0') }"></div>
        <span class="legend-name">{{ line.name }}</span>
        <span class="legend-count">{{ line.stations.length }}站</span>
      </div>
    </div>

    <div class="hud-bottom">
      <div class="hud-stat">
        <span class="stat-label">线路</span>
        <span class="stat-value cyber">{{ subwayLines.length }}</span>
      </div>
      <div class="hud-stat">
        <span class="stat-label">站点</span>
        <span class="stat-value cyber">{{ subwayLines.reduce((s, l) => s + l.stations.length, 0) }}</span>
      </div>
      <div class="hud-stat">
        <span class="stat-label">列车</span>
        <span class="stat-value cyber">{{ trainObjects.length }}</span>
      </div>
    </div>

    <div class="scanlines"></div>
    <div class="corner corner-tl"></div>
    <div class="corner corner-tr"></div>
    <div class="corner corner-bl"></div>
    <div class="corner corner-br"></div>

    <div v-if="trainAssembleState !== 'complete'" class="assembly-status">
      <div class="assembly-text">
        {{ trainAssembleState === 'particles' ? '能量汇聚中...' : '// 粒子凝聚 //' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.subway-wrapper {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #050510;
  font-family: 'Courier New', monospace;
}

.canvas-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.canvas-container canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* HUD */
.hud-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 24px 28px;
  pointer-events: none;
  z-index: 10;
}

.hud-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hud-city {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 6px;
  color: #00ffff;
  text-shadow: 0 0 20px #00ffff, 0 0 40px #00ffff, 0 0 60px rgba(0, 255, 255, 0.5);
  text-transform: uppercase;
  font-family: 'Courier New', monospace;
}

.hud-subtitle {
  font-size: 12px;
  letter-spacing: 8px;
  color: #ff00ff;
  text-shadow: 0 0 10px #ff00ff;
  font-family: 'Courier New', monospace;
}

.hud-hint {
  font-size: 11px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.35);
  font-family: 'Courier New', monospace;
  margin-top: 8px;
  text-transform: uppercase;
}

.hud-legend {
  position: absolute;
  top: 90px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  z-index: 10;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(5, 5, 16, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: all 0.3s ease;
}

.legend-item:hover {
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(10, 10, 30, 0.9);
}

.legend-item.legend-selected {
  border-color: rgba(0, 255, 255, 0.6);
  box-shadow: 0 0 20px rgba(0, 255, 255, 0.3), inset 0 0 15px rgba(0, 255, 255, 0.1);
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-name {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 2px;
  font-family: 'Courier New', monospace;
}

.legend-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Courier New', monospace;
  margin-left: 6px;
}

.hud-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 0;
  z-index: 10;
  pointer-events: none;
}

.hud-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 48px;
  background: rgba(5, 5, 16, 0.9);
  border-top: 2px solid rgba(0, 255, 255, 0.3);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  gap: 4px;
}

.stat-label {
  font-size: 10px;
  letter-spacing: 4px;
  color: rgba(255, 0, 255, 0.7);
  font-family: 'Courier New', monospace;
  text-transform: uppercase;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
}

.stat-value.cyber {
  color: #00ffff;
  text-shadow: 0 0 15px #00ffff, 0 0 30px rgba(0, 255, 255, 0.5);
}

.scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 0, 0, 0.06) 2px, rgba(0, 0, 0, 0.06) 4px);
  animation: scanlines 8s linear infinite;
}

@keyframes scanlines {
  0% { background-position: 0 0; }
  100% { background-position: 0 100px; }
}

.corner {
  position: absolute;
  width: 40px;
  height: 40px;
  z-index: 10;
  pointer-events: none;
}

.corner-tl { top: 16px; left: 16px; border-top: 2px solid #00ffff; border-left: 2px solid #00ffff; }
.corner-tr { top: 16px; right: 16px; border-top: 2px solid #ff00ff; border-right: 2px solid #ff00ff; }
.corner-bl { bottom: 70px; left: 16px; border-bottom: 2px solid #ff00ff; border-left: 2px solid #ff00ff; }
.corner-br { bottom: 70px; right: 16px; border-bottom: 2px solid #00ffff; border-right: 2px solid #00ffff; }

.assembly-status {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  pointer-events: none;
  text-align: center;
}

.assembly-text {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 8px;
  color: #ff00ff;
  text-shadow: 0 0 30px #ff00ff, 0 0 60px rgba(255, 0, 255, 0.7);
  font-family: 'Courier New', monospace;
  animation: glitch 0.3s ease-in-out infinite;
}

@keyframes glitch {
  0%, 100% { transform: translate(0); }
  20% { transform: translate(-2px, 1px); }
  40% { transform: translate(2px, -1px); }
  60% { transform: translate(-1px, -1px); }
  80% { transform: translate(1px, 1px); }
}

/* 移动端适配 */
@media (max-width: 768px) {
  .hud-top {
    padding: 16px;
    flex-direction: column;
    gap: 8px;
  }

  .hud-city {
    font-size: 20px;
    letter-spacing: 3px;
  }

  .hud-subtitle {
    font-size: 10px;
    letter-spacing: 4px;
  }

  .hud-hint {
    display: none;
  }

  .hud-legend {
    top: auto;
    bottom: 80px;
    right: 12px;
    gap: 8px;
  }

  .legend-item {
    padding: 8px 12px;
    gap: 8px;
  }

  .legend-name {
    font-size: 12px;
  }

  .legend-count {
    display: none;
  }

  .hud-bottom {
    flex-wrap: wrap;
  }

  .hud-stat {
    padding: 12px 24px;
    flex: 1;
    min-width: 80px;
  }

  .stat-label {
    font-size: 9px;
    letter-spacing: 2px;
  }

  .stat-value {
    font-size: 18px;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
  }
}

@media (max-width: 480px) {
  .hud-city {
    font-size: 16px;
    letter-spacing: 2px;
  }

  .legend-item {
    padding: 6px 10px;
  }

  .legend-name {
    font-size: 11px;
    letter-spacing: 1px;
  }

  .hud-stat {
    padding: 10px 16px;
  }

  .stat-value {
    font-size: 16px;
  }

  .corner {
    width: 24px;
    height: 24px;
  }
}
</style>
