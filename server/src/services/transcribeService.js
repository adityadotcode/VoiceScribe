const {
    TranscribeClient,
    StartTranscriptionJobCommand,
    GetTranscriptionJobCommand,
  } = require('@aws-sdk/client-transcribe');
  
  const { awsRegion, s3BucketName } = require('../config/env');
  
  const transcribeClient = new TranscribeClient({
    region: awsRegion,
  });
  
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

        return {
          jobName,
          status: 'COMPLETED',
          // The extracted transcript string. Empty string means the audio had no
          // recognisable speech; null means the expected JSON path was absent.
          transcript: transcript ?? '',
          // Languages detected by IdentifyMultipleLanguages.
          // Each item: { code: 'en-IN' | 'hi-IN', duration: number | null }
          detectedLanguages,
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