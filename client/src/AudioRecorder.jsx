import { useEffect, useRef, useState } from 'react'

// Preferred MIME types in priority order.
// Each entry is checked with MediaRecorder.isTypeSupported before use.
const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus', // Chromium: best quality, widely supported
  'audio/webm',             // Chromium: fallback without explicit codec
  'audio/ogg;codecs=opus',  // Firefox
  'audio/mp4',              // Safari / iOS
]

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function extensionFromMime(mimeType) {
  const normalized = (mimeType || '').split(';')[0]

  if (normalized === 'audio/mp4') {
    return 'm4a'
  }

  if (normalized === 'audio/ogg') {
    return 'ogg'
  }

  return 'webm'
}

function AudioRecorder() {
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const playbackUrlRef = useRef('')

  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [playbackUrl, setPlaybackUrl] = useState('')
  const [objectKey, setObjectKey] = useState('')

  useEffect(() => {
    return () => {
      stopStream()
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current)
      }
    }
  }, [])

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  function replacePlaybackUrl(blob) {
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current)
    }

    const nextUrl = URL.createObjectURL(blob)
    playbackUrlRef.current = nextUrl
    setPlaybackUrl(nextUrl)
  }

  async function startRecording() {
    setErrorMessage('')
    setObjectKey('')
    setAudioBlob(null)
    setStatus('recording')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = getSupportedMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      chunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        stopStream()
        setStatus('error')
        setErrorMessage('Recording failed. Please try again.')
      }

      recorder.onstop = () => {
        // All dataavailable events have already fired before onstop is called.
        // Build the Blob only here, after every chunk has been collected.
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        chunksRef.current = []
        stopStream()

        // Sanity-check: log the blob so we can verify size > 0 in the console.
        console.log(
          '[AudioRecorder] recording complete —',
          'type:', blob.type,
          '| size:', blob.size, 'bytes'
        )

        setAudioBlob(blob)
        replacePlaybackUrl(blob)
        setStatus('idle')
      }

      // Pass a 100 ms timeslice so the browser flushes audio data to
      // ondataavailable progressively throughout the recording.
      // Without a timeslice, all data is buffered until stop(), and a
      // very short or immediately-stopped recording can produce a
      // valid-but-empty container that AWS Transcribe sees as 0-duration.
      recorder.start(100)
    } catch (error) {
      console.error(error)
      stopStream()
      setStatus('error')
      setErrorMessage('Microphone access is required to record audio.')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === 'recording') {
      recorder.stop()
    }
  }

  function reRecord() {
    setObjectKey('')
    setAudioBlob(null)
    setErrorMessage('')
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current)
      playbackUrlRef.current = ''
      setPlaybackUrl('')
    }
    startRecording()
  }

  async function uploadRecording() {
    if (!audioBlob) {
      setStatus('error')
      setErrorMessage('Record audio before uploading.')
      return
    }

    setStatus('uploading')
    setErrorMessage('')

    const extension = extensionFromMime(audioBlob.type)
    const file = new File([audioBlob], `consultation.${extension}`, {
      type: audioBlob.type || 'audio/webm',
    })

    const formData = new FormData()
    formData.append('audio', file)

    try {
      const response = await fetch('/api/audio', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        setStatus('error')
        setErrorMessage(data.message || 'Upload failed. Please try again.')
        return
      }

      setObjectKey(data.objectKey)
      setStatus('success')
    } catch (error) {
      console.error(error)
      setStatus('error')
      setErrorMessage('Upload failed. Please try again.')
    }
  }

  const canRecord = status !== 'recording' && status !== 'uploading'
  const canStop = status === 'recording'
  const canUpload = Boolean(audioBlob) && status !== 'recording' && status !== 'uploading'
  const canReRecord = canRecord && (Boolean(audioBlob) || status === 'error' || status === 'success')

  return (
    <section className="recorder" aria-label="Consultation audio recorder">
      <h2>Record consultation</h2>
      <p className="recorder-copy">
        Record a short clip, play it back, then upload it privately to VoiceScribe.
      </p>

      <p className={`recorder-state is-${status}`}>Status: {status}</p>

      <div className="recorder-actions">
        {canStop ? (
          <button type="button" className="recorder-button" onClick={stopRecording}>
            Stop recording
          </button>
        ) : (
          <button
            type="button"
            className="recorder-button"
            onClick={startRecording}
            disabled={!canRecord}
          >
            Start recording
          </button>
        )}

        <button
          type="button"
          className="recorder-button secondary"
          onClick={uploadRecording}
          disabled={!canUpload}
        >
          {status === 'uploading' ? 'Uploading...' : 'Upload'}
        </button>

        <button
          type="button"
          className="recorder-button secondary"
          onClick={reRecord}
          disabled={!canReRecord}
        >
          Re-record
        </button>
      </div>

      {playbackUrl ? (
        <audio className="recorder-player" controls src={playbackUrl}>
          Your browser does not support audio playback.
        </audio>
      ) : null}

      {status === 'success' && objectKey ? (
        <p className="recorder-success">
          Uploaded object key: <code>{objectKey}</code>
        </p>
      ) : null}

      {status === 'error' && errorMessage ? (
        <p className="recorder-error">{errorMessage}</p>
      ) : null}
    </section>
  )
}

export default AudioRecorder
