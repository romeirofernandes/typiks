const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const connectDB = async () => {
  try {
    const response = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected. Host: ${response.connection.host}`)
  } catch (error) {
    console.log(error)
  }
};

module.exports = connectDB;
