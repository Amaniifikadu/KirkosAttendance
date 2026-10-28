const mongoose = require("mongoose");

async function connectToDatabase() {
  const { MONGODB_URI } = process.env;

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set. Create a .env file from .env.example and configure it."
    );
  }

  await mongoose.connect(MONGODB_URI);
  console.log(`MongoDB connected to database "${mongoose.connection.name}".`);
}

module.exports = connectToDatabase;
