const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const sanitizedName = file.originalname
            .replace(/\.[^/.]+$/, "")
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase();

        return {
            folder: 'mp3-songs',
            resource_type: 'video', // Cloudinary treats mp3 as video resource
            allowed_formats: ['mp3'],
            public_id: `song-${Date.now()}-${sanitizedName}`,
            overwrite: false,
            invalidate: true
        };
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },  // 100 MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3') {
            cb(null, true);
        } else {
            cb(new Error('Only MP3 files are allowed!'), false);
        }
    }
});

module.exports = upload;
