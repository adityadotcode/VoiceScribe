const {
    TranscribeClient,
    StartTranscriptionJobCommand,
    GetTranscriptionJobCommand,
  } = require('@aws-sdk/client-transcribe');
  
  const { awsRegion, s3BucketName } = require('../config/env');
  
  const transcribeClient = new TranscribeClient({
    region: awsRegion,
  });
  
  // ---------------------------------------------------------------------------
  // buildSpeakerUtterances
  //
  // Converts the flat results.items array (with per-word speaker_label fields)
  // into a compact array of utterances grouped by consecutive speaker.
  //
  // Input items shape (pronunciation):
  //   { type: 'pronunciation', start_time: '0.0', end_time: '1.2',
  //     speaker_label: 'spk_0', alternatives: [{ content: 'Hello' }] }
  //
  // Input items shape (punctuation):
  //   { type: 'punctuation', alternatives: [{ content: ',' }] }
  //   (no start_time / end_time / speaker_label — appended to current utterance)
  //
  // Output:
  //   [{ speaker: 'spk_0', startTime: 0.0, endTime: 1.2, text: 'Hello,' }]
  // ---------------------------------------------------------------------------
  function buildSpeakerUtterances(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const utterances = [];
    let current = null;

    for (const item of items) {
      const content = item.alternatives?.[0]?.content ?? '';

      if (item.type === 'punctuation') {
        // Attach punctuation to the last utterance with no preceding space
        if (current) {
          current.text += content;
        }
        continue;
      }

      // pronunciation item
      const speaker   = item.speaker_label ?? 'spk_0';
      const startTime = parseFloat(item.start_time ?? '0');
      const endTime   = parseFloat(item.end_time   ?? '0');

      if (current && current.speaker === speaker) {
        // Same speaker — extend the current utterance
        current.text   += ' ' + content;
        current.endTime = endTime;
      } else {
        // Speaker change (or first item) — start a new utterance
        current = { speaker, startTime, endTime, text: content };
        utterances.push(current);
      }
    }

    return utterances;
  }

  // Maps the file extension in the S3 key to the MediaFormat value
  // that Amazon Transcribe expects. Falls back to 'webm'.
  const EXTENSION_TO_MEDIA_FORMAT = {
    webm: 'webm',
    ogg: 'ogg',
    mp3: 'mp3',
    mp4: 'mp4',
    m4a: 'mp4',
    wav: 'wav',
    flac: 'flac',
    aac: 'aac',
    amr: 'amr',
  };
  
  function mediaFormatFromKey(objectKey) {
    const ext = (objectKey || '').split('.').pop().toLowerCase();
    return EXTENSION_TO_MEDIA_FORMAT[ext] || 'webm';
  }
  
  function createJobName() {
    return `voicescribe-${Date.now()}`;
  }
  
  async function startTranscription(objectKey) {
    if (!objectKey) {
      throw new Error('S3 object key is required');
    }
  
    const jobName = createJobName();
    const mediaFormat = mediaFormatFromKey(objectKey);
  
    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,

      Media: {
        MediaFileUri: `s3://${s3BucketName}/${objectKey}`,
      },

      MediaFormat: mediaFormat,

      IdentifyMultipleLanguages: true,

      LanguageOptions: ['hi-IN', 'en-IN'],

      // Speaker diarization — distinguish up to 2 speakers.
      // Must be nested under Settings; cannot coexist with LanguageCode
      // (which is intentionally absent since IdentifyMultipleLanguages is used).
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels:  2,
      },
    });
  
    await transcribeClient.send(command);
  
    return jobName;
  }
  
  async function waitForTranscription(jobName) {
    const maxAttempts = 60;
    const delayMs = 3000;
  
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      });
  
      const result = await transcribeClient.send(command);
  
      const job = result.TranscriptionJob;
  
      if (job.TranscriptionJobStatus === 'COMPLETED') {
        const transcriptUri = job.Transcript?.TranscriptFileUri;
  
        if (!transcriptUri) {
          throw new Error('Transcription completed but transcript URI is missing');
        }
  
        const response = await fetch(transcriptUri);
  
        if (!response.ok) {
          throw new Error(
            `Failed to fetch transcript: ${response.status} ${response.statusText}`
          );
        }
  
        const transcriptData = await response.json();

        const transcript = transcriptData?.results?.transcripts?.[0]?.transcript ?? null;

        if (transcript === null || transcript === '') {
          // Log the full raw response so the shape is visible when the path resolves empty.
          console.warn(
            '[transcribeService] transcript string is empty or missing. Raw transcript data:',
            JSON.stringify(transcriptData, null, 2)
          );
        }

        // Extract detected language information.
        // For IdentifyMultipleLanguages jobs, LanguageCodes is an array of
        // { LanguageCode: string, DurationInSeconds: number } objects ordered by
        // total spoken duration. For single-language jobs this array may be absent.
        const rawLanguageCodes = job.LanguageCodes ?? [];
        const detectedLanguages = rawLanguageCodes.map((lc) => ({
          code:     lc.LanguageCode,
          duration: lc.DurationInSeconds ?? null,
        }));

        console.log('[transcribeService] detected languages:', JSON.stringify(detectedLanguages));

        // ── Speaker utterances ──────────────────────────────────────────────
        // Amazon Transcribe returns per-word speaker labels in results.items[].
        // We group consecutive words that share the same speaker_label into
        // utterances, producing a compact chronological array.
        //
        // Each item in results.items has:
        //   { type: 'pronunciation'|'punctuation', start_time, end_time,
        //     speaker_label, alternatives: [{content}] }
        // Punctuation items have no start_time / end_time and no speaker_label;
        // they are appended to the current utterance's text without a space.
        const speakerUtterances = buildSpeakerUtterances(
          transcriptData?.results?.items ?? []
        );

        console.log('[transcribeService] speaker utterances:', speakerUtterances.length);

        return {
          jobName,
          status: 'COMPLETED',
          // The extracted transcript string. Empty string means the audio had no
          // recognisable speech; null means the expected JSON path was absent.
          transcript: transcript ?? '',
          // Languages detected by IdentifyMultipleLanguages.
          // Each item: { code: 'en-IN' | 'hi-IN', duration: number | null }
          detectedLanguages,
          // Speaker-separated utterances from ShowSpeakerLabels.
          // Each item: { speaker: 'spk_0'|'spk_1', startTime, endTime, text }
          // Empty array when diarization data is absent.
          speakerUtterances,
        };
      }
  
      if (job.TranscriptionJobStatus === 'FAILED') {
        throw new Error(
          job.FailureReason || 'Amazon Transcribe job failed'
        );
      }
  
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  
    throw new Error('Transcription job timed out');
  }
  
  async function transcribeAudio(objectKey) {
    const jobName = await startTranscription(objectKey);
    return waitForTranscription(jobName);
  }
  
  module.exports = {
    startTranscription,
    waitForTranscription,
    transcribeAudio,
  };