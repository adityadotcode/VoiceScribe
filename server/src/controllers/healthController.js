function getHealth(_req, res) {
  res.json({
    success: true,
    service: 'VoiceScribe API',
    status:  'ok',
    message: 'VoiceScribe API is running',
  });
}

module.exports = { getHealth };
