import { useEffect, useRef, useState } from 'react'
import { apiFetch, apiUrl } from './api.js'

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

// ---------------------------------------------------------------------------
// MIME types accepted by the backend multer middleware (audioUpload.js).
// Must stay in sync with server/src/middleware/audioUpload.js ALLOWED_MIME_TYPES.
// ---------------------------------------------------------------------------
const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
])

// MAX_AUDIO_FILE_BYTES from server/.env (default 25 MB).
// Exposed to the frontend so validation matches server-side.
const MAX_BYTES = 25 * 1024 * 1024

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeMime(mime) {
  return (mime || '').split(';')[0].trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// FileUploadSection — secondary action shown below the Start Recording button.
// Shares the same upload/transcribe pipeline via the props from AudioRecorder.
// ---------------------------------------------------------------------------
function FileUploadSection({ onProcessFile, disabled }) {
  const fileInputRef             = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileError, setFileError]       = useState('')

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    // Reset input so the same file can be re-selected after removal
    e.target.value = ''

    if (!file) return

    setFileError('')

    // Validate MIME type
    if (!ACCEPTED_UPLOAD_MIME_TYPES.has(normalizeMime(file.type))) {
      setFileError(
        `"${file.name}" is not a supported audio format. ` +
        `Accepted: MP3, MP4/M4A, WAV, OGG, WebM, AAC.`
      )
      return
    }

    // Validate size
    if (file.size === 0) {
      setFileError('The selected file is empty.')
      return
    }

    if (file.size > MAX_BYTES) {
      setFileError(
        `File is too large (${formatBytes(file.size)}). ` +
        `Maximum allowed size is ${formatBytes(MAX_BYTES)}.`
      )
      return
    }

    setSelectedFile(file)
  }

  function handleRemove() {
    setSelectedFile(null)
    setFileError('')
  }

  function handleProcess() {
    if (!selectedFile || disabled) return
    onProcessFile(selectedFile)
    setSelectedFile(null)
    setFileError('')
  }

  return (
    <div className="file-upload-section">
      <div className="file-upload-divider">
        <span className="file-upload-divider-text">or</span>
      </div>

      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="file-upload-input"
        aria-label="Select audio file"
        onChange={handleFileChange}
        disabled={disabled}
      />

      {!selectedFile && (
        <button
          type="button"
          className="recorder-button secondary file-upload-trigger"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          📁 Upload audio file
        </button>
      )}

      {fileError && (
        <p className="recorder-error file-upload-error" role="alert">{fileError}</p>
      )}

      {selectedFile && (
        <div className="file-upload-preview">
          <div className="file-upload-meta">
            <span className="file-upload-icon" aria-hidden="true">🎵</span>
            <div className="file-upload-info">
              <span className="file-upload-name">{selectedFile.name}</span>
              <span className="file-upload-size">{formatBytes(selectedFile.size)}</span>
            </div>
            <button
              type="button"
              className="file-upload-remove"
              onClick={handleRemove}
              aria-label="Remove selected file"
            >
              ✕
            </button>
          </div>

          <button
            type="button"
            className="recorder-button file-upload-process-btn"
            onClick={handleProcess}
            disabled={disabled}
          >
            Process audio
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AudioRecorder — mic capture, playback, S3 upload, Amazon Transcribe.
//
// Props:
//   onTranscriptReady(objectKey, transcript, detectedLanguages, speakerUtterances)
//     Called once transcription completes. App uses this to kick off Bedrock.
//
//   onStageChange(stage)
//     Called whenever the internal pipeline stage changes so App can mirror
//     progress in its own progress display.
//     Possible values: 'idle' | 'recording' | 'uploading' | 'transcribing' |
//                      'success' | 'error'
// ---------------------------------------------------------------------------
function AudioRecorder({ onTranscriptReady, onStageChange }) {
  const mediaRecorderRef = useRef(null)
  const chunksRef        = useRef([])
  const streamRef        = useRef(null)
  const playbackUrlRef   = useRef('')

  const [status, setStatus]             = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [audioBlob, setAudioBlob]       = useState(null)
  const [playbackUrl, setPlaybackUrl]   = useState('')
  const [objectKey, setObjectKey]       = useState('')

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

      chunksRef.current        = []
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

  // ---------------------------------------------------------------------------
  // Core upload + transcribe path.
  // Called with either:
  //   • a Blob produced by MediaRecorder (from uploadRecording)
  //   • a File picked by the user (from processUploadedFile)
  // Both go through the same /api/audio → /api/transcribe pipeline.
  // ---------------------------------------------------------------------------
  async function uploadAndTranscribe(fileOrBlob) {
    applyStatus('uploading')
    setErrorMessage('')

    // Normalise: if it's already a File, use it; if it's a Blob, wrap it.
    let file
    if (fileOrBlob instanceof File) {
      file = fileOrBlob
    } else {
      const extension = extensionFromMime(fileOrBlob.type)
      file = new File([fileOrBlob], `consultation.${extension}`, {
        type: fileOrBlob.type || 'audio/webm',
      })
    }

    const formData = new FormData()
    formData.append('audio', file)

    try {
      const res  = await apiFetch('/api/audio', { method: 'POST', body: formData })
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

  // Called when the recorder's Upload & Transcribe button is clicked.
  async function uploadRecording() {
    if (!audioBlob) {
      applyStatus('error')
      setErrorMessage('Record audio before uploading.')
      return
    }
    await uploadAndTranscribe(audioBlob)
  }

  // Called from FileUploadSection when the user picks a file and clicks Process.
  async function processUploadedFile(file) {
    setObjectKey('')
    setAudioBlob(null)
    setErrorMessage('')
    await uploadAndTranscribe(file)
  }

  async function transcribeRecording(key) {
    try {
      const res  = await apiFetch('/api/transcribe', {
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
      onTranscriptReady?.(key, data.transcript ?? '', data.detectedLanguages ?? [], data.speakerUtterances ?? [])
    } catch (err) {
      console.error(err)
      applyStatus('error')
      setErrorMessage('Transcription failed. Please try again.')
    }
  }

  const busy        = status === 'recording' || status === 'uploading' || status === 'transcribing'
  const canRecord   = !busy
  const canStop     = status === 'recording'
  const canUpload   = Boolean(audioBlob) && !busy
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

      {/* ── File upload section — secondary action, same pipeline ── */}
      <FileUploadSection
        onProcessFile={processUploadedFile}
        disabled={busy}
      />
    </section>
  )
}

export default AudioRecorder
