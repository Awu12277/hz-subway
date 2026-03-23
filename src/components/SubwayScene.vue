<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
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

// ─── 相机跟随状态 ─────────────────────────────────────────
let followTarget = null

// ─── 对象池 (避免每帧创建新对象) ───────────────────────────
const stationObjects = [] // { core, ring, ring2, glow, materials }
const trainObjects = [] // { mesh, userData }
const lineObjects = [] // { lineMat1, lineMat2, glowMat }

// ─── 线路选择 ─────────────────────────────────────────────
const selectedLine = ref(null) // null = 全选
const followingTrain = ref(false) // 相机跟随模式
const showWelcome = ref(true) // 欢迎文字显示状态

function selectLine(lineName) {
  if (selectedLine.value === lineName) {
    selectedLine.value = null // 取消选择，显示全部
    followingTrain.value = false // 取消跟随
    orbitCtrl.enabled = true // 恢复轨道控制
    // 显示所有线路和站点
    showAllLinesAndStations()
  } else {
    selectedLine.value = lineName
    // 清除所有站点活跃状态
    clearAllStationsActive()
    // 隐藏其他线路和站点
    hideOtherLinesAndStations(lineName)
    // 重置小车到始发站
    resetTrainToStart(lineName)
    // 飞向选中线路的第一个站点
    flyToFirstStation(lineName)
    // 开始跟随模式（飞行结束后生效）
    followingTrain.value = true
  }
}

// ─── 隐藏其他线路和站点 ───────────────────────────────
function hideOtherLinesAndStations(selectedLineName) {
  for (const lineObj of lineObjects) {
    if (lineObj.lineName !== selectedLineName) {
      lineObj.line1.visible = false
      lineObj.line2.visible = false
      lineObj.glowMesh.visible = false
    }
  }
  for (const stationObj of stationObjects) {
    if (stationObj.lineName !== selectedLineName) {
      stationObj.core.visible = false
      stationObj.ring.visible = false
      stationObj.ring2.visible = false
      stationObj.glow.visible = false
      stationObj.label.visible = false
    }
  }
}

// ─── 显示所有线路和站点 ───────────────────────────────
function showAllLinesAndStations() {
  for (const lineObj of lineObjects) {
    lineObj.line1.visible = true
    lineObj.line2.visible = true
    lineObj.glowMesh.visible = true
  }
  for (const stationObj of stationObjects) {
    stationObj.core.visible = true
    stationObj.ring.visible = true
    stationObj.ring2.visible = true
    stationObj.glow.visible = true
    stationObj.label.visible = true
  }
}

// ─── 清除所有站点活跃状态 ───────────────────────────────
function clearAllStationsActive() {
  for (const stationObj of stationObjects) {
    stationObj.isActive = false
  }
}

// ─── 重置小车到始发站 ──────────────────────────────────────
function resetTrainToStart(lineName) {
  for (const train of trainObjects) {
    if (train.userData.lineName === lineName) {
      train.userData.t = 0
      train.userData.waiting = false
      train.userData.waitTimer = 0
      train.visible = true
    } else {
      train.visible = false
    }
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
    // 只有不在跟随模式时才启用轨道控制
    if (!followingTrain.value) {
      orbitCtrl.enabled = true
    }
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
      curve,
      stations: lineData.stations
    })

    // 站点
    for (let i = 0; i < lineData.stations.length; i++) {
      createStation(lineData.stations[i], colorInt, lineData.name, i)
    }
  }
}

// ─── 创建站点 (优化: 复用几何体) ───────────────────────────
function createStation(station, colorInt, lineName, stationIndex) {
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
  stationObjects.push({ lineName, stationIndex, core, ring, ring2, glow, mats, label, stationName: station.name, isActive: false, flashTime: 0 })
}

