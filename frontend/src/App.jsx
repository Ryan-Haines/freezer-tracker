import { useState, useEffect, useRef, useCallback, Component } from 'react'
import CubeEditor from './CubeEditor'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return (
      <div style={{ 
        padding: '40px 20px', textAlign: 'center', 
        fontFamily: "'Exo 2', monospace",
        background: 'linear-gradient(135deg, #0d47a1 0%, #1565c0 25%, #1976d2 50%, #42a5f5 100%)',
        minHeight: '100vh', color: 'white', display: 'flex', flexDirection: 'column', 
        justifyContent: 'center', alignItems: 'center'
      }}>
        <div style={{ fontSize: '64px', marginBottom: '20px', filter: 'drop-shadow(0 4px 12px rgba(13,71,161,0.5))' }}>🧊</div>
        <h2 style={{ marginBottom: '12px', fontWeight: 600, letterSpacing: '1px', textShadow: '0 2px 8px rgba(13,71,161,0.7)' }}>SYSTEM MALFUNCTION</h2>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginBottom: '20px', fontWeight: 400 }}>{this.state.error.message}</p>
        <button onClick={() => window.location.reload()} style={{ 
          padding: '12px 28px', background: 'rgba(255,255,255,0.1)', color: 'white', 
          border: '2px solid rgba(255,255,255,0.3)', borderRadius: '8px', fontSize: '15px', 
          cursor: 'pointer', fontFamily: "'Exo 2', monospace", fontWeight: 600, letterSpacing: '0.5px',
          backdropFilter: 'blur(10px)', transition: 'all 0.3s ease',
          boxShadow: '0 8px 32px rgba(13,71,161,0.3)'
        }}>RESTART SYSTEM</button>
      </div>
    )
    return this.props.children
  }
}

const API_BASE = '/api'
const DEFAULT_W = 33, DEFAULT_D = 20, DEFAULT_H = 34
const VOLUME_ESTIMATES = { lbs: 245, g: 0.15, gallon: 315, count: 350 }
const SWIPE_THRESHOLD = 60
const SWIPE_MAX = 140

