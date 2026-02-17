import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const MIN_DIM = 4, MAX_DIM = 72
const SCALE = 0.04 // inches to 3D units
const HANDLE_RADIUS = 0.35
const COLORS = { width: 0xe53935, depth: 0x43a047, height: 0x1e88e5 }
const COLOR_HEX = { width: '#e53935', depth: '#43a047', height: '#1e88e5' }

export default function CubeEditor({ width, depth, height, onChange, onClose, onDone }) {
  const mountRef = useRef(null)
  const stateRef = useRef({ width, depth, height })
  const threeRef = useRef(null)
  const [dims, setDims] = useState({ width, depth, height })

  const clamp = (v) => Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(v)))

  const updateCube = useCallback(() => {
    const t = threeRef.current
    if (!t) return
    const { width: w, depth: d, height: h } = stateRef.current
    const sw = w * SCALE, sd = d * SCALE, sh = h * SCALE

    // Update cube geometry
    t.cube.geometry.dispose()
    t.cube.geometry = new THREE.BoxGeometry(sw, sh, sd)
    t.edges.geometry.dispose()
    t.edges.geometry = new THREE.EdgesGeometry(t.cube.geometry)

    // Update handles
    t.handleW.position.set(sw / 2, 0, 0)
    t.handleD.position.set(0, 0, sd / 2)
    t.handleH.position.set(0, sh / 2, 0)

    // Update labels
    t.labelW.position.set(sw / 2 + 0.3, 0, 0)
    t.labelD.position.set(0, 0, sd / 2 + 0.3)
    t.labelH.position.set(0, sh / 2 + 0.3, 0)
    updateLabelText(t.labelW, `${w}"`, COLOR_HEX.width)
    updateLabelText(t.labelD, `${d}"`, COLOR_HEX.depth)
    updateLabelText(t.labelH, `${h}"`, COLOR_HEX.height)

    // Update axis lines
    updateAxisLine(t.axisW, [[0, 0, 0], [sw / 2, 0, 0]])
    updateAxisLine(t.axisD, [[0, 0, 0], [0, 0, sd / 2]])
    updateAxisLine(t.axisH, [[0, 0, 0], [0, sh / 2, 0]])
  }, [])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const rect = mount.getBoundingClientRect()
    const W = rect.width || 400, H = rect.height || 400

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xfafafa)

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)
    camera.position.set(3, 2.5, 4)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.enablePan = false
    controls.minDistance = 2
    controls.maxDistance = 12

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dl = new THREE.DirectionalLight(0xffffff, 0.5)
    dl.position.set(5, 8, 5)
    scene.add(dl)

    // Grid
    const grid = new THREE.GridHelper(6, 12, 0xe0e0e0, 0xf0f0f0)
    grid.position.y = -0.01
    scene.add(grid)

    // Cube
    const sw = width * SCALE, sd = depth * SCALE, sh = height * SCALE
    const cubeGeo = new THREE.BoxGeometry(sw, sh, sd)
    const cubeMat = new THREE.MeshPhysicalMaterial({
      color: 0x90caf9, transparent: true, opacity: 0.15,
      roughness: 0.3, metalness: 0, side: THREE.DoubleSide
    })
    const cube = new THREE.Mesh(cubeGeo, cubeMat)
    scene.add(cube)

    const edgesGeo = new THREE.EdgesGeometry(cubeGeo)
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x42a5f5, linewidth: 1 })
    const edges = new THREE.LineSegments(edgesGeo, edgesMat)
    scene.add(edges)

    // Handles
    const makeHandle = (color, pos) => {
      const geo = new THREE.SphereGeometry(HANDLE_RADIUS, 16, 16)
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      scene.add(mesh)
      return mesh
    }
    const handleW = makeHandle(COLORS.width, new THREE.Vector3(sw / 2, 0, 0))
    const handleD = makeHandle(COLORS.depth, new THREE.Vector3(0, 0, sd / 2))
    const handleH = makeHandle(COLORS.height, new THREE.Vector3(0, sh / 2, 0))
    handleW.userData.axis = 'width'
    handleD.userData.axis = 'depth'
    handleH.userData.axis = 'height'

    // Axis lines
    const makeAxisLine = (color, points) => {
      const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 })
      const line = new THREE.Line(geo, mat)
      scene.add(line)
      return line
    }
    const axisW = makeAxisLine(COLORS.width, [[0, 0, 0], [sw / 2, 0, 0]])
    const axisD = makeAxisLine(COLORS.depth, [[0, 0, 0], [0, 0, sd / 2]])
    const axisH = makeAxisLine(COLORS.height, [[0, 0, 0], [0, sh / 2, 0]])

    // Labels
    const makeLabel = (text, color, pos) => {
      const canvas = document.createElement('canvas')
      canvas.width = 128; canvas.height = 48
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }))
      sprite.scale.set(0.8, 0.3, 1)
      sprite.position.copy(pos)
      sprite.userData.canvas = canvas
      scene.add(sprite)
      updateLabelText(sprite, text, color)
      return sprite
    }
    const labelW = makeLabel(`${width}"`, COLOR_HEX.width, new THREE.Vector3(sw / 2 + 0.3, 0, 0))
    const labelD = makeLabel(`${depth}"`, COLOR_HEX.depth, new THREE.Vector3(0, 0, sd / 2 + 0.3))
    const labelH = makeLabel(`${height}"`, COLOR_HEX.height, new THREE.Vector3(0, sh / 2 + 0.3, 0))

    threeRef.current = { scene, camera, renderer, controls, cube, edges, handleW, handleD, handleH, labelW, labelD, labelH, axisW, axisD, axisH }

    // Raycasting / dragging
    const raycaster = new THREE.Raycaster()
    raycaster.params.Mesh = { threshold: 0 }
    const mouse = new THREE.Vector2()
    let dragging = null
    const dragPlane = new THREE.Plane()
    const intersection = new THREE.Vector3()
    const handles = [handleW, handleD, handleH]

    const getPointer = (e) => {
      const ev = e.touches ? e.touches[0] : e
      const r = renderer.domElement.getBoundingClientRect()
      mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1
      mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1
    }

    const onDown = (e) => {
      getPointer(e)
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(handles)
      if (hits.length > 0) {
        dragging = hits[0].object
        controls.enabled = false
        // Set drag plane perpendicular to camera
        const camDir = new THREE.Vector3()
        camera.getWorldDirection(camDir)
        dragPlane.setFromNormalAndCoplanarPoint(camDir, dragging.position)
        e.preventDefault && e.preventDefault()
      }
    }
    const onMove = (e) => {
      if (!dragging) return
      getPointer(e)
      raycaster.setFromCamera(mouse, camera)
      if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        const axis = dragging.userData.axis
        const s = stateRef.current
        if (axis === 'width') {
          s.width = clamp(Math.abs(intersection.x) * 2 / SCALE)
        } else if (axis === 'depth') {
          s.depth = clamp(Math.abs(intersection.z) * 2 / SCALE)
        } else {
          s.height = clamp(Math.abs(intersection.y) * 2 / SCALE)
        }
        setDims({ ...s })
        updateCube()
      }
    }
    const onUp = () => {
      if (dragging) {
        dragging = null
        controls.enabled = true
      }
    }

    const el = renderer.domElement
    el.addEventListener('mousedown', onDown)
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseup', onUp)
    el.addEventListener('touchstart', onDown, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onUp)

    // Animate
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize
    const onResize = () => {
      const r = mount.getBoundingClientRect()
      camera.aspect = r.width / r.height
      camera.updateProjectionMatrix()
      renderer.setSize(r.width, r.height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseup', onUp)
      el.removeEventListener('touchstart', onDown)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onUp)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '500px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #f0f0f0' }}>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Set Dimensions</h3>
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: COLOR_HEX.width }}>● W: {dims.width}"</span>
            <span style={{ color: COLOR_HEX.depth }}>● D: {dims.depth}"</span>
            <span style={{ color: COLOR_HEX.height }}>● H: {dims.height}"</span>
            <span style={{ marginLeft: 'auto', background: '#f0f7ff', padding: '3px 10px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, color: '#1e88e5' }}>
              {((dims.width * dims.depth * dims.height) / 1728).toFixed(1)} ft³
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>Drag the colored handles to resize • Drag background to orbit</div>
        </div>

        {/* Canvas */}
        <div ref={mountRef} style={{ width: '100%', height: '55vw', maxHeight: '360px', minHeight: '250px' }} />

        {/* Manual inputs */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {['width', 'depth', 'height'].map((axis) => (
            <div key={axis} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: COLOR_HEX[axis], textTransform: 'uppercase' }}>{axis[0]}</span>
              <input type="number" min={MIN_DIM} max={MAX_DIM} value={dims[axis]}
                onChange={(e) => {
                  const v = clamp(parseInt(e.target.value, 10) || MIN_DIM)
                  stateRef.current[axis] = v
                  setDims({ ...stateRef.current })
                  updateCube()
                }}
                style={{
                  width: '100%', padding: '6px 4px', textAlign: 'center',
                  border: `1.5px solid ${COLOR_HEX[axis]}40`, borderRadius: '6px',
                  fontSize: '15px', fontWeight: 500, outline: 'none',
                }}
              />
            </div>
          ))}
          <span style={{ fontSize: '13px', color: '#999', alignSelf: 'flex-end', paddingBottom: '8px' }}>in</span>
        </div>

        {/* Buttons */}
        <div style={{ padding: '12px 20px 16px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '10px 20px', background: '#f0f0f0', color: '#666',
            border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 600, cursor: 'pointer'
          }}>Cancel</button>
          <button onClick={() => onDone(stateRef.current)} style={{
            padding: '10px 24px', background: '#2196F3', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 600, cursor: 'pointer'
          }}>Done</button>
        </div>
      </div>
    </div>
  )
}

function updateLabelText(sprite, text, color) {
  const canvas = sprite.userData.canvas
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 128, 48)
  ctx.font = 'bold 28px -apple-system, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 24)
  sprite.material.map.needsUpdate = true
}

function updateAxisLine(line, points) {
  const pos = line.geometry.attributes.position
  points.forEach((p, i) => { pos.setXYZ(i, ...p) })
  pos.needsUpdate = true
}