// ─── 创建站点标签 (每个标签独立的 canvas) ───────────────
function createStationLabel(name, colorInt) {
  // 为每个标签创建独立的 canvas
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')

  const hexColor = '#' + colorInt.toString(16).padStart(6, '0')

  function drawLabel(opacity = 0.4, scale = 1) {
    ctx.clearRect(0, 0, 256, 64)
    ctx.shadowColor = hexColor
    ctx.shadowBlur = 10 * opacity
    ctx.font = `${Math.round(24 * scale)}px Microsoft YaHei, PingFang SC`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.globalAlpha = opacity
    ctx.fillStyle = '#ffffff'
    ctx.fillText(name, 128, 32)
    ctx.globalAlpha = 1
  }

  drawLabel(0.4, 1)

  const texture = new THREE.CanvasTexture(canvas)

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, blending: THREE.AdditiveBlending })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(120, 30, 1)

  // 保存 canvas、ctx 和 drawLabel 函数以便后续更新
  sprite.userData.canvas = canvas
  sprite.userData.ctx = ctx
  sprite.userData.drawLabel = drawLabel
  sprite.userData.texture = texture

  return sprite
}

// ─── 初始化列车 ─────────────────────────────────────────────
function initTrains() {
  const speed = 0.00012

  for (const lineObj of lineObjects) {
    const train = createTrain(lineObj.mats.lineMat1.color, lineObj.lineName)
    train.visible = false

    // 计算每个站在曲线上的 t 值
    const stationTValues = []
    const curve = lineObj.curve
    const stations = lineObj.stations
    const sampleCount = 500

    for (let s = 0; s < stations.length; s++) {
      const stationPos = stations[s].position
      let minDist = Infinity
      let bestT = s / (stations.length - 1) // 默认均匀分布

      // 采样曲线找最近点
      for (let i = 0; i <= sampleCount; i++) {
        const t = i / sampleCount
        const point = curve.getPointAt(t)
        const dx = point.x - stationPos.x
        const dz = point.z - stationPos.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < minDist) {
          minDist = dist
          bestT = t
        }
      }
      stationTValues.push(bestT)
    }

    train.userData = {
      t: 0,
      speed: speed,
      curve: curve,
      direction: 1,
      lineName: lineObj.lineName,
      waiting: false,
      waitTimer: 0,
      stations: stations,
      stationTValues: stationTValues
    }
    scene.add(train)
    trainObjects.push(train)
  }
}

// ─── 加载地铁模型 ─────────────────────────────────────────
let subwayModel = null

function loadSubwayModel() {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.load(
      '/models/subway.glb',
      (gltf) => {
        subwayModel = gltf.scene
        resolve(subwayModel)
      },
      undefined,
      (error) => {
        console.error('Error loading subway model:', error)
        reject(error)
      }
    )
  })
}

// ─── 创建列车 (使用 GLB 模型或备用几何体) ─────────────────
function createTrain(colorInt, lineName) {
  const group = new THREE.Group()

  if (subwayModel) {
    // 使用加载的 GLB 模型
    const model = subwayModel.clone()
    const lineColor = new THREE.Color(colorInt)
    model.traverse((child) => {
      if (child.isMesh) {
        // 强制覆盖材质颜色
        if (child.material) {
          const mat = child.material.clone()
          mat.color = lineColor
          mat.emissive = lineColor
          mat.emissiveIntensity = 0.6
          child.material = mat
        }
      }
    })
    group.add(model)
  } else {
    // 备用：程序生成几何体
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x111111, emissive: colorInt, emissiveIntensity: 0.8 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6), bodyMat)
    group.add(body)

    const stripMat = new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    const strip = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.5, 6.5), stripMat)
    group.add(strip)

    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    const head = new THREE.Mesh(new THREE.ConeGeometry(3, 6, 4), headMat)
    head.rotation.x = Math.PI / 2
    head.position.z = 4
    group.add(head)

    const glowMat = new THREE.MeshBasicMaterial({ color: colorInt, transparent: true, opacity: 0.1, side: THREE.BackSide, blending: THREE.AdditiveBlending })
    const glow = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 8), glowMat)
    group.add(glow)
  }

  return group
}

// ─── 初始化灯光 ─────────────────────────────────────────────
function initLights() {
  scene.add(new THREE.AmbientLight(0x001133, 0.4))
  scene.add(new THREE.HemisphereLight(0xff00ff, 0x00ffff, 0.2))
}

