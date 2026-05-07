import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  return (
    <div className='App'>
      <h1>ChipForge</h1>
      <p>Visual chip design — Sprint 1 scaffold</p>
      <div className='card'>
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>Click to confirm React state + HMR are working.</p>
      </div>
    </div>
  )
}

export default App
