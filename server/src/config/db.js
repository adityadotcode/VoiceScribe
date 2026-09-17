const mongoose = require('mongoose');

async function connectDb(uri) {
  if (!uri) {
    console.warn('MONGODB_URI is not set. Skipping database connection.');
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
  }
}

module.exports = { connectDb };