// ─── 初始化地面 ─────────────────────────────────────────────
function initGround() {
  // 已禁用：黑色地面和坐标系网格
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

  // 加载地铁模型
  await loadSubwayModel()

  initTrains()
  await initPostProcessing()

  // 动画循环
  let lastTime = performance.now()

  function animate(time) {
    animationId = requestAnimationFrame(animate)

    const delta = Math.min((time - lastTime) / 1000, 0.1) // 限制 delta 防止跳帧
    lastTime = time
    const elapsed = time / 1000

    updateBreathing(elapsed, delta)
    updateTrains(delta)
    updateFlyCamera(delta)
    updateCameraFollow()
    orbitCtrl.update()

    composer.render()
  }

  animate(0)
  window.addEventListener('resize', onResize)

  // 欢迎文字3秒后消失
  setTimeout(() => {
    showWelcome.value = false
  }, 1800)
}

// ─── 相机平移控制 ─────────────────────────────────────────
function panCamera(direction) {
  if (!camera || !scene) return
  const panSpeed = bounds.size * 0.2

  switch (direction) {
    case 'up':
      camera.position.z -= panSpeed
      break
    case 'down':
      camera.position.z += panSpeed
      break
    case 'left':
      camera.position.x -= panSpeed
      break
    case 'right':
      camera.position.x += panSpeed
      break
  }
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

    // 站点闪烁效果
    let labelOpacity = isSelected ? 0.35 : 0.15 // 默认低亮度
    let labelScale = 1

    if (obj.isActive) {
      // 到站闪烁：透明度在0.3和1.0之间闪烁，scale在1到1.5之间变化
      const flashSpeed = 8
      const flash = Math.sin(elapsed * flashSpeed)
      labelOpacity = 0.5 + flash * 0.5
      labelScale = 1.2 + flash * 0.3
    }

    // 更新标签
    if (obj.label.userData.drawLabel) {
      obj.label.userData.drawLabel(labelOpacity, labelScale)
      obj.label.userData.texture.needsUpdate = true
    }
    obj.label.scale.set(120 * labelScale, 30 * labelScale, 1)

    const baseBreathOpacity = isSelected ? 0.6 + adjBreath * 0.4 : 0.2 + adjBreath * 0.1

    obj.mats.glowMat.opacity = isSelected ? 0.08 * baseBreathOpacity : 0
    obj.mats.ringMat.opacity = isSelected ? 0.7 * (0.6 + adjBreath * 0.4) : 0
    obj.mats.ring2Mat.opacity = isSelected ? 0.4 * (0.6 + adjBreath * 0.4) : 0
    obj.core.material.opacity = isSelected ? 1 : 0
    obj.mats.innerMat.opacity = isSelected ? 0.9 : 0
  }

  // Bloom 呼吸
  if (bloomEffect) {
    bloomEffect.blur = 1 + breath * 0.2
  }
}



// ─── 列车更新 ───────────────────────────────
const tempPos = new THREE.Vector3()
const tempLookAt = new THREE.Vector3()
const STATION_STOP_TIME = 3000 // 3秒停站

