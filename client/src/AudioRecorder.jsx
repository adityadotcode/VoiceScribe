import { useEffect, useRef, useState } from 'react'

// Preferred MIME types in priority order.
const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return RECORDER_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

function extensionFromMime(mimeType) {
  const normalized = (mimeType || '').split(';')[0]
  if (normalized === 'audio/mp4') return 'm4a'
  if (normalized === 'audio/ogg') return 'ogg'
  return 'webm'
}

/**
 * AudioRecorder — mic capture, playback, S3 upload, Amazon Transcribe.
 *
 * Props:
 *   onTranscriptReady(objectKey, transcript)
 *     Called once transcription completes. App uses this to kick off Bedrock.
 *
 *   onStageChange(stage)
 *     Called whenever the internal pipeline stage changes so App can mirror
 *     progress in its own progress display.
 *     Possible values: 'idle' | 'recording' | 'uploading' | 'transcribing' |
 *                      'success' | 'error'
 */
function AudioRecorder({ onTranscriptReady, onStageChange }) {
  const mediaRecorderRef = useRef(null)
  const chunksRef        = useRef([])
  const streamRef        = useRef(null)
  const playbackUrlRef   = useRef('')

  const [status, setStatus]           = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [audioBlob, setAudioBlob]     = useState(null)
  const [playbackUrl, setPlaybackUrl] = useState('')
  const [objectKey, setObjectKey]     = useState('')

  // Mirror every status change to parent via onStageChange
  function applyStatus(next) {
    setStatus(next)
    onStageChange?.(next)
  }

  useEffect(() => {
    return () => {
      stopStream()
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current)
    }
  }, [])

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function replacePlaybackUrl(blob) {
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current)
    const url = URL.createObjectURL(blob)
    playbackUrlRef.current = url
    setPlaybackUrl(url)
  }

  async function startRecording() {
    setErrorMessage('')
    setObjectKey('')
    setAudioBlob(null)
    applyStatus('recording')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = getSupportedMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      chunksRef.current      = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onerror = () => {
        stopStream()
        applyStatus('error')
        setErrorMessage('Recording failed. Please try again.')
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        stopStream()
        console.log('[AudioRecorder] recording complete — type:', blob.type, '| size:', blob.size, 'bytes')
        setAudioBlob(blob)
        replacePlaybackUrl(blob)
        applyStatus('idle')
      }

      recorder.start(100)
    } catch (err) {
      console.error(err)
      stopStream()
      applyStatus('error')
      setErrorMessage('Microphone access is required to record audio.')
    }
  }

  function stopRecording() {
    const rec = mediaRecorderRef.current
    if (rec?.state === 'recording') rec.stop()
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
      applyStatus('error')
      setErrorMessage('Record audio before uploading.')
      return
    }

    applyStatus('uploading')
    setErrorMessage('')

    const extension = extensionFromMime(audioBlob.type)
    const file = new File([audioBlob], `consultation.${extension}`, {
      type: audioBlob.type || 'audio/webm',
    })
    const formData = new FormData()
    formData.append('audio', file)

    try {
      const res  = await fetch('/api/audio', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok || !data.success) {
        applyStatus('error')
        setErrorMessage(data.message || 'Upload failed. Please try again.')
        return
      }

      const uploadedKey = data.objectKey
      setObjectKey(uploadedKey)
      applyStatus('transcribing')
      await transcribeRecording(uploadedKey)
    } catch (err) {
      console.error(err)
      applyStatus('error')
      setErrorMessage('Upload failed. Please try again.')
    }
  }

  async function transcribeRecording(key) {
    try {
      const res  = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectKey: key }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        applyStatus('error')
        setErrorMessage(data.message || 'Transcription failed. Please try again.')
        return
      }

      // Stay in 'transcribing' visually — App will advance the stage to
      // 'extracting' once it receives the transcript and calls Bedrock.
      // We do NOT set 'success' here; App calls onTranscriptReady which
      // takes over and drives the rest of the pipeline.
      onTranscriptReady?.(key, data.transcript ?? '', data.detectedLanguages ?? [])
    } catch (err) {
      console.error(err)
      applyStatus('error')
      setErrorMessage('Transcription failed. Please try again.')
    }
  }

  const busy       = status === 'recording' || status === 'uploading' || status === 'transcribing'
  const canRecord  = !busy
  const canStop    = status === 'recording'
  const canUpload  = Boolean(audioBlob) && !busy
  const canReRecord = canRecord && (Boolean(audioBlob) || status === 'error' || status === 'success')

  const statusLabel = {
    idle:         'idle',
    recording:    'recording…',
    uploading:    'uploading to S3…',
    transcribing: 'transcribing (may take up to 60 s)…',
    success:      'done',
    error:        'error',
  }[status] ?? status

  return (
    <section className="recorder" aria-label="Consultation audio recorder">
      <h2>Record consultation</h2>
      <p className="recorder-copy">
        Record the consultation, play it back, then click Upload &amp; Transcribe.
      </p>

      <p className={`recorder-state is-${status}`}>Status: {statusLabel}</p>

      <div className="recorder-actions">
        {canStop ? (
          <button type="button" className="recorder-button" onClick={stopRecording}>
            Stop recording
          </button>
        ) : (
          <button type="button" className="recorder-button" onClick={startRecording} disabled={!canRecord}>
            Start recording
          </button>
        )}

        <button type="button" className="recorder-button secondary" onClick={uploadRecording} disabled={!canUpload}>
          {status === 'uploading'    ? 'Uploading…'    :
           status === 'transcribing' ? 'Transcribing…' :
           'Upload & Transcribe'}
        </button>

        <button type="button" className="recorder-button secondary" onClick={reRecord} disabled={!canReRecord}>
          Re-record
        </button>
      </div>

      {playbackUrl && (
        <audio className="recorder-player" controls src={playbackUrl}>
          Your browser does not support audio playback.
        </audio>
      )}

      {status === 'success' && objectKey && (
        <p className="recorder-success">
          Uploaded: <code>{objectKey}</code>
        </p>
      )}

      {status === 'error' && errorMessage && (
        <p className="recorder-error" role="alert">{errorMessage}</p>
      )}
    </section>
  )
}

export default AudioRecorder
