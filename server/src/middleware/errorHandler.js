function errorHandler(err, _req, res, _next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Audio file is too large.',
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.message === 'INVALID_AUDIO_TYPE') {
    return res.status(400).json({
      success: false,
      message: 'Please upload a valid audio file.',
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    message: 'Something went wrong.',
  });
}

module.exports = { errorHandler };