function updateTrains(delta) {
  for (const train of trainObjects) {
    const ud = train.userData

    // 非选中线路的小车不更新
    if (selectedLine.value && ud.lineName !== selectedLine.value) continue

    // 停站逻辑
    if (ud.waiting) {
      ud.waitTimer += delta * 1000
      if (ud.waitTimer >= STATION_STOP_TIME) {
        ud.waiting = false
        ud.waitTimer = 0
      }

      // 更新位置但保持原地
      tempPos.copy(ud.curve.getPointAt(ud.t))
      tempPos.y = 2
      train.position.copy(tempPos)

      tempLookAt.copy(ud.curve.getPointAt(Math.min(ud.t + 0.008, 0.999)))
      tempLookAt.y = 2
      train.lookAt(tempLookAt)
      continue
    }

    // 保存上一次的 t 值
    const prevT = ud.t

    // 基础速度
    const baseSpeed = ud.speed

    // 计算当前段和段内进度
    const stationCount = ud.stationTValues?.length || 2
    const segmentLength = 1 / (stationCount - 1)
    const currentSegment = Math.floor(ud.t / segmentLength)
    const segmentStart = currentSegment * segmentLength
    const tInSegment = (ud.t - segmentStart) / segmentLength

    // 贝塞尔缓动：每段开始加速，结束前减速
    let speedFactor = 1
    if (tInSegment < 0.2) {
      // 开始20%：缓入
      const t = tInSegment / 0.2
      speedFactor = t * t * (3 - 2 * t) * 0.6 + 0.4
    } else if (tInSegment > 0.8) {
      // 结束20%：缓出
      const t = (1 - tInSegment) / 0.2
      speedFactor = t * t * (3 - 2 * t) * 0.6 + 0.4
    } else {
      // 中间60%：全速
      speedFactor = 1
    }

    // 移动
    const dynamicSpeed = baseSpeed * speedFactor
    ud.t += dynamicSpeed * delta * 60 * ud.direction
    if (ud.t > 1) ud.t = 0
    if (ud.t < 0) ud.t = 1

    // 检测是否到达站点
    if (ud.stationTValues && ud.stationTValues.length > 0) {
      for (let i = 0; i < ud.stationTValues.length; i++) {
        const stationT = ud.stationTValues[i]
        if (ud.direction > 0) {
          if (prevT < stationT && ud.t >= stationT) {
            ud.t = stationT
            ud.waiting = true
            ud.waitTimer = 0
            // 清除所有站点活跃状态，再标记当前站点
            clearLineStationsActive(ud.lineName)
            markStationActive(ud.lineName, i, true)
            break
          }
        } else {
          if (prevT > stationT && ud.t <= stationT) {
            ud.t = stationT
            ud.waiting = true
            ud.waitTimer = 0
            // 清除所有站点活跃状态，再标记当前站点
            clearLineStationsActive(ud.lineName)
            markStationActive(ud.lineName, i, true)
            break
          }
        }
      }

      // 如果正在移动且不靠近任何站点，清除所有活跃状态
      if (!ud.waiting) {
        clearLineStationsActive(ud.lineName)
      }
    }

    tempPos.copy(ud.curve.getPointAt(ud.t))
    tempPos.y = 2
    train.position.copy(tempPos)

    tempLookAt.copy(ud.curve.getPointAt(Math.min(ud.t + 0.008, 0.999)))
    tempLookAt.y = 2
    train.lookAt(tempLookAt)
  }
}

// ─── 标记站点活跃状态 ───────────────────────────────
function markStationActive(lineName, stationIndex, isActive) {
  for (const stationObj of stationObjects) {
    if (stationObj.lineName === lineName && stationObj.stationIndex === stationIndex) {
      stationObj.isActive = isActive
    }
  }
}

// ─── 清除线路所有站点活跃状态 ───────────────────────────────
function clearLineStationsActive(lineName) {
  for (const stationObj of stationObjects) {
    if (stationObj.lineName === lineName) {
      stationObj.isActive = false
    }
  }
}

