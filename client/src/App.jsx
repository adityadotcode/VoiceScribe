import { useEffect, useState } from 'react'
import AudioRecorder from './AudioRecorder.jsx'
import './App.css'

function App() {
  const [apiStatus, setApiStatus] = useState('Checking API...')

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          setApiStatus(data.message)
          return
        }

        setApiStatus('API responded unexpectedly')
      })
      .catch(() => {
        setApiStatus('API is not reachable yet')
      })
  }, [])

  return (
    <main className="page">
      <p className="eyebrow">Clinical documentation assistant</p>
      <h1>VoiceScribe</h1>
      <p className="lede">
        A doctor records a conversation, reviews the extracted note, and
        approves it before anything is saved.
      </p>
      <p className="status">{apiStatus}</p>
      <AudioRecorder />
    </main>
  )
}

export default App
