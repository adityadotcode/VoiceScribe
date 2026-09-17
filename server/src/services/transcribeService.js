const {
    TranscribeClient,
    StartTranscriptionJobCommand,
    GetTranscriptionJobCommand,
  } = require('@aws-sdk/client-transcribe');
  
  const { awsRegion, s3BucketName } = require('../config/env');
  
  const transcribeClient = new TranscribeClient({
    region: awsRegion,
  });
  
  function createJobName() {
    return `voicescribe-${Date.now()}`;
  }
  
  async function startTranscription(objectKey) {
    if (!objectKey) {
      throw new Error('S3 object key is required');
    }
  
    const jobName = createJobName();
  
    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
  
      Media: {
        MediaFileUri: `s3://${s3BucketName}/${objectKey}`,
      },
  
      MediaFormat: 'webm',
  
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
  
        return {
          jobName,
          status: 'COMPLETED',
          transcript: transcriptData.results?.transcripts?.[0]?.transcript || '',
          rawResult: transcriptData,
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