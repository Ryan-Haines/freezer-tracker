import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const MIN_DIM = 4, MAX_DIM = 72
const SCALE = 0.04 // inches to 3D units
const HANDLE_RADIUS = 0.35
const COLORS = { width: 0x1565c0, depth: 0x388e3c, height: 0x42a5f5 }
const COLOR_HEX = { width: '#1565c0', depth: '#388e3c', height: '#42a5f5' }

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
    // Frozen gradient background
    scene.background = new THREE.Color(0x0d47a1)

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)
    camera.position.set(3, 2.5, 4)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x0d47a1, 1)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.enablePan = false
    controls.minDistance = 2
    controls.maxDistance = 12

    // Frozen lighting - cooler tones
    scene.add(new THREE.AmbientLight(0x64b5f6, 0.7))
    const dl = new THREE.DirectionalLight(0xe3f2fd, 0.8)
    dl.position.set(5, 8, 5)
    dl.castShadow = true
    scene.add(dl)

    // Ice grid - more crystalline
    const grid = new THREE.GridHelper(6, 12, 0x42a5f5, 0x1976d2)
    grid.position.y = -0.01
    grid.material.opacity = 0.3
    grid.material.transparent = true
    scene.add(grid)

    // Frozen cube - ice-like material
    const sw = width * SCALE, sd = depth * SCALE, sh = height * SCALE
    const cubeGeo = new THREE.BoxGeometry(sw, sh, sd)
    const cubeMat = new THREE.MeshPhysicalMaterial({
      color: 0x64b5f6,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.8,
      thickness: 0.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide
    })
    const cube = new THREE.Mesh(cubeGeo, cubeMat)
    scene.add(cube)

    const edgesGeo = new THREE.EdgesGeometry(cubeGeo)
    const edgesMat = new THREE.LineBasicMaterial({ 
      color: 0xe3f2fd, 
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    })
    const edges = new THREE.LineSegments(edgesGeo, edgesMat)
    scene.add(edges)

    // Frozen handles with glow
    const makeHandle = (color, pos) => {
      const geo = new THREE.SphereGeometry(HANDLE_RADIUS, 16, 16)
      const mat = new THREE.MeshStandardMaterial({ 
        color, 
        emissive: color, 
        emissiveIntensity: 0.4,
        roughness: 0.3,
        metalness: 0.7
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      scene.add(mesh)
      
      // Add glow effect
      const glowGeo = new THREE.SphereGeometry(HANDLE_RADIUS * 1.3, 16, 16)
      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.2
      })
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.position.copy(pos)
      scene.add(glow)
      mesh.userData.glow = glow
      
      return mesh
    }
    const handleW = makeHandle(COLORS.width, new THREE.Vector3(sw / 2, 0, 0))
    const handleD = makeHandle(COLORS.depth, new THREE.Vector3(0, 0, sd / 2))
    const handleH = makeHandle(COLORS.height, new THREE.Vector3(0, sh / 2, 0))
    handleW.userData.axis = 'width'
    handleD.userData.axis = 'depth'
    handleH.userData.axis = 'height'

    // Ice-colored axis lines
    const makeAxisLine = (color, points) => {
      const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
      const mat = new THREE.LineBasicMaterial({ 
        color, 
        linewidth: 3,
        transparent: true,
        opacity: 0.8
      })
      const line = new THREE.Line(geo, mat)
      scene.add(line)
      return line
    }
    const axisW = makeAxisLine(COLORS.width, [[0, 0, 0], [sw / 2, 0, 0]])
    const axisD = makeAxisLine(COLORS.depth, [[0, 0, 0], [0, 0, sd / 2]])
    const axisH = makeAxisLine(COLORS.height, [[0, 0, 0], [0, sh / 2, 0]])

    // Frozen labels
    const makeLabel = (text, color, pos) => {
      const canvas = document.createElement('canvas')
      canvas.width = 128; canvas.height = 48
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ 
        map: new THREE.CanvasTexture(canvas), 
        depthTest: false,
        transparent: true
      }))
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
        // Enhance handle when dragging
        dragging.material.emissiveIntensity = 0.6
        dragging.userData.glow.material.opacity = 0.4
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
        // Reset handle appearance
        dragging.material.emissiveIntensity = 0.4
        dragging.userData.glow.material.opacity = 0.2
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

    // Animate with subtle floating effect
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      
      // Subtle floating animation for handles
      const time = Date.now() * 0.001
      handles.forEach((handle, i) => {
        const originalY = handle.position.y
        handle.userData.glow.position.copy(handle.position)
        handle.userData.glow.position.y += Math.sin(time + i) * 0.02
      })
      
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
      background: 'rgba(13,71,161,0.95)', 
      backdropFilter: 'blur(20px)',
      zIndex: 9999,
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '16px',
      fontFamily: "'Exo 2', monospace"
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      
      {/* Floating frost particles */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        backgroundImage: `
          radial-gradient(2px 2px at 20px 30px, rgba(255,255,255,0.3), transparent),
          radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.2), transparent),
          radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.4), transparent),
          radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.3), transparent)
        `,
        backgroundRepeat: 'repeat',
        backgroundSize: '200px 150px',
        animation: 'frost-drift 25s linear infinite'
      }} />
      
      <style>{`
        @keyframes frost-drift {
          0% { transform: translateY(0px) translateX(0px); }
          25% { transform: translateY(-15px) translateX(8px); }
          50% { transform: translateY(-8px) translateX(-8px); }
          75% { transform: translateY(-20px) translateX(5px); }
          100% { transform: translateY(-25px) translateX(0px); }
        }
        
        @keyframes frost-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(100,181,246,0.3); }
          50% { box-shadow: 0 0 30px rgba(100,181,246,0.6); }
        }
      `}</style>
      
      <div style={{
        background: 'rgba(255,255,255,0.1)', 
        backdropFilter: 'blur(30px)',
        borderRadius: '20px', 
        width: '100%', 
        maxWidth: '520px',
        maxHeight: '90vh', 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        boxShadow: `
          0 25px 80px rgba(13,71,161,0.4),
          inset 0 1px 0 rgba(255,255,255,0.3),
          inset 0 -1px 0 rgba(255,255,255,0.1)
        `,
        border: '2px solid rgba(255,255,255,0.2)',
        position: 'relative'
      }}>
        
        {/* Ice crystal pattern overlay */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.03,
          backgroundImage: `
            linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.2) 50%, transparent 60%),
            linear-gradient(-45deg, transparent 40%, rgba(255,255,255,0.2) 50%, transparent 60%)
          `,
          backgroundSize: '30px 30px',
          pointerEvents: 'none',
          borderRadius: '20px'
        }} />
        
        {/* Header */}
        <div style={{ 
          padding: '20px 24px 16px', 
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          position: 'relative',
          zIndex: 1
        }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: '20px', 
            fontWeight: 800, 
            color: 'white',
            letterSpacing: '1px',
            textShadow: '0 2px 8px rgba(13,71,161,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            🧊 FREEZER DIMENSIONS
          </h3>
          <div style={{ 
            display: 'flex', 
            gap: '18px', 
            marginTop: '12px', 
            fontSize: '15px', 
            alignItems: 'center', 
            flexWrap: 'wrap' 
          }}>
            <span style={{ 
              color: COLOR_HEX.width, 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              textShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }}>
              <span style={{ fontSize: '12px' }}>●</span> W: {dims.width}"
            </span>
            <span style={{ 
              color: COLOR_HEX.depth, 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              textShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }}>
              <span style={{ fontSize: '12px' }}>●</span> D: {dims.depth}"
            </span>
            <span style={{ 
              color: COLOR_HEX.height, 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              textShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }}>
              <span style={{ fontSize: '12px' }}>●</span> H: {dims.height}"
            </span>
            <span style={{ 
              marginLeft: 'auto', 
              background: 'rgba(255,255,255,0.15)', 
              backdropFilter: 'blur(10px)',
              padding: '6px 14px', 
              borderRadius: '16px', 
              fontSize: '14px', 
              fontWeight: 800, 
              color: '#e3f2fd',
              border: '1px solid rgba(255,255,255,0.2)',
              textShadow: '0 1px 3px rgba(0,0,0,0.3)',
              boxShadow: '0 4px 16px rgba(13,71,161,0.3)'
            }}>
              {((dims.width * dims.depth * dims.height) / 1728).toFixed(1)} ft³
            </span>
          </div>
          <div style={{ 
            fontSize: '12px', 
            color: 'rgba(255,255,255,0.7)', 
            marginTop: '8px',
            fontWeight: 500,
            letterSpacing: '0.5px'
          }}>
            DRAG THE COLORED HANDLES TO RESIZE • DRAG BACKGROUND TO ORBIT
          </div>
        </div>

        {/* Canvas */}
        <div ref={mountRef} style={{ 
          width: '100%', 
          height: '55vw', 
          maxHeight: '380px', 
          minHeight: '280px',
          position: 'relative',
          zIndex: 1
        }} />

        {/* Manual inputs */}
        <div style={{ 
          padding: '16px 24px', 
          borderTop: '1px solid rgba(255,255,255,0.1)', 
          display: 'flex', 
          gap: '12px', 
          alignItems: 'center',
          position: 'relative',
          zIndex: 1
        }}>
          {['width', 'depth', 'height'].map((axis) => (
            <div key={axis} style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '6px' 
            }}>
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 800, 
                color: COLOR_HEX[axis], 
                textTransform: 'uppercase',
                letterSpacing: '1px',
                textShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }}>
                {axis === 'width' ? '◐ WIDTH' : axis === 'depth' ? '◑ DEPTH' : '◒ HEIGHT'}
              </span>
              <input type="number" min={MIN_DIM} max={MAX_DIM} value={dims[axis]}
                onChange={(e) => {
                  const v = clamp(parseInt(e.target.value, 10) || MIN_DIM)
                  stateRef.current[axis] = v
                  setDims({ ...stateRef.current })
                  updateCube()
                }}
                style={{
                  width: '100%', 
                  padding: '8px 6px', 
                  textAlign: 'center',
                  border: `2px solid ${COLOR_HEX[axis]}40`, 
                  borderRadius: '10px',
                  fontSize: '16px', 
                  fontWeight: 700, 
                  outline: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(10px)',
                  color: 'white',
                  letterSpacing: '0.5px',
                  boxShadow: `0 4px 16px ${COLOR_HEX[axis]}20`,
                  transition: 'all 0.3s ease'
                }}
              />
            </div>
          ))}
          <span style={{ 
            fontSize: '14px', 
            color: 'rgba(255,255,255,0.8)', 
            alignSelf: 'flex-end', 
            paddingBottom: '10px',
            fontWeight: 700,
            letterSpacing: '0.5px'
          }}>INCHES</span>
        </div>

        {/* Buttons */}
        <div style={{ 
          padding: '16px 24px 20px', 
          display: 'flex', 
          gap: '12px', 
          justifyContent: 'flex-end',
          position: 'relative',
          zIndex: 1
        }}>
          <button onClick={onClose} style={{
            padding: '12px 24px', 
            background: 'rgba(255,255,255,0.1)', 
            color: 'rgba(255,255,255,0.8)',
            border: '2px solid rgba(255,255,255,0.2)', 
            borderRadius: '12px', 
            fontSize: '15px', 
            fontWeight: 700, 
            cursor: 'pointer',
            backdropFilter: 'blur(10px)',
            letterSpacing: '0.5px',
            transition: 'all 0.3s ease'
          }}>CANCEL</button>
          <button onClick={() => onDone(stateRef.current)} style={{
            padding: '12px 28px', 
            background: 'linear-gradient(145deg, #1565c0, #0d47a1)', 
            color: '#fff',
            border: '2px solid rgba(255,255,255,0.3)', 
            borderRadius: '12px', 
            fontSize: '15px', 
            fontWeight: 700, 
            cursor: 'pointer',
            backdropFilter: 'blur(10px)',
            letterSpacing: '0.5px',
            boxShadow: '0 8px 32px rgba(21,101,192,0.4)',
            transition: 'all 0.3s ease',
            animation: 'frost-glow 3s ease-in-out infinite'
          }}>APPLY DIMENSIONS</button>
        </div>
      </div>
    </div>
  )
}

function updateLabelText(sprite, text, color) {
  const canvas = sprite.userData.canvas
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 128, 48)
  ctx.font = "bold 28px 'Exo 2', monospace"
  ctx.fillStyle = color
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.strokeText(text, 64, 24)
  ctx.fillText(text, 64, 24)
  sprite.material.map.needsUpdate = true
}

function updateAxisLine(line, points) {
  const pos = line.geometry.attributes.position
  points.forEach((p, i) => { pos.setXYZ(i, ...p) })
  pos.needsUpdate = true
}