// ─── 更新相机跟随 ─────────────────────────────────────────
function updateCameraFollow() {
  if (!followingTrain.value || !selectedLine.value) return

  const train = trainObjects.find(t => t.userData.lineName === selectedLine.value)
  if (!train) return

  const trainPos = train.position
  const trainRotation = train.rotation.y
  const offsetDist = bounds.size * 0.1

  // 禁用轨道控制以保持跟随
  orbitCtrl.enabled = false

  // 相机目标位置：在小车左侧方，同样高度
  const cameraX = trainPos.x - Math.cos(trainRotation) * offsetDist
  const cameraZ = trainPos.z + Math.sin(trainRotation) * offsetDist

  orbitCtrl.target.copy(trainPos)
  camera.position.set(cameraX, 100, cameraZ)
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

    <!-- 方向控制 -->
    <div class="direction-controls" :class="{ 'controls-visible': !selectedLine }">
      <div class="dir-btn-wrapper">
        <button class="dir-btn dir-up" @click="panCamera('up')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-8 8h5v8h6v-8h5z"/></svg>
        </button>
        <button class="dir-btn dir-left" @click="panCamera('left')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 12l8-8v5h8v6h-8v5z"/></svg>
        </button>
        <button class="dir-btn dir-down" @click="panCamera('down')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20l8-8h-5v-8h-6v8h-5z"/></svg>
        </button>
        <button class="dir-btn dir-right" @click="panCamera('right')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 12l-8 8v-5h-8v-6h8v-5z"/></svg>
        </button>
      </div>
      <div class="dir-hint">平移视角</div>
    </div>

    <div class="scanlines"></div>
    <div class="corner corner-tl"></div>
    <div class="corner corner-tr"></div>
    <div class="corner corner-bl"></div>
    <div class="corner corner-br"></div>

    <div v-if="showWelcome" class="welcome-text">欢迎来到杭州</div>
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

.welcome-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  pointer-events: none;
  text-align: center;
  font-size: 48px;
  font-weight: 700;
  letter-spacing: 12px;
  color: #00ffff;
  text-shadow: 0 0 30px #00ffff, 0 0 60px rgba(0, 255, 255, 0.7);
  font-family: "Courier New", monospace;
  animation: welcomeGlitch 0.15s ease-in-out infinite, welcomeGlow 2s ease-in-out infinite;
}

@keyframes welcomeGlitch {
  0% { transform: translate(-50%, -50%); }
  20% { transform: translate(-52%, -48%); }
  40% { transform: translate(-48%, -52%); }
  60% { transform: translate(-51%, -49%); }
  80% { transform: translate(-49%, -51%); }
  100% { transform: translate(-50%, -50%); }
}

@keyframes welcomeGlow {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; text-shadow: 0 0 40px #00ffff, 0 0 80px rgba(0, 255, 255, 0.9), -2px 0 #ff00ff, 2px 0 #00ffff; }
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

/* 方向控制按钮 */
.direction-controls {
  position: absolute;
  bottom: 90px;
  left: 24px;
  z-index: 10;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.3s ease;
  pointer-events: none;
}

.direction-controls.controls-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.dir-btn-wrapper {
  display: grid;
  grid-template-columns: repeat(3, 44px);
  grid-template-rows: repeat(2, 44px);
  gap: 4px;
}

.dir-btn {
  width: 44px;
  height: 44px;
  border: 1px solid rgba(0, 255, 255, 0.4);
  background: rgba(5, 5, 16, 0.85);
  border-radius: 8px;
  color: #00ffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  backdrop-filter: blur(10px);
  touch-action: manipulation;
}

.dir-btn svg {
  width: 20px;
  height: 20px;
}

.dir-btn:active:not(:disabled),
.dir-btn.active:not(:disabled) {
  background: rgba(0, 255, 255, 0.2);
  border-color: #00ffff;
  box-shadow: 0 0 15px rgba(0, 255, 255, 0.4);
  transform: scale(0.95);
}

.dir-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.dir-up { grid-column: 2; grid-row: 1; }
.dir-left { grid-column: 1; grid-row: 2; }
.dir-down { grid-column: 2; grid-row: 2; }
.dir-right { grid-column: 3; grid-row: 2; }

.dir-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  margin-top: 8px;
  letter-spacing: 2px;
  font-family: 'Courier New', monospace;
}

/* 移动端适配 - 方向按钮 */
@media (max-width: 768px) {
  .direction-controls {
    bottom: 100px;
    left: 16px;
  }

  .dir-btn-wrapper {
    grid-template-columns: repeat(3, 52px);
    grid-template-rows: repeat(2, 52px);
    gap: 6px;
  }

  .dir-btn {
    width: 52px;
    height: 52px;
    border-radius: 12px;
  }

  .dir-btn svg {
    width: 24px;
    height: 24px;
  }

  .dir-hint {
    font-size: 9px;
  }
}

@media (max-width: 480px) {
  .dir-btn-wrapper {
    grid-template-columns: repeat(3, 48px);
    grid-template-rows: repeat(2, 48px);
  }

  .dir-btn {
    width: 48px;
    height: 48px;
  }
}
</style>
