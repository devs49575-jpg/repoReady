const mongoose = require('mongoose');

exports.connect = () => mongoose.connect(process.env.DB_URL);
