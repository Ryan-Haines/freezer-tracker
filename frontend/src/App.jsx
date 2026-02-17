import { useState, useEffect, useRef, useCallback, Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>😵</div>
        <h2 style={{ marginBottom: '8px', color: '#333' }}>Something broke</h2>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '16px' }}>{this.state.error.message}</p>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 24px', background: '#2196F3', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'pointer' }}>Reload</button>
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
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid #f0f0f0' }}>
      {/* Action buttons behind */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        display: 'flex', width: `${SWIPE_MAX}px`,
      }}>
        <button onClick={() => { onEdit(); close() }} style={{
          flex: 1, border: 'none', color: '#fff', backgroundColor: '#2196F3',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        }}>Edit</button>
        <button onClick={() => { onDelete(); close() }} style={{
          flex: 1, border: 'none', color: '#fff', backgroundColor: '#f44336',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        }}>Delete</button>
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
          backgroundColor: '#fff',
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
    const activeContainer = containers.find(c => c.id === activeContainerId)
    if (!activeContainer || containers.length <= 1) return
    
    const containerName = activeContainer.name || activeContainer.icon || 'this container'
    if (!confirm(`Delete ${containerName} and all its items?`)) return
    
    try {
      await fetch(`${API_BASE}/containers/${activeContainerId}`, { method: 'DELETE' })
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
    if (capacityPercent >= 90) return '#f44336'
    if (capacityPercent >= 80) return '#ff9800'
    if (capacityPercent >= 60) return '#4CAF50'
    return '#2196F3'
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
    <div onClick={() => handleSort(field)} style={{ ...s, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
      {label}
      {sortKey === field && <span style={{ fontSize: '10px', opacity: 0.7 }}>{sortAsc ? '▲' : '▼'}</span>}
    </div>
  )

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f5f7; color: #1d1d1f; -webkit-font-smoothing: antialiased; }
    input, select, button { font-family: inherit; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .tab-container::-webkit-scrollbar { display: none; }
    .tab-container { -ms-overflow-style: none; scrollbar-width: none; }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f7', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid #e0e0e0', borderTopColor: '#2196F3', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <span style={{ color: '#999', fontSize: '14px' }}>Loading...</span>
      </div>
    </>
  )

  if (loadError) return (
    <>
      <style>{css}</style>
      <div style={{ padding: '40px 20px', textAlign: 'center', minHeight: '100vh', background: '#f5f5f7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <div style={{ fontSize: '48px' }}>⚠️</div>
        <h2 style={{ color: '#333', fontSize: '18px' }}>Connection Error</h2>
        <p style={{ color: '#888', fontSize: '14px' }}>{loadError}</p>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 24px', background: '#2196F3', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'pointer', marginTop: '8px' }}>Retry</button>
      </div>
    </>
  )

  return (
    <>
      <style>{css}</style>
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '12px', minHeight: '100vh' }}>
        {/* Tab Bar */}
        <div className="tab-container" style={{
          display: 'flex', 
          gap: '8px', 
          marginBottom: '12px', 
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
                padding: '8px 16px',
                borderRadius: '20px',
                background: container.id === activeContainerId ? '#2196F3' : '#f0f0f0',
                color: container.id === activeContainerId ? '#fff' : '#666',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                border: container.id === activeContainerId ? '2px solid #2196F3' : '2px solid transparent',
                transition: 'all 0.2s ease'
              }}
            >
              {getContainerDisplayName(container)}
            </div>
          ))}
          
          {/* Add container button */}
          <div
            onClick={() => setShowAddContainer(true)}
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              background: '#e8f4fd',
              color: '#2196F3',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              border: '2px dashed #2196F3',
              transition: 'all 0.2s ease'
            }}
          >
            + Add
          </div>
        </div>
        
        {/* Add container form */}
        {showAddContainer && (
          <div style={{
            padding: '12px',
            background: '#f8f9fa',
            borderRadius: '10px',
            marginBottom: '12px',
            border: '1.5px solid #e0e0e0'
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <input
                type="text"
                placeholder="Container name"
                value={newContainer.name}
                onChange={(e) => setNewContainer({ ...newContainer, name: e.target.value })}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  border: '1.5px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
              <input
                type="text"
                placeholder="🧊"
                value={newContainer.icon}
                onChange={(e) => setNewContainer({ ...newContainer, icon: e.target.value })}
                style={{
                  width: '60px',
                  padding: '6px 10px',
                  border: '1.5px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  textAlign: 'center'
                }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: '#888', fontWeight: 500 }}>Dimensions (inches): W × D × H</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                <input type="number" min="1" placeholder="W" value={newContainer.width}
                  onChange={(e) => setNewContainer({ ...newContainer, width: e.target.value })}
                  style={{ flex: 1, padding: '6px 8px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', textAlign: 'center' }} />
                <span style={{ color: '#aaa' }}>×</span>
                <input type="number" min="1" placeholder="D" value={newContainer.depth}
                  onChange={(e) => setNewContainer({ ...newContainer, depth: e.target.value })}
                  style={{ flex: 1, padding: '6px 8px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', textAlign: 'center' }} />
                <span style={{ color: '#aaa' }}>×</span>
                <input type="number" min="1" placeholder="H" value={newContainer.height}
                  onChange={(e) => setNewContainer({ ...newContainer, height: e.target.value })}
                  style={{ flex: 1, padding: '6px 8px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', textAlign: 'center' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleAddContainer}
                disabled={(!newContainer.name.trim() && !newContainer.icon.trim()) || !newContainer.width || !newContainer.depth || !newContainer.height}
                style={{
                  padding: '6px 14px',
                  background: ((!newContainer.name.trim() && !newContainer.icon.trim()) || !newContainer.width || !newContainer.depth || !newContainer.height) ? '#ccc' : '#4CAF50',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: ((!newContainer.name.trim() && !newContainer.icon.trim()) || !newContainer.width || !newContainer.depth || !newContainer.height) ? 'not-allowed' : 'pointer'
                }}
              >
                Create
              </button>
              <button
                onClick={() => { setShowAddContainer(false); setNewContainer({ name: '', icon: '', width: DEFAULT_W, depth: DEFAULT_D, height: DEFAULT_H }) }}
                style={{
                  padding: '6px 14px',
                  background: '#e0e0e0',
                  color: '#666',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Capacity */}
        <div style={{
          padding: '12px 16px', borderRadius: '12px', marginBottom: '12px',
          background: capacityPercent >= 80 ? '#fff3e0' : '#e8f4fd',
          border: `1.5px solid ${getCapacityColor()}20`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
            {editingCapacity ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="number" min="0" max="100" value={capacityInput}
                  onChange={e => setCapacityInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveManualCapacity()}
                  style={{ width: '50px', padding: '4px 8px', fontSize: '15px', border: '1.5px solid #2196F3', borderRadius: '6px', textAlign: 'center' }}
                  autoFocus />
                <span style={{ fontWeight: 600 }}>%</span>
                <button onClick={saveManualCapacity} style={{ padding: '4px 10px', background: '#4CAF50', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Save</button>
                <button onClick={() => setEditingCapacity(false)} style={{ padding: '4px 10px', background: '#9e9e9e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
              </div>
            ) : (
              <span onClick={() => { setCapacityInput(capacityPercent.toString()); setEditingCapacity(true) }}
                style={{ fontSize: '15px', fontWeight: 600, color: getCapacityColor(), cursor: 'pointer' }}>
                {capacityPercent >= 80 ? '⚠️ ' : '📊 '}
                {isCalibrated ? 'Calibrated' : 'Est.'}: {capacityPercent}%
                {isCalibrated && <span style={{ fontSize: '12px', fontWeight: 400, opacity: 0.7 }}> (raw {Math.round(rawCapacity)}%)</span>}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isCalibrated && !editingCapacity && (
                <button onClick={resetCalibration} style={{ padding: '2px 8px', background: 'transparent', color: '#999', border: '1px solid #ddd', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>Reset</button>
              )}
              <span style={{ fontSize: '11px', color: '#999' }}>{activeContainer ? `${activeContainer.width}×${activeContainer.depth}×${activeContainer.height}"` : `${DEFAULT_W}×${DEFAULT_D}×${DEFAULT_H}"`}</span>
            </div>
          </div>
          <div style={{ height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${capacityPercent}%`, background: getCapacityColor(), borderRadius: '3px', transition: 'width 0.3s ease' }} />
          </div>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '2px' }}>
          {activeContainer ? getContainerDisplayName(activeContainer) : '🧊 Freezer Inventory'}
        </h1>
        <p style={{ color: '#999', fontSize: '12px', marginBottom: '12px' }}>Updated {formatDateTime(lastUpdated)}</p>

        {/* Voice fill button - only when container is empty */}
        {items.length === 0 && isVoiceAvailable && activeContainer && (
          <div style={{ marginBottom: '12px' }}>
            {!isRecording ? (
              <button
                onClick={startVoiceRecording}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: '#4CAF50',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
              >
                🎤 Fill {getContainerDisplayName(activeContainer)} with items
              </button>
            ) : (
              <button
                onClick={stopVoiceRecording}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: '#f44336',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
              >
                <div style={{
                  width: '12px',
                  height: '12px',
                  background: '#fff',
                  borderRadius: '2px'
                }} />
                Recording... (tap to stop)
              </button>
            )}
          </div>
        )}
        
        {/* Natural language input */}
        <form onSubmit={handleNaturalSubmit} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input type="text" value={naturalInput} onChange={e => setNaturalInput(e.target.value)}
            placeholder='e.g. "add 2 lbs chicken"'
            disabled={parsing}
            style={{
              flex: 1, padding: '10px 14px', fontSize: '15px',
              border: '1.5px solid #e0e0e0', borderRadius: '10px',
              background: '#fff', outline: 'none',
              opacity: parsing ? 0.6 : 1,
            }} />
          <button type="submit" disabled={parsing} style={{
            padding: '10px 20px', background: parsing ? '#a5d6a7' : '#4CAF50',
            color: '#fff', border: 'none', borderRadius: '10px', fontSize: '15px',
            fontWeight: 600, cursor: parsing ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            minWidth: '70px', justifyContent: 'center',
          }}>
            {parsing ? (
              <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            ) : 'Add'}
          </button>
        </form>

        {/* Table header */}
        <div style={{ background: '#f8f8f8', borderRadius: '10px 10px 0 0', display: 'flex', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #eee' }}>
          <SortHeader label="Item" field="name" style={{ flex: 2 }} />
          <SortHeader label="Qty" field="quantity" style={{ flex: 1, justifyContent: 'flex-end' }} />
          <SortHeader label="Unit" field="unit" style={{ flex: 1, justifyContent: 'center' }} />
          <SortHeader label="Added" field="date_added" style={{ flex: 1, justifyContent: 'flex-end' }} />
        </div>

        {/* Items */}
        <div style={{ background: '#fff', borderRadius: '0 0 10px 10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {sortedItems.map(item => (
            <SwipeRow key={item.id} onEdit={() => startEditing(item)} onDelete={() => handleDelete(item.id)} disabled={editingId === item.id}>
              {editingId === item.id ? (
                <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      style={{ flex: 2, padding: '6px 10px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px' }} />
                    <input type="number" step="0.1" value={editForm.quantity}
                      onChange={e => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) })}
                      style={{ flex: 1, padding: '6px 10px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', textAlign: 'right' }} />
                    <select value={editForm.unit} onChange={e => setEditForm({ ...editForm, unit: e.target.value })}
                      style={{ flex: 1, padding: '6px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', background: '#fff' }}>
                      <option value="count">count</option>
                      <option value="lbs">lbs</option>
                      <option value="g">g</option>
                      <option value="gallon">gallon</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button onClick={() => saveEdit(item.id)} style={{ padding: '5px 14px', background: '#4CAF50', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
                    <button onClick={cancelEdit} style={{ padding: '5px 14px', background: '#e0e0e0', color: '#666', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', padding: '10px 14px', alignItems: 'center', fontSize: '14px' }}>
                  <span style={{ flex: 2, fontWeight: 500 }}>{item.name}</span>
                  <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.quantity}</span>
                  <span style={{ flex: 1, textAlign: 'center', color: '#888', fontSize: '13px' }}>{item.unit}</span>
                  <span style={{ flex: 1, textAlign: 'right', color: '#aaa', fontSize: '12px' }}>{formatDate(item.date_added)}</span>
                </div>
              )}
            </SwipeRow>
          ))}

          {showAddRow && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                <input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} placeholder="Item name"
                  style={{ flex: 2, padding: '6px 10px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px' }} />
                <input type="number" step="0.1" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: e.target.value })} placeholder="Qty"
                  style={{ flex: 1, padding: '6px 10px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', textAlign: 'right' }} />
                <select value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                  style={{ flex: 1, padding: '6px', border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '14px', background: '#fff' }}>
                  <option value="count">count</option>
                  <option value="lbs">lbs</option>
                  <option value="g">g</option>
                  <option value="gallon">gallon</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={handleAddNew} style={{ padding: '5px 14px', background: '#4CAF50', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setShowAddRow(false)} style={{ padding: '5px 14px', background: '#e0e0e0', color: '#666', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {!showAddRow && (
          <button onClick={() => setShowAddRow(true)} style={{
            marginTop: '10px', padding: '8px', width: '100%',
            background: 'transparent', border: '1.5px dashed #ddd',
            borderRadius: '10px', color: '#aaa', fontSize: '13px',
            cursor: 'pointer',
          }}>+ Add New Row</button>
        )}

        {/* Delete container option - only at the very bottom */}
        {activeContainer && containers.length > 1 && (
          <div style={{
            marginTop: '30px',
            padding: '10px 0',
            borderTop: '1px solid #f0f0f0',
            textAlign: 'center'
          }}>
            <button
              onClick={handleDeleteContainer}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f44336',
                fontSize: '12px',
                cursor: 'pointer',
                textDecoration: 'underline',
                opacity: '0.7'
              }}
            >
              Delete {getContainerDisplayName(activeContainer)}
            </button>
          </div>
        )}

        <div style={{ height: '40px' }} />
      </div>
    </>
  )
}

function AppWithErrorBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>
}

export default AppWithErrorBoundary
