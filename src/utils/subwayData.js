/**
 * 地铁数据解析工具
 * 将 city.json 原始数据转换为 Three.js 可用的标准化格式
 */

/**
 * 解析网格坐标字符串 "x y" → Vector3
 * @param {string} posStr - 坐标字符串
 * @returns {{ x: number, y: number, z: number }}
 */
export function parsePosition(posStr) {
  if (!posStr || typeof posStr !== 'string') return { x: 0, y: 0, z: 0 }
  const parts = posStr.trim().split(/\s+/)
  const x = parseFloat(parts[0]) || 0
  const z = parseFloat(parts[1]) || 0
  return { x, y: 0, z }
}

/**
 * 将十六进制颜色字符串转为整数
 * @param {string} hex - 6位hex色值
 * @returns {number}
 */
export function hexToInt(hex) {
  return parseInt(hex, 16)
}

/**
 * 加载并解析 city.json，返回过滤后的线路数据
 * @param {object} rawData - 原始 city.json 对象
 * @param {string[]} targetLines - 要渲染的线路名称数组，null/空表示全部
 * @returns {{ lines: Array, cityName: string, cityCode: string }}
 */
export function parseCityData(rawData, targetLines = null) {
  if (!rawData || !rawData.l) {
    console.error('[SubwayData] Invalid city.json format')
    return { lines: [], cityName: '', cityCode: '' }
  }

  const cityName = rawData.s || ''
  const cityCode = rawData.i || ''

  const lines = rawData.l
    .filter(line => !targetLines || targetLines.length === 0 || targetLines.includes(line.ln))
    .map((line, lineIndex) => {
      const stations = (line.st || []).map((station, stationIndex) => ({
        id: station.si || `${lineIndex}-${stationIndex}`,
        name: station.n || '',
        nameEn: station.en || '',
        position: parsePosition(station.p),
        geoCoord: station.sl || '',
        lineGroup: station.lg || '0',
      }))

      return {
        id: `line-${lineIndex}`,
        name: line.ln || `Line ${lineIndex + 1}`,
        colorHex: line.cl || 'CCCCCC',
        colorInt: hexToInt(line.cl || 'CCCCCC'),
        stations,
      }
    })

  return { lines, cityName, cityCode }
}

/**
 * 计算站点的3D包围盒，用于相机定位
 * @param {Array} lines
 * @returns {{ min: {x,y,z}, max: {x,y,z}, center: {x,y,z}, size: number }}
 */
export function computeBounds(lines) {
  let minX = Infinity, minZ = Infinity
  let maxX = -Infinity, maxZ = -Infinity

  for (const line of lines) {
    for (const station of line.stations) {
      const p = station.position
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
  }

  if (!isFinite(minX)) {
    return { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 0, z: 100 }, center: { x: 0, y: 0, z: 0 }, size: 200 }
  }

  const center = {
    x: (minX + maxX) / 2,
    y: 0,
    z: (minZ + maxZ) / 2,
  }
  const size = Math.max(maxX - minX, maxZ - minZ)

  return { min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: 0, z: maxZ }, center, size }
}
