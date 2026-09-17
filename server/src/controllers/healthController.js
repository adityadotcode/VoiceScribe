function getHealth(_req, res) {
  res.json({
    success: true,
    message: 'VoiceScribe API is running',
  });
}

module.exports = { getHealth };
