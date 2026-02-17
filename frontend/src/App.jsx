import { useState, useEffect } from 'react'

const API_BASE = '/api'

// Freezer dimensions: 33in x 20in x 34in = 22,440 cubic inches
const FREEZER_VOLUME_CUBIC_IN = 33 * 20 * 34

// Estimate cubic inches per unit (accounts for packaging + packing inefficiency ~25%)
const VOLUME_ESTIMATES = {
  lbs: 245,     // frozen meat/food with packaging, irregular stacking
  g: 0.15,      // grams to cubic inches (with packing factor)
  gallon: 315,  // gallon container plus dead space around it
  count: 350,   // frozen pizzas, boxes, packages are bulky
}

function App() {
  const [items, setItems] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [naturalInput, setNaturalInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [newItem, setNewItem] = useState({ name: '', quantity: '', unit: 'count' })
  const [showAddRow, setShowAddRow] = useState(false)
  
  // Calibration: stores { rawAuto, calibratedValue } when user overrides
  const [calibration, setCalibration] = useState(() => {
    const saved = localStorage.getItem('freezer-calibration')
    return saved ? JSON.parse(saved) : null
  })
  const [editingCapacity, setEditingCapacity] = useState(false)
  const [capacityInput, setCapacityInput] = useState('')

  // Calculate raw capacity (before calibration)
  const calculateRawCapacity = () => {
    let totalVolume = 0
    items.forEach(item => {
      const volumePerUnit = VOLUME_ESTIMATES[item.unit] || VOLUME_ESTIMATES.count
      totalVolume += item.quantity * volumePerUnit
    })
    return (totalVolume / FREEZER_VOLUME_CUBIC_IN) * 100
  }

  const rawCapacity = calculateRawCapacity()
  
  // Apply calibration if set: scale based on the ratio at calibration time
  const getCalibratedCapacity = () => {
    if (!calibration) return Math.min(100, Math.round(rawCapacity))
    const scaleFactor = calibration.calibratedValue / calibration.rawAuto
    return Math.min(100, Math.round(rawCapacity * scaleFactor))
  }
  
  const capacityPercent = getCalibratedCapacity()
  const isCalibrated = calibration !== null

  const saveManualCapacity = () => {
    const val = parseInt(capacityInput, 10)
    if (!isNaN(val) && val >= 0 && val <= 100) {
      // Save calibration: current raw value maps to user's input
      const newCalibration = { rawAuto: rawCapacity, calibratedValue: val }
      setCalibration(newCalibration)
      localStorage.setItem('freezer-calibration', JSON.stringify(newCalibration))
    }
    setEditingCapacity(false)
  }

  const resetCalibration = () => {
    setCalibration(null)
    localStorage.removeItem('freezer-calibration')
  }

  const fetchItems = async () => {
    const res = await fetch(`${API_BASE}/items`)
    const data = await res.json()
    setItems(data)
  }

  const fetchLastUpdated = async () => {
    const res = await fetch(`${API_BASE}/last-updated`)
    const data = await res.json()
    setLastUpdated(data.last_updated)
  }

  useEffect(() => {
    fetchItems()
    fetchLastUpdated()
  }, [])

  const handleNaturalSubmit = async (e) => {
    e.preventDefault()
    if (!naturalInput.trim()) return
    
    await fetch(`${API_BASE}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: naturalInput })
    })
    setNaturalInput('')
    fetchItems()
    fetchLastUpdated()
  }

  const handleDelete = async (id) => {
    await fetch(`${API_BASE}/items/${id}`, { method: 'DELETE' })
    fetchItems()
    fetchLastUpdated()
  }

  const startEditing = (item) => {
    setEditingId(item.id)
    setEditForm({ name: item.name, quantity: item.quantity, unit: item.unit })
  }

  const saveEdit = async (id) => {
    await fetch(`${API_BASE}/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm)
    })
    setEditingId(null)
    fetchItems()
    fetchLastUpdated()
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({})
  }

  const handleAddNew = async () => {
    if (!newItem.name || !newItem.quantity) return
    
    await fetch(`${API_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newItem,
        quantity: parseFloat(newItem.quantity)
      })
    })
    setNewItem({ name: '', quantity: '', unit: 'count' })
    setShowAddRow(false)
    fetchItems()
    fetchLastUpdated()
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'Never'
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const getCapacityColor = () => {
    if (capacityPercent >= 90) return '#f44336' // red
    if (capacityPercent >= 80) return '#ff9800' // orange/yellow
    if (capacityPercent >= 60) return '#4CAF50' // green
    return '#2196F3' // blue
  }

  return (
    <div style={styles.container}>
      {/* Capacity Banner */}
      <div style={{
        ...styles.capacityBanner,
        backgroundColor: capacityPercent >= 80 ? '#fff3e0' : '#e3f2fd',
        borderColor: getCapacityColor(),
      }}>
        <div style={styles.capacityHeader}>
          {editingCapacity ? (
            <div style={styles.capacityEditRow}>
              <input
                type="number"
                min="0"
                max="100"
                value={capacityInput}
                onChange={(e) => setCapacityInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveManualCapacity()}
                style={styles.capacityInput}
                autoFocus
              />
              <span style={styles.capacityInputLabel}>%</span>
              <button onClick={saveManualCapacity} style={styles.capacitySaveBtn}>Save</button>
              <button onClick={() => setEditingCapacity(false)} style={styles.capacityCancelBtn}>Cancel</button>
            </div>
          ) : (
            <span 
              style={{...styles.capacityLabel, color: getCapacityColor(), cursor: 'pointer'}}
              onClick={() => { setCapacityInput(capacityPercent.toString()); setEditingCapacity(true); }}
              title="Click to calibrate"
            >
              {capacityPercent >= 80 ? '⚠️ ' : '📊 '}
              {isCalibrated ? 'Calibrated' : 'Estimated'} Capacity: {capacityPercent}%
              {isCalibrated && <span style={styles.autoEstimate}> (raw: {Math.round(rawCapacity)}%)</span>}
            </span>
          )}
          <div style={styles.capacityRight}>
            {isCalibrated && !editingCapacity && (
              <button onClick={resetCalibration} style={styles.resetBtn}>Reset calibration</button>
            )}
            <span style={styles.capacityDimensions}>
              Freezer: 33" × 20" × 34"
            </span>
          </div>
        </div>
        <div style={styles.progressBarContainer}>
          <div style={{
            ...styles.progressBar,
            width: `${capacityPercent}%`,
            backgroundColor: getCapacityColor(),
          }} />
        </div>
      </div>

      <h1 style={styles.title}>🧊 Freezer Inventory</h1>
      
      <p style={styles.lastUpdated}>
        Last updated: {formatDateTime(lastUpdated)}
      </p>

      <form onSubmit={handleNaturalSubmit} style={styles.naturalForm}>
        <input
          type="text"
          value={naturalInput}
          onChange={(e) => setNaturalInput(e.target.value)}
          placeholder='Add items naturally (e.g., "add 2 lbs of chicken")'
          style={styles.naturalInput}
        />
        <button type="submit" style={styles.addBtn}>Add</button>
      </form>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            <th style={styles.th}>Quantity</th>
            <th style={styles.th}>Unit</th>
            <th style={styles.th}>Date Added</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} style={styles.tr}>
              {editingId === item.id ? (
                <>
                  <td style={styles.td}>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                      style={styles.editInput}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      type="number"
                      step="0.1"
                      value={editForm.quantity}
                      onChange={(e) => setEditForm({...editForm, quantity: parseFloat(e.target.value)})}
                      style={styles.editInputSmall}
                    />
                  </td>
                  <td style={styles.td}>
                    <select
                      value={editForm.unit}
                      onChange={(e) => setEditForm({...editForm, unit: e.target.value})}
                      style={styles.select}
                    >
                      <option value="count">count</option>
                      <option value="lbs">lbs</option>
                      <option value="g">g</option>
                      <option value="gallon">gallon</option>
                    </select>
                  </td>
                  <td style={styles.td}>{formatDate(item.date_added)}</td>
                  <td style={styles.td}>
                    <button onClick={() => saveEdit(item.id)} style={styles.saveBtn}>Save</button>
                    <button onClick={cancelEdit} style={styles.cancelBtn}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td style={styles.td}>{item.name}</td>
                  <td style={styles.td}>{item.quantity}</td>
                  <td style={styles.td}>{item.unit}</td>
                  <td style={styles.td}>{formatDate(item.date_added)}</td>
                  <td style={styles.td}>
                    <button onClick={() => startEditing(item)} style={styles.editBtn}>Edit</button>
                    <button onClick={() => handleDelete(item.id)} style={styles.deleteBtn}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          
          {showAddRow && (
            <tr style={styles.tr}>
              <td style={styles.td}>
                <input
                  value={newItem.name}
                  onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                  placeholder="Item name"
                  style={styles.editInput}
                />
              </td>
              <td style={styles.td}>
                <input
                  type="number"
                  step="0.1"
                  value={newItem.quantity}
                  onChange={(e) => setNewItem({...newItem, quantity: e.target.value})}
                  placeholder="Qty"
                  style={styles.editInputSmall}
                />
              </td>
              <td style={styles.td}>
                <select
                  value={newItem.unit}
                  onChange={(e) => setNewItem({...newItem, unit: e.target.value})}
                  style={styles.select}
                >
                  <option value="count">count</option>
                  <option value="lbs">lbs</option>
                  <option value="g">g</option>
                  <option value="gallon">gallon</option>
                </select>
              </td>
              <td style={styles.td}>-</td>
              <td style={styles.td}>
                <button onClick={handleAddNew} style={styles.saveBtn}>Save</button>
                <button onClick={() => setShowAddRow(false)} style={styles.cancelBtn}>Cancel</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!showAddRow && (
        <button onClick={() => setShowAddRow(true)} style={styles.addRowBtn}>
          + Add New Row
        </button>
      )}
    </div>
  )
}

const styles = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  capacityBanner: {
    padding: '15px 20px',
    borderRadius: '12px',
    marginBottom: '20px',
    border: '2px solid',
  },
  capacityHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  capacityLabel: {
    fontSize: '18px',
    fontWeight: '600',
  },
  capacityDimensions: {
    fontSize: '13px',
    color: '#666',
  },
  capacityRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  capacityEditRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  capacityInput: {
    width: '60px',
    padding: '6px 10px',
    fontSize: '16px',
    border: '2px solid #2196F3',
    borderRadius: '6px',
    textAlign: 'center',
  },
  capacityInputLabel: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
  },
  capacitySaveBtn: {
    padding: '6px 12px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  capacityCancelBtn: {
    padding: '6px 12px',
    backgroundColor: '#9e9e9e',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  resetBtn: {
    padding: '4px 10px',
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  autoEstimate: {
    fontSize: '14px',
    fontWeight: 'normal',
    opacity: 0.7,
  },
  progressBarContainer: {
    height: '12px',
    backgroundColor: '#e0e0e0',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: '6px',
    transition: 'width 0.3s ease',
  },
  title: {
    fontSize: '28px',
    marginBottom: '5px',
    color: '#333',
  },
  lastUpdated: {
    color: '#666',
    fontSize: '14px',
    marginBottom: '20px',
  },
  naturalForm: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
  },
  naturalInput: {
    flex: 1,
    padding: '12px',
    fontSize: '16px',
    border: '2px solid #ddd',
    borderRadius: '8px',
  },
  addBtn: {
    padding: '12px 24px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: 'white',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  th: {
    backgroundColor: '#f5f5f5',
    padding: '12px',
    textAlign: 'left',
    fontWeight: '600',
    borderBottom: '2px solid #eee',
  },
  tr: {
    borderBottom: '1px solid #eee',
  },
  td: {
    padding: '12px',
  },
  editInput: {
    width: '100%',
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  editInputSmall: {
    width: '80px',
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  select: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  editBtn: {
    padding: '6px 12px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginRight: '5px',
  },
  deleteBtn: {
    padding: '6px 12px',
    backgroundColor: '#f44336',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '6px 12px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginRight: '5px',
  },
  cancelBtn: {
    padding: '6px 12px',
    backgroundColor: '#9e9e9e',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  addRowBtn: {
    marginTop: '15px',
    padding: '10px 20px',
    backgroundColor: '#fff',
    border: '2px dashed #ddd',
    borderRadius: '8px',
    cursor: 'pointer',
    color: '#666',
    width: '100%',
    fontSize: '14px',
  },
}

export default App