function SwipeRow({ children, onEdit, onDelete, disabled }) {
  const rowRef = useRef(null)
  const startX = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)
  const [offset, setOffset] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  const close = useCallback(() => {
    setTransitioning(true)
    setOffset(0)
    setTimeout(() => setTransitioning(false), 250)
  }, [])

  const handleStart = (x) => {
    if (disabled) return
    startX.current = x
    currentX.current = x
    swiping.current = true
    setTransitioning(false)
  }
  const handleMove = (x) => {
    if (!swiping.current) return
    currentX.current = x
    let diff = startX.current - x
    if (offset > 0) diff += offset
    diff = Math.max(0, Math.min(SWIPE_MAX, diff))
    setOffset(diff)
  }
  const handleEnd = () => {
    swiping.current = false
    setTransitioning(true)
    setOffset(prev => prev > SWIPE_THRESHOLD ? SWIPE_MAX : 0)
    setTimeout(() => setTransitioning(false), 250)
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
      {/* Action buttons behind */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        display: 'flex', width: `${SWIPE_MAX}px`,
      }}>
        <button onClick={() => { onEdit(); close() }} style={{
          flex: 1, border: 'none', color: '#fff', backgroundColor: '#1565c0',
          fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: "'Exo 2', monospace",
          letterSpacing: '0.5px', textShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }}>EDIT</button>
        <button onClick={() => { onDelete(); close() }} style={{
          flex: 1, border: 'none', color: '#fff', backgroundColor: '#d32f2f',
          fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: "'Exo 2', monospace",
          letterSpacing: '0.5px', textShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }}>DELETE</button>
      </div>
      {/* Foreground row */}
      <div
        ref={rowRef}
        onTouchStart={e => handleStart(e.touches[0].clientX)}
        onTouchMove={e => handleMove(e.touches[0].clientX)}
        onTouchEnd={handleEnd}
        onMouseDown={e => handleStart(e.clientX)}
        onMouseMove={e => { if (swiping.current) handleMove(e.clientX) }}
        onMouseUp={handleEnd}
        onMouseLeave={() => { if (swiping.current) handleEnd() }}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: transitioning ? 'transform 0.25s ease' : 'none',
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          position: 'relative',
          zIndex: 1,
          userSelect: swiping.current ? 'none' : 'auto',
          cursor: 'default',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function App() {
  const [containers, setContainers] = useState([])
  const [activeContainerId, setActiveContainerId] = useState(() => {
    const saved = localStorage.getItem('freezer-active-tab')
    return saved ? parseInt(saved, 10) : null
  })
  const [items, setItems] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [naturalInput, setNaturalInput] = useState('')
  const [parsing, setParsing] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [newItem, setNewItem] = useState({ name: '', quantity: '', unit: 'count' })
  const [showAddRow, setShowAddRow] = useState(false)
  const [sortKey, setSortKey] = useState('quantity')
  const [sortAsc, setSortAsc] = useState(false)
  const [calibration, setCalibration] = useState(() => {
    const saved = localStorage.getItem('freezer-calibration')
    return saved ? JSON.parse(saved) : null
  })
  const [editingCapacity, setEditingCapacity] = useState(false)
  const [capacityInput, setCapacityInput] = useState('')
  
  // Container management state
  const [showAddContainer, setShowAddContainer] = useState(false)
  const [newContainer, setNewContainer] = useState({ name: '', icon: '', width: DEFAULT_W, depth: DEFAULT_D, height: DEFAULT_H })
  
  // Cube editor state
  const [showCubeEditor, setShowCubeEditor] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [cubeEditorTarget, setCubeEditorTarget] = useState(null) // null = new container, container id = editing existing
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [speechRecognition, setSpeechRecognition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const activeContainer = containers.find(c => c.id === activeContainerId)

  const getContainerVolume = () => {
    if (!activeContainer) return DEFAULT_W * DEFAULT_D * DEFAULT_H
    return (activeContainer.width || DEFAULT_W) * (activeContainer.depth || DEFAULT_D) * (activeContainer.height || DEFAULT_H)
  }
  const calculateRawCapacity = () => {
    let total = 0
    items.forEach(i => { total += i.quantity * (VOLUME_ESTIMATES[i.unit] || VOLUME_ESTIMATES.count) })
    return (total / getContainerVolume()) * 100
  }
  const rawCapacity = calculateRawCapacity()
  const getCalibratedCapacity = () => {
    if (!calibration) return Math.min(100, Math.round(rawCapacity))
    return Math.min(100, Math.round(rawCapacity * (calibration.calibratedValue / calibration.rawAuto)))
  }
  const capacityPercent = getCalibratedCapacity()
  const isCalibrated = calibration !== null

  const saveManualCapacity = () => {
    const val = parseInt(capacityInput, 10)
    if (!isNaN(val) && val >= 0 && val <= 100) {
      const c = { rawAuto: rawCapacity, calibratedValue: val }
      setCalibration(c)
      localStorage.setItem('freezer-calibration', JSON.stringify(c))
    }
    setEditingCapacity(false)
  }
  const resetCalibration = () => { setCalibration(null); localStorage.removeItem('freezer-calibration') }

  const fetchContainers = async () => { 
    try {
      const r = await fetch(`${API_BASE}/containers`)
      if (!r.ok) throw new Error(`Failed to load containers (${r.status})`)
      const containersList = await r.json()
      setContainers(containersList)
      
      // Set active container if not set or invalid
      if (!activeContainerId || !containersList.find(c => c.id === activeContainerId)) {
        const firstContainer = containersList[0]
        if (firstContainer) {
          setActiveContainerId(firstContainer.id)
          localStorage.setItem('freezer-active-tab', firstContainer.id.toString())
        }
      }
    } catch (err) {
      console.error('fetchContainers failed:', err)
      setLoadError(err.message)
    }
  }
  
  const fetchItems = async () => { 
    try {
      const url = activeContainerId ? `${API_BASE}/items?container_id=${activeContainerId}` : `${API_BASE}/items`
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Failed to load items (${r.status})`)
      setItems(await r.json())
    } catch (err) {
      console.error('fetchItems failed:', err)
      setLoadError(err.message)
    }
  }
  
  const fetchLastUpdated = async () => { 
    try {
      const r = await fetch(`${API_BASE}/last-updated`)
      if (r.ok) setLastUpdated((await r.json()).last_updated)
    } catch (err) {
      console.error('fetchLastUpdated failed:', err)
    }
  }
  
  useEffect(() => { 
    Promise.all([fetchContainers(), fetchLastUpdated()]).finally(() => setLoading(false))
  }, [])
  useEffect(() => { if (activeContainerId) fetchItems() }, [activeContainerId])

  const handleNaturalSubmit = async (e) => {
    e.preventDefault()
    if (!naturalInput.trim() || parsing) return
    setParsing(true)
    try {
      await fetch(`${API_BASE}/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: naturalInput, container_id: activeContainerId })
      })
      setNaturalInput('')
      fetchItems(); fetchLastUpdated()
    } finally { setParsing(false) }
  }

  const handleDelete = async (id) => { await fetch(`${API_BASE}/items/${id}`, { method: 'DELETE' }); fetchItems(); fetchLastUpdated() }
  const startEditing = (item) => { setEditingId(item.id); setEditForm({ name: item.name, quantity: item.quantity, unit: item.unit }) }
  const saveEdit = async (id) => {
    await fetch(`${API_BASE}/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) })
    setEditingId(null); fetchItems(); fetchLastUpdated()
  }
  const cancelEdit = () => { setEditingId(null); setEditForm({}) }
  const handleAddNew = async () => {
    if (!newItem.name || !newItem.quantity) return
    await fetch(`${API_BASE}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newItem, quantity: parseFloat(newItem.quantity), container_id: activeContainerId }) })
    setNewItem({ name: '', quantity: '', unit: 'count' }); setShowAddRow(false); fetchItems(); fetchLastUpdated()
  }
  
  // Container management handlers
  const handleTabClick = (containerId) => {
    setActiveContainerId(containerId)
    localStorage.setItem('freezer-active-tab', containerId.toString())
  }
  
  const handleAddContainer = async () => {
    if (!newContainer.name.trim() && !newContainer.icon.trim()) return
    if (!newContainer.width || !newContainer.depth || !newContainer.height) return
    try {
      await fetch(`${API_BASE}/containers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newContainer.name,
          icon: newContainer.icon,
          width: parseInt(newContainer.width, 10),
          depth: parseInt(newContainer.depth, 10),
          height: parseInt(newContainer.height, 10),
        })
      })
      setNewContainer({ name: '', icon: '', width: DEFAULT_W, depth: DEFAULT_D, height: DEFAULT_H })
      setShowAddContainer(false)
      fetchContainers()
    } catch (error) {
      console.error('Failed to create container:', error)
    }
  }
  
  const handleDeleteContainer = async () => {
    if (deleteConfirmText.toLowerCase() !== 'nofood') return
    try {
      await fetch(`${API_BASE}/containers/${activeContainerId}`, { method: 'DELETE' })
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
      fetchContainers()
      fetchLastUpdated()
    } catch (error) {
      console.error('Failed to delete container:', error)
    }
  }
  
  // Voice recording handlers
  const startVoiceRecording = async () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser')
      return
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    
    recognition.onstart = () => setIsRecording(true)
    recognition.onend = () => setIsRecording(false)
    recognition.onerror = () => {
      setIsRecording(false)
      alert('Speech recognition error occurred')
    }
    
    recognition.onresult = async (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join(' ')
        .trim()
      
      if (transcript) {
        try {
          await fetch(`${API_BASE}/parse-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: transcript, container_id: activeContainerId })
          })
          fetchItems()
          fetchLastUpdated()
        } catch (error) {
          console.error('Failed to process voice input:', error)
          alert('Failed to process voice input')
        }
      }
    }
    
    setSpeechRecognition(recognition)
    recognition.start()
  }
  
  const stopVoiceRecording = () => {
    if (speechRecognition) {
      speechRecognition.stop()
      setSpeechRecognition(null)
    }
  }

  // Backend stores UTC without Z suffix — normalize before parsing
  const toDate = (d) => d ? new Date(d.endsWith('Z') ? d : d + 'Z') : null
  const formatDate = (d) => {
    const date = toDate(d)
    if (!date) return ''
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    const year = String(date.getFullYear()).slice(-2)
    return `${month} '${year}`
  }
  const formatDateTime = (d) => {
    const date = toDate(d)
    return date ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'
  }

  const getCapacityColor = () => {
    if (capacityPercent >= 90) return '#d32f2f'
    if (capacityPercent >= 80) return '#f57c00'
    if (capacityPercent >= 60) return '#388e3c'
    return '#1565c0'
  }
  
  const getCapacityGlow = () => {
    if (capacityPercent >= 90) return '0 0 20px rgba(211,47,47,0.6)'
    if (capacityPercent >= 80) return '0 0 20px rgba(245,124,0,0.6)'
    if (capacityPercent >= 60) return '0 0 20px rgba(56,142,60,0.6)'
    return '0 0 20px rgba(21,101,192,0.6)'
  }

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(key === 'name' || key === 'unit') }
  }

  const sortedItems = [...items].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name' || sortKey === 'unit') cmp = (a[sortKey] || '').localeCompare(b[sortKey] || '')
    else if (sortKey === 'quantity') cmp = a.quantity - b.quantity
    else if (sortKey === 'date_added') cmp = (toDate(a.date_added) || 0) - (toDate(b.date_added) || 0)
    return sortAsc ? cmp : -cmp
  })

  const SortHeader = ({ label, field, style: s }) => (
    <div onClick={() => handleSort(field)} style={{ 
      ...s, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
      transition: 'all 0.2s ease', fontFamily: "'Exo 2', monospace"
    }}>
      {label}
      {sortKey === field && <span style={{ fontSize: '10px', opacity: 0.8, color: '#64b5f6' }}>{sortAsc ? '▲' : '▼'}</span>}
    </div>
  )

  // Frozen CSS with cold color palette and frost effects
  const css = `
    :root {
      --frost-primary: #0d47a1;
      --frost-secondary: #1565c0;
      --frost-accent: #1976d2;
      --frost-light: #42a5f5;
      --frost-pale: #64b5f6;
      --frost-ice: #e3f2fd;
      --frost-white: rgba(255, 255, 255, 0.9);
      --frost-glass: rgba(255, 255, 255, 0.1);
      --frost-border: rgba(255, 255, 255, 0.2);
      --frost-shadow: rgba(13, 71, 161, 0.3);
    }
    
    * { 
      box-sizing: border-box; 
      margin: 0; 
      padding: 0; 
    }
    
    body { 
      font-family: 'Exo 2', monospace; 
      background: linear-gradient(135deg, var(--frost-primary) 0%, var(--frost-secondary) 25%, var(--frost-accent) 50%, var(--frost-light) 100%);
      color: var(--frost-white);
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      position: relative;
      overflow-x: hidden;
    }
    
    /* Animated frost particles */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
      background-image: 
        radial-gradient(2px 2px at 20px 30px, rgba(255,255,255,0.4), transparent),
        radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.3), transparent),
        radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.5), transparent),
        radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.4), transparent),
        radial-gradient(2px 2px at 160px 30px, rgba(255,255,255,0.3), transparent);
      background-repeat: repeat;
      background-size: 200px 150px;
      animation: frost-drift 20s linear infinite;
    }
    
    @keyframes frost-drift {
      0% { transform: translateY(0px) translateX(0px); }
      25% { transform: translateY(-10px) translateX(5px); }
      50% { transform: translateY(-5px) translateX(-5px); }
      75% { transform: translateY(-15px) translateX(3px); }
      100% { transform: translateY(-20px) translateX(0px); }
    }
    
    @keyframes frost-glow {
      0%, 100% { box-shadow: 0 0 20px rgba(100,181,246,0.3); }
      50% { box-shadow: 0 0 30px rgba(100,181,246,0.6); }
    }
    
    @keyframes ice-shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    
    input, select, button, textarea { 
      font-family: 'Exo 2', monospace; 
      letter-spacing: 0.5px;
    }
    
    @keyframes spin { 
      to { transform: rotate(360deg); } 
    }
    
    .tab-container::-webkit-scrollbar { display: none; }
    .tab-container { -ms-overflow-style: none; scrollbar-width: none; }
    
    /* Frost glass effect */
    .frost-glass {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 
        0 8px 32px rgba(13, 71, 161, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.3),
        inset 0 -1px 0 rgba(255, 255, 255, 0.1);
    }
    
    /* Ice crystal loading spinner */
    .ice-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top: 3px solid var(--frost-pale);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px var(--frost-shadow);
    }
  `

  const getContainerDisplayName = (container) => {
    if (container?.name && container?.icon) return `${container.icon} ${container.name}`
    return container?.name || container?.icon || 'Container'
  }
  
  // Check if Web Speech API is available
  const isVoiceAvailable = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window)
  
  if (loading) return (
    <>
      <style>{css}</style>
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, var(--frost-primary) 0%, var(--frost-secondary) 25%, var(--frost-accent) 50%, var(--frost-light) 100%)', 
        flexDirection: 'column', gap: '20px',
        position: 'relative', zIndex: 2
      }}>
        <div className="ice-spinner" />
        <span style={{ 
          color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 500, 
          letterSpacing: '1px', textShadow: '0 2px 8px var(--frost-shadow)',
          fontFamily: "'Exo 2', monospace"
        }}>LOADING FREEZER DATA...</span>
      </div>
    </>
  )

  if (loadError) return (
    <>
      <style>{css}</style>
      <div style={{ 
        padding: '40px 20px', textAlign: 'center', minHeight: '100vh', 
        background: 'linear-gradient(135deg, var(--frost-primary) 0%, var(--frost-secondary) 25%, var(--frost-accent) 50%, var(--frost-light) 100%)', 
        display: 'flex', flexDirection: 'column', alignItems: 'center', 
        justifyContent: 'center', gap: '16px',
        position: 'relative', zIndex: 2
      }}>
        <div style={{ fontSize: '64px', marginBottom: '8px', filter: 'drop-shadow(0 4px 12px var(--frost-shadow))' }}>❄️</div>
        <h2 style={{ color: 'var(--frost-white)', fontSize: '20px', fontWeight: 600, letterSpacing: '1px', textShadow: '0 2px 8px var(--frost-shadow)' }}>CONNECTION FROZEN</h2>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 400 }}>{loadError}</p>
        <button onClick={() => window.location.reload()} style={{ 
          padding: '12px 28px', background: 'var(--frost-glass)', color: 'white', 
          border: '2px solid var(--frost-border)', borderRadius: '10px', fontSize: '15px', 
          cursor: 'pointer', marginTop: '12px', fontWeight: 600, letterSpacing: '0.5px',
          backdropFilter: 'blur(20px)', transition: 'all 0.3s ease',
          boxShadow: '0 8px 32px var(--frost-shadow)'
        }}>RECONNECT</button>
      </div>
    </>
  )

  return (
    <>
      <style>{css}</style>
      <div style={{ 
        maxWidth: '600px', margin: '0 auto', padding: '16px', minHeight: '100vh',
        position: 'relative', zIndex: 2 
      }}>
        {/* Tab Bar - Freezer Drawer Handles */}
        <div className="tab-container" style={{
          display: 'flex', 
          gap: '8px', 
          marginBottom: '16px', 
          overflowX: 'auto',
          paddingBottom: '2px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}>
          {containers.map(container => (
            <div
              key={container.id}
              onClick={() => handleTabClick(container.id)}
              style={{
                padding: '10px 18px',
                borderRadius: '12px 12px 4px 4px',
                background: container.id === activeContainerId 
                  ? 'linear-gradient(145deg, rgba(255,255,255,0.2), rgba(255,255,255,0.1))' 
                  : 'rgba(255,255,255,0.08)',
                color: container.id === activeContainerId ? '#fff' : 'rgba(255,255,255,0.7)',
                fontSize: '14px',
                fontWeight: container.id === activeContainerId ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                border: container.id === activeContainerId 
                  ? '2px solid rgba(255,255,255,0.3)' 
                  : '2px solid rgba(255,255,255,0.1)',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(20px)',
                boxShadow: container.id === activeContainerId 
                  ? '0 8px 32px var(--frost-shadow), inset 0 1px 0 rgba(255,255,255,0.3)' 
                  : '0 4px 16px rgba(13,71,161,0.2)',
                letterSpacing: '0.5px',
                textShadow: container.id === activeContainerId ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                position: 'relative'
              }}
            >
              {container.id === activeContainerId && (
                <div style={{
                  position: 'absolute',
                  bottom: '-2px',
                  left: '10%',
                  right: '10%',
                  height: '3px',
                  background: 'linear-gradient(90deg, transparent, var(--frost-pale), transparent)',
                  borderRadius: '2px',
                  boxShadow: '0 0 8px var(--frost-pale)'
                }} />
              )}
              {getContainerDisplayName(container)}
            </div>
          ))}
          
          {/* Add container button */}
          <div
            onClick={() => setShowAddContainer(true)}
            style={{
              padding: '10px 18px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--frost-pale)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              border: '2px dashed rgba(255,255,255,0.3)',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(20px)',
              letterSpacing: '0.5px',
              textShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }}
          >
            + ADD FREEZER
          </div>
        </div>
        
        {/* Add container form */}
        {showAddContainer && (
          <div className="frost-glass" style={{
            padding: '16px',
            borderRadius: '16px',
            marginBottom: '16px',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Freezer name"
                value={newContainer.name}
                onChange={(e) => setNewContainer({ ...newContainer, name: e.target.value })}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '2px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  backdropFilter: 'blur(10px)',
                  outline: 'none',
                  fontWeight: 500,
                  letterSpacing: '0.5px'
                }}
              />
              <input
                type="text"
                placeholder="❄️"
                value={newContainer.icon}
                onChange={(e) => setNewContainer({ ...newContainer, icon: e.target.value })}
                style={{
                  width: '70px',
                  padding: '8px 12px',
                  border: '2px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  fontSize: '16px',
                  textAlign: 'center',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  backdropFilter: 'blur(10px)',
                  outline: 'none'
                }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => { setCubeEditorTarget(null); setShowCubeEditor(true) }}
                  className="frost-glass"
                  style={{
                    padding: '10px 16px', 
                    color: 'var(--frost-pale)',
                    border: '2px solid rgba(255,255,255,0.2)', 
                    borderRadius: '10px', 
                    fontSize: '13px',
                    fontWeight: 700, 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    letterSpacing: '0.5px',
                    transition: 'all 0.3s ease'
                  }}
                >🧊 SET DIMENSIONS</button>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>or</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    min="0.1"
                    max="200"
                    step="0.1"
                    value={((newContainer.width * newContainer.depth * newContainer.height) / 1728).toFixed(1)}
                    onChange={(e) => {
                      const cuft = parseFloat(e.target.value)
                      if (!cuft || cuft <= 0) return
                      const cubicInches = cuft * 1728
                      const curVol = newContainer.width * newContainer.depth * newContainer.height
                      const scale = Math.cbrt(cubicInches / (curVol || 1))
                      setNewContainer({
                        ...newContainer,
                        width: Math.max(4, Math.min(72, Math.round(newContainer.width * scale))),
                        depth: Math.max(4, Math.min(72, Math.round(newContainer.depth * scale))),
                        height: Math.max(4, Math.min(72, Math.round(newContainer.height * scale))),
                      })
                    }}
                    style={{
                      width: '70px', 
                      padding: '8px 10px', 
                      textAlign: 'center',
                      border: '2px solid rgba(255,255,255,0.2)', 
                      borderRadius: '8px', 
                      fontSize: '14px', 
                      fontWeight: 600,
                      background: 'rgba(255,255,255,0.1)',
                      color: 'white',
                      backdropFilter: 'blur(10px)',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>ft³</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleAddContainer}
                disabled={(!newContainer.name.trim() && !newContainer.icon.trim()) || !newContainer.width || !newContainer.depth || !newContainer.height}
                style={{
                  padding: '8px 16px',
                  background: ((!newContainer.name.trim() && !newContainer.icon.trim()) || !newContainer.width || !newContainer.depth || !newContainer.height) 
                    ? 'rgba(255,255,255,0.1)' 
                    : 'var(--frost-secondary)',
                  color: '#fff',
                  border: '2px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: ((!newContainer.name.trim() && !newContainer.icon.trim()) || !newContainer.width || !newContainer.depth || !newContainer.height) 
                    ? 'not-allowed' 
                    : 'pointer',
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(10px)',
                  transition: 'all 0.3s ease'
                }}
              >
                CREATE
              </button>
              <button
                onClick={() => { setShowAddContainer(false); setNewContainer({ name: '', icon: '', width: DEFAULT_W, depth: DEFAULT_D, height: DEFAULT_H }) }}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'rgba(255,255,255,0.7)',
                  border: '2px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(10px)'
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
        
        {/* Ice Gauge Capacity */}
        <div className="frost-glass" style={{
          padding: '16px 20px', 
          borderRadius: '16px', 
          marginBottom: '16px',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Ice crystal pattern overlay */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.1,
            backgroundImage: `
              radial-gradient(circle at 20% 20%, rgba(255,255,255,0.3) 2px, transparent 2px),
              radial-gradient(circle at 80% 80%, rgba(255,255,255,0.3) 1px, transparent 1px),
              radial-gradient(circle at 40% 60%, rgba(255,255,255,0.2) 1px, transparent 1px)
            `,
            backgroundSize: '30px 30px, 40px 40px, 25px 25px'
          }} />
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '12px', 
            flexWrap: 'wrap', 
            gap: '6px',
            position: 'relative',
            zIndex: 1 
          }}>
            {editingCapacity ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="number" min="0" max="100" value={capacityInput}
                  onChange={e => setCapacityInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveManualCapacity()}
                  style={{ 
                    width: '60px', 
                    padding: '6px 10px', 
                    fontSize: '16px', 
                    border: '2px solid var(--frost-pale)', 
                    borderRadius: '8px', 
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    backdropFilter: 'blur(10px)',
                    outline: 'none',
                    fontWeight: 700,
                    boxShadow: '0 0 10px rgba(100,181,246,0.4)'
                  }}
                  autoFocus />
                <span style={{ fontWeight: 700, fontSize: '18px', color: 'var(--frost-pale)' }}>%</span>
                <button onClick={saveManualCapacity} style={{ 
                  padding: '6px 12px', 
                  background: 'var(--frost-secondary)', 
                  color: '#fff', 
                  border: '2px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  fontSize: '13px', 
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(10px)'
                }}>SAVE</button>
                <button onClick={() => setEditingCapacity(false)} style={{ 
                  padding: '6px 12px', 
                  background: 'rgba(255,255,255,0.1)', 
                  color: 'rgba(255,255,255,0.7)', 
                  border: '2px solid rgba(255,255,255,0.1)', 
                  borderRadius: '8px', 
                  fontSize: '13px', 
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(10px)'
                }}>CANCEL</button>
              </div>
            ) : (
              <span onClick={() => { setCapacityInput(capacityPercent.toString()); setEditingCapacity(true) }}
                style={{ 
                  fontSize: '16px', 
                  fontWeight: 700, 
                  color: 'white', 
                  cursor: 'pointer',
                  letterSpacing: '0.5px',
                  textShadow: '0 2px 8px var(--frost-shadow)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                <span style={{ fontSize: '20px' }}>
                  {capacityPercent >= 90 ? '🔥' : capacityPercent >= 80 ? '⚠️' : '❄️'}
                </span>
                {isCalibrated ? 'CALIBRATED' : 'ESTIMATED'}: {capacityPercent}%
                {isCalibrated && <span style={{ fontSize: '12px', fontWeight: 400, opacity: 0.7 }}> (raw {Math.round(rawCapacity)}%)</span>}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isCalibrated && !editingCapacity && (
                <button onClick={resetCalibration} style={{ 
                  padding: '4px 10px', 
                  background: 'transparent', 
                  color: 'rgba(255,255,255,0.6)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '6px', 
                  fontSize: '11px', 
                  cursor: 'pointer',
                  fontWeight: 600,
                  letterSpacing: '0.5px'
                }}>RESET</button>
              )}
              <span
                onClick={() => { if (activeContainer) { setCubeEditorTarget(activeContainer.id); setShowCubeEditor(true) } }}
                style={{ 
                  fontSize: '11px', 
                  color: 'rgba(255,255,255,0.7)', 
                  cursor: activeContainer ? 'pointer' : 'default', 
                  textDecoration: activeContainer ? 'underline dotted' : 'none',
                  fontWeight: 600,
                  letterSpacing: '0.5px'
                }}
              >{activeContainer ? `${activeContainer.width}×${activeContainer.depth}×${activeContainer.height}"` : `${DEFAULT_W}×${DEFAULT_D}×${DEFAULT_H}"`}</span>
            </div>
          </div>
          
          {/* Ice Thermometer/Gauge */}
          <div style={{ 
            height: '12px', 
            background: 'rgba(255,255,255,0.1)', 
            borderRadius: '6px', 
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
          }}>
            <div style={{ 
              height: '100%', 
              width: `${capacityPercent}%`, 
              background: `linear-gradient(90deg, ${getCapacityColor()}, ${getCapacityColor()}dd)`,
              borderRadius: '6px', 
              transition: 'width 0.5s ease',
              position: 'relative',
              boxShadow: getCapacityGlow()
            }}>
              {/* Ice crystal effect on the fill */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                backgroundSize: '30px 100%',
                animation: 'ice-shimmer 3s ease-in-out infinite'
              }} />
            </div>
            {/* Temperature markers */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '25%',
              width: '1px',
              height: '6px',
              background: 'rgba(255,255,255,0.3)',
              transform: 'translateY(-50%)'
            }} />
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '1px',
              height: '6px',
              background: 'rgba(255,255,255,0.3)',
              transform: 'translateY(-50%)'
            }} />
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '75%',
              width: '1px',
              height: '6px',
              background: 'rgba(255,255,255,0.3)',
              transform: 'translateY(-50%)'
            }} />
          </div>
        </div>

        {/* Title */}
        <h1 style={{ 
          fontSize: '26px', 
          fontWeight: 800, 
          marginBottom: '4px',
          color: 'white',
          letterSpacing: '1px',
          textShadow: '0 4px 12px var(--frost-shadow)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '30px' }}>❄️</span>
          {activeContainer ? getContainerDisplayName(activeContainer).toUpperCase() : 'FREEZER INVENTORY'}
        </h1>
        <p style={{ 
          color: 'rgba(255,255,255,0.7)', 
          fontSize: '12px', 
          marginBottom: '16px',
          fontWeight: 500,
          letterSpacing: '0.5px'
        }}>LAST SYNC: {formatDateTime(lastUpdated).toUpperCase()}</p>

        {/* Voice fill button - only when container is empty */}
        {items.length === 0 && isVoiceAvailable && activeContainer && (
          <div style={{ marginBottom: '16px' }}>
            {!isRecording ? (
              <button
                onClick={startVoiceRecording}
                className="frost-glass"
                style={{
                  width: '100%',
                  padding: '18px',
                  color: '#fff',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderRadius: '16px',
                  fontSize: '16px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  letterSpacing: '0.5px',
                  transition: 'all 0.3s ease',
                  animation: 'frost-glow 2s ease-in-out infinite'
                }}
              >
                🎤 VOICE FILL {getContainerDisplayName(activeContainer).toUpperCase()}
              </button>
            ) : (
              <button
                onClick={stopVoiceRecording}
                style={{
                  width: '100%',
                  padding: '18px',
                  background: 'var(--frost-secondary)',
                  color: '#fff',
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderRadius: '16px',
                  fontSize: '16px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(20px)',
                  boxShadow: '0 0 20px rgba(211,47,47,0.6)'
                }}
              >
                <div style={{
                  width: '12px',
                  height: '12px',
                  background: '#fff',
                  borderRadius: '2px',
                  animation: 'frost-glow 1s ease-in-out infinite'
                }} />
                RECORDING... (TAP TO STOP)
              </button>
            )}
          </div>
        )}
        
        {/* Natural language input */}
        <form onSubmit={handleNaturalSubmit} style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <input type="text" value={naturalInput} onChange={e => setNaturalInput(e.target.value)}
            placeholder='e.g. "2 lbs chicken" or "take out 2 taro paste"'
            disabled={parsing}
            className="frost-glass"
            style={{
              flex: 1, 
              padding: '12px 16px', 
              fontSize: '15px',
              border: '2px solid rgba(255,255,255,0.2)', 
              borderRadius: '12px',
              color: 'white', 
              outline: 'none',
              opacity: parsing ? 0.6 : 1,
              fontWeight: 500,
              letterSpacing: '0.5px'
            }} />
          <button type="submit" disabled={parsing} style={{
            padding: '12px 24px', 
            background: parsing ? 'rgba(56,142,60,0.6)' : 'var(--frost-secondary)',
            color: '#fff', 
            border: '2px solid rgba(255,255,255,0.2)', 
            borderRadius: '12px', 
            fontSize: '15px',
            fontWeight: 700, 
            cursor: parsing ? 'not-allowed' : 'pointer',
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            minWidth: '80px', 
            justifyContent: 'center',
            backdropFilter: 'blur(20px)',
            letterSpacing: '0.5px',
            transition: 'all 0.3s ease'
          }}>
            {parsing ? (
              <span className="ice-spinner" style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
            ) : 'ADD'}
          </button>
        </form>

        {/* Frozen Table header */}
        <div className="frost-glass" style={{ 
          borderRadius: '16px 16px 0 0', 
          display: 'flex', 
          padding: '12px 16px', 
          fontSize: '12px', 
          fontWeight: 700, 
          color: 'rgba(255,255,255,0.9)', 
          textTransform: 'uppercase', 
          letterSpacing: '1px', 
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.1)',
          borderBottom: 'none'
        }}>
          <SortHeader label="Item" field="name" style={{ flex: 2 }} />
          <SortHeader label="Qty" field="quantity" style={{ flex: 1, justifyContent: 'flex-end' }} />
          <SortHeader label="Unit" field="unit" style={{ flex: 1, justifyContent: 'center' }} />
          <SortHeader label="Added" field="date_added" style={{ flex: 1, justifyContent: 'flex-end' }} />
        </div>

        {/* Frozen Items */}
        <div className="frost-glass" style={{ 
          borderRadius: '0 0 16px 16px', 
          overflow: 'hidden',
          border: '2px solid rgba(255,255,255,0.1)',
          borderTop: 'none',
          position: 'relative'
        }}>
          {/* Subtle ice pattern overlay */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.05,
            backgroundImage: `
              linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%),
              linear-gradient(-45deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)
            `,
            backgroundSize: '20px 20px',
            pointerEvents: 'none'
          }} />
          
          {sortedItems.map(item => (
            <SwipeRow key={item.id} onEdit={() => startEditing(item)} onDelete={() => handleDelete(item.id)} disabled={editingId === item.id}>
              {editingId === item.id ? (
                <div style={{ 
                  padding: '12px 16px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px',
                  position: 'relative',
                  zIndex: 1
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      style={{ 
                        flex: 2, 
                        padding: '8px 12px', 
                        border: '2px solid rgba(255,255,255,0.3)', 
                        borderRadius: '8px', 
                        fontSize: '14px',
                        background: 'rgba(255,255,255,0.1)',
                        color: 'white',
                        backdropFilter: 'blur(10px)',
                        outline: 'none',
                        fontWeight: 500
                      }} />
                    <input type="number" step="0.1" value={editForm.quantity}
                      onChange={e => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) })}
                      style={{ 
                        flex: 1, 
                        padding: '8px 12px', 
                        border: '2px solid rgba(255,255,255,0.3)', 
                        borderRadius: '8px', 
                        fontSize: '14px', 
                        textAlign: 'right',
                        background: 'rgba(255,255,255,0.1)',
                        color: 'white',
                        backdropFilter: 'blur(10px)',
                        outline: 'none',
                        fontWeight: 500
                      }} />
                    <select value={editForm.unit} onChange={e => setEditForm({ ...editForm, unit: e.target.value })}
                      style={{ 
                        flex: 1, 
                        padding: '8px', 
                        border: '2px solid rgba(255,255,255,0.3)', 
                        borderRadius: '8px', 
                        fontSize: '14px',
                        background: 'rgba(255,255,255,0.1)',
                        color: 'white',
                        backdropFilter: 'blur(10px)',
                        outline: 'none',
                        fontWeight: 500
                      }}>
                      <option value="count" style={{background: 'var(--frost-primary)', color: 'white'}}>count</option>
                      <option value="lbs" style={{background: 'var(--frost-primary)', color: 'white'}}>lbs</option>
                      <option value="g" style={{background: 'var(--frost-primary)', color: 'white'}}>g</option>
                      <option value="gallon" style={{background: 'var(--frost-primary)', color: 'white'}}>gallon</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button onClick={() => saveEdit(item.id)} style={{ 
                      padding: '6px 16px', 
                      background: 'var(--frost-secondary)', 
                      color: '#fff', 
                      border: '2px solid rgba(255,255,255,0.2)', 
                      borderRadius: '8px', 
                      fontSize: '13px', 
                      fontWeight: 700, 
                      cursor: 'pointer',
                      letterSpacing: '0.5px',
                      backdropFilter: 'blur(10px)'
                    }}>SAVE</button>
                    <button onClick={cancelEdit} style={{ 
                      padding: '6px 16px', 
                      background: 'rgba(255,255,255,0.1)', 
                      color: 'rgba(255,255,255,0.7)', 
                      border: '2px solid rgba(255,255,255,0.1)', 
                      borderRadius: '8px', 
                      fontSize: '13px', 
                      fontWeight: 700, 
                      cursor: 'pointer',
                      letterSpacing: '0.5px',
                      backdropFilter: 'blur(10px)'
                    }}>CANCEL</button>
                  </div>
                </div>
              ) : (
                <div style={{ 
                  display: 'flex', 
                  padding: '12px 16px', 
                  alignItems: 'center', 
                  fontSize: '14px',
                  position: 'relative',
                  zIndex: 1,
                  color: 'rgba(255,255,255,0.9)'
                }}>
                  <span style={{ 
                    flex: 2, 
                    fontWeight: 600, 
                    letterSpacing: '0.3px',
                    textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                  }}>{item.name}</span>
                  <span style={{ 
                    flex: 1, 
                    textAlign: 'right', 
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 700,
                    color: 'var(--frost-pale)'
                  }}>{item.quantity}</span>
                  <span style={{ 
                    flex: 1, 
                    textAlign: 'center', 
                    color: 'rgba(255,255,255,0.7)', 
                    fontSize: '13px',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>{item.unit}</span>
                  <span style={{ 
                    flex: 1, 
                    textAlign: 'right', 
                    color: 'rgba(255,255,255,0.6)', 
                    fontSize: '12px',
                    fontWeight: 500
                  }}>{formatDate(item.date_added)}</span>
                </div>
              )}
            </SwipeRow>
          ))}

          {showAddRow && (
            <div style={{ 
              padding: '12px 16px', 
              borderTop: '1px solid rgba(255,255,255,0.1)',
              position: 'relative',
              zIndex: 1
            }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                <input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} placeholder="Item name"
                  style={{ 
                    flex: 2, 
                    padding: '8px 12px', 
                    border: '2px solid rgba(255,255,255,0.3)', 
                    borderRadius: '8px', 
                    fontSize: '14px',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    backdropFilter: 'blur(10px)',
                    outline: 'none',
                    fontWeight: 500
                  }} />
                <input type="number" step="0.1" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: e.target.value })} placeholder="Qty"
                  style={{ 
                    flex: 1, 
                    padding: '8px 12px', 
                    border: '2px solid rgba(255,255,255,0.3)', 
                    borderRadius: '8px', 
                    fontSize: '14px', 
                    textAlign: 'right',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    backdropFilter: 'blur(10px)',
                    outline: 'none',
                    fontWeight: 500
                  }} />
                <select value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                  style={{ 
                    flex: 1, 
                    padding: '8px', 
                    border: '2px solid rgba(255,255,255,0.3)', 
                    borderRadius: '8px', 
                    fontSize: '14px',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    backdropFilter: 'blur(10px)',
                    outline: 'none',
                    fontWeight: 500
                  }}>
                  <option value="count" style={{background: 'var(--frost-primary)', color: 'white'}}>count</option>
                  <option value="lbs" style={{background: 'var(--frost-primary)', color: 'white'}}>lbs</option>
                  <option value="g" style={{background: 'var(--frost-primary)', color: 'white'}}>g</option>
                  <option value="gallon" style={{background: 'var(--frost-primary)', color: 'white'}}>gallon</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button onClick={handleAddNew} style={{ 
                  padding: '6px 16px', 
                  background: 'var(--frost-secondary)', 
                  color: '#fff', 
                  border: '2px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  fontSize: '13px', 
                  fontWeight: 700, 
                  cursor: 'pointer',
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(10px)'
                }}>SAVE</button>
                <button onClick={() => setShowAddRow(false)} style={{ 
                  padding: '6px 16px', 
                  background: 'rgba(255,255,255,0.1)', 
                  color: 'rgba(255,255,255,0.7)', 
                  border: '2px solid rgba(255,255,255,0.1)', 
                  borderRadius: '8px', 
                  fontSize: '13px', 
                  fontWeight: 700, 
                  cursor: 'pointer',
                  letterSpacing: '0.5px',
                  backdropFilter: 'blur(10px)'
                }}>CANCEL</button>
              </div>
            </div>
          )}
        </div>

        {!showAddRow && (
          <button onClick={() => setShowAddRow(true)} style={{
            marginTop: '12px', 
            padding: '12px', 
            width: '100%',
            background: 'rgba(255,255,255,0.05)', 
            border: '2px dashed rgba(255,255,255,0.3)',
            borderRadius: '12px', 
            color: 'rgba(255,255,255,0.7)', 
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: 600,
            letterSpacing: '0.5px',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.3s ease'
          }}>+ ADD NEW ITEM</button>
        )}

        {/* Delete container option */}
        {activeContainer && containers.length > 1 && !showDeleteConfirm && (
          <div style={{ 
            marginTop: '40px', 
            padding: '12px 0', 
            borderTop: '1px solid rgba(255,255,255,0.1)', 
            textAlign: 'center' 
          }}>
            <button
              onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText('') }}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: 'rgba(211,47,47,0.8)', 
                fontSize: '13px', 
                cursor: 'pointer', 
                textDecoration: 'underline', 
                opacity: '0.8',
                fontWeight: 600,
                letterSpacing: '0.5px'
              }}
            >
              DELETE {getContainerDisplayName(activeContainer).toUpperCase()}
            </button>
          </div>
        )}
        {showDeleteConfirm && activeContainer && (
          <div className="frost-glass" style={{
            marginTop: '24px', 
            padding: '20px', 
            borderRadius: '16px', 
            textAlign: 'center',
            border: '2px solid rgba(211,47,47,0.3)',
            position: 'relative'
          }}>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(circle, rgba(211,47,47,0.1) 0%, transparent 70%)',
              borderRadius: '16px',
              pointerEvents: 'none'
            }} />
            <p style={{ 
              fontSize: '16px', 
              color: '#fff', 
              marginBottom: '6px', 
              fontWeight: 700,
              position: 'relative',
              zIndex: 1
            }}>
              DELETE {getContainerDisplayName(activeContainer).toUpperCase()} AND ALL ITS ITEMS?
            </p>
            <p style={{ 
              fontSize: '13px', 
              color: 'rgba(255,255,255,0.8)', 
              marginBottom: '16px',
              position: 'relative',
              zIndex: 1
            }}>
              Type <strong style={{ 
                color: '#ff6b6b', 
                fontFamily: 'monospace',
                background: 'rgba(211,47,47,0.2)',
                padding: '2px 6px',
                borderRadius: '4px'
              }}>nofood</strong> to confirm
            </p>
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              justifyContent: 'center', 
              alignItems: 'center',
              position: 'relative',
              zIndex: 1
            }}>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteContainer() }}
                placeholder="nofood"
                autoFocus
                style={{
                  width: '140px', 
                  padding: '10px 14px', 
                  textAlign: 'center', 
                  fontSize: '15px',
                  border: '2px solid rgba(255,255,255,0.3)', 
                  borderRadius: '10px', 
                  fontFamily: 'monospace',
                  outline: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  backdropFilter: 'blur(10px)',
                  fontWeight: 600
                }}
              />
              <button
                onClick={handleDeleteContainer}
                disabled={deleteConfirmText.toLowerCase() !== 'nofood'}
                style={{
                  padding: '10px 18px', 
                  fontSize: '13px', 
                  fontWeight: 700, 
                  borderRadius: '10px', 
                  border: '2px solid rgba(255,255,255,0.2)', 
                  cursor: deleteConfirmText.toLowerCase() === 'nofood' ? 'pointer' : 'not-allowed',
                  background: deleteConfirmText.toLowerCase() === 'nofood' ? '#d32f2f' : 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  backdropFilter: 'blur(10px)',
                  letterSpacing: '0.5px'
                }}
              >DELETE</button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }}
                style={{ 
                  padding: '10px 18px', 
                  fontSize: '13px', 
                  fontWeight: 700, 
                  borderRadius: '10px', 
                  border: '2px solid rgba(255,255,255,0.1)', 
                  background: 'rgba(255,255,255,0.05)', 
                  color: 'rgba(255,255,255,0.7)', 
                  cursor: 'pointer',
                  backdropFilter: 'blur(10px)',
                  letterSpacing: '0.5px'
                }}
              >CANCEL</button>
            </div>
          </div>
        )}

        <div style={{ height: '60px' }} />
      </div>

      {showCubeEditor && (() => {
        const editingContainer = cubeEditorTarget ? containers.find(c => c.id === cubeEditorTarget) : null
        const initW = editingContainer ? editingContainer.width : newContainer.width
        const initD = editingContainer ? editingContainer.depth : newContainer.depth
        const initH = editingContainer ? editingContainer.height : newContainer.height
        return (
          <CubeEditor
            width={initW} depth={initD} height={initH}
            onClose={() => setShowCubeEditor(false)}
            onDone={async (dims) => {
              if (cubeEditorTarget) {
                await fetch(`${API_BASE}/containers/${cubeEditorTarget}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ width: dims.width, depth: dims.depth, height: dims.height })
                })
                fetchContainers()
              } else {
                setNewContainer(prev => ({ ...prev, width: dims.width, depth: dims.depth, height: dims.height }))
              }
              setShowCubeEditor(false)
            }}
          />
        )
      })()}
    </>
  )
}

function AppWithErrorBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>
}

export default AppWithErrorBoundary