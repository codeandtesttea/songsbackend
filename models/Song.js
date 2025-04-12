const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    publicId: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String,
        required: true
    },
    playCount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('Song', songSchema);
