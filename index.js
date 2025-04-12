require("dotenv").config()
const express = require("express")
const mongoose = require("mongoose")
const cors = require("cors")
const { v4: uuidv4 } = require("uuid")
const cloudinary = require("cloudinary").v2
const multer = require("multer")
const path = require("path")

// Initialize Express app
const app = express()

// Middleware
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    }),
)
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true }))

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
})

// MongoDB Connection with retry logic
const connectWithRetry = () => {
    const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
    }

    mongoose
        .connect(process.env.MONGODB_URI, options)
        .then(() => console.log("MongoDB connected successfully"))
        .catch((err) => {
            console.error("MongoDB connection error:", err.message)
            console.log("Retrying connection in 5 seconds...")
            setTimeout(connectWithRetry, 5000)
        })
}

connectWithRetry()

// Mongoose Schema
const songSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
            maxlength: [100, "Title cannot exceed 100 characters"],
        },
        artist: {
            type: String,
            trim: true,
            default: "Unknown",
        },
        publicId: {
            type: String,
            required: true,
        },
        fileUrl: {
            type: String,
            required: true,
            validate: {
                validator: (v) => /^https?:\/\/.+/i.test(v),
                message: "Invalid URL format",
            },
        },
        playCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        duration: {
            type: Number,
            min: 0,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        versionKey: false,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    },
)

// Indexes
songSchema.index({ title: "text", artist: "text" })
songSchema.index({ playCount: -1 })

const Song = mongoose.model("Song", songSchema)

// Multer configuration (for file upload)
const storage = multer.memoryStorage()
const upload = multer({
    storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/aac"]
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true)
        } else {
            cb(new Error("Invalid file type. Only audio files are allowed."), false)
        }
    },
}).single("song")

// Middleware for handling file upload errors
const handleUploadErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message })
    } else if (err) {
        return res.status(400).json({ error: err.message })
    }
    next()
}

// Upload to Cloudinary
const uploadToCloudinary = async (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                public_id: `songs/${uuidv4()}`,
                format: "mp3",
                overwrite: true,
            },
            (error, result) => {
                if (error) reject(error)
                else resolve(result)
            },
        )

        stream.end(buffer)
    })
}

// Routes
app.post(
    "/api/songs",
    (req, res, next) => {
        upload(req, res, (err) => {
            if (err) return handleUploadErrors(err, req, res, next)
            next()
        })
    },
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" })
            }

            const { title, artist } = req.body
            if (!title) {
                return res.status(400).json({ error: "Title is required" })
            }

            const result = await uploadToCloudinary(req.file.buffer)

            const newSong = new Song({
                title,
                artist: artist || "Unknown",
                publicId: result.public_id,
                fileUrl: result.secure_url,
                duration: Math.floor(result.duration || 0),
            })

            const savedSong = await newSong.save()
            res.status(201).json(savedSong)
        } catch (error) {
            console.error("Upload error:", error)
            res.status(500).json({
                error: "Server error",
                details: process.env.NODE_ENV === "development" ? error.message : undefined,
            })
        }
    },
)

app.get("/api/songs", async (req, res) => {
    try {
        const { search, sort } = req.query
        const query = {}

        if (search) {
            query.$text = { $search: search }
        }

        const sortOptions = {}
        if (sort === "popular") {
            sortOptions.playCount = -1
        } else {
            sortOptions.createdAt = -1
        }

        const songs = await Song.find(query).sort(sortOptions).limit(100).lean()

        res.json(songs)
    } catch (error) {
        res.status(500).json({ error: "Server error" })
    }
})

// Get a single song by ID
app.get("/api/songs/:id", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid song ID" })
        }

        const song = await Song.findById(req.params.id)

        if (!song) {
            return res.status(404).json({ error: "Song not found" })
        }

        res.json(song)
    } catch (error) {
        console.error("Error fetching song:", error)
        res.status(500).json({ error: "Server error" })
    }
})

// Update a song
app.put("/api/songs/:id", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid song ID" })
        }

        const { title, artist } = req.body

        if (!title) {
            return res.status(400).json({ error: "Title is required" })
        }

        const updatedSong = await Song.findByIdAndUpdate(
            req.params.id,
            {
                title,
                artist: artist || "Unknown",
            },
            { new: true, runValidators: true },
        )

        if (!updatedSong) {
            return res.status(404).json({ error: "Song not found" })
        }

        res.json(updatedSong)
    } catch (error) {
        console.error("Update error:", error)
        res.status(500).json({ error: "Server error" })
    }
})

// Delete a song
app.delete("/api/songs/:id", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid song ID" })
        }

        const song = await Song.findById(req.params.id)

        if (!song) {
            return res.status(404).json({ error: "Song not found" })
        }

        // Delete from Cloudinary if needed
        if (song.publicId) {
            try {
                await cloudinary.uploader.destroy(song.publicId)
            } catch (cloudinaryError) {
                console.error("Error deleting from Cloudinary:", cloudinaryError)
                // Continue with deletion from database even if Cloudinary fails
            }
        }

        await Song.findByIdAndDelete(req.params.id)

        res.json({ message: "Song deleted successfully" })
    } catch (error) {
        console.error("Delete error:", error)
        res.status(500).json({ error: "Server error" })
    }
})

app.put("/api/songs/play/:id", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid song ID" })
        }

        const song = await Song.findByIdAndUpdate(
            req.params.id,
            { $inc: { playCount: 1 } },
            { new: true, runValidators: true },
        )

        if (!song) {
            return res.status(404).json({ error: "Song not found" })
        }

        res.json(song)
    } catch (error) {
        res.status(500).json({ error: "Server error" })
    }
})

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).json({ error: "Internal Server Error" })
})

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        database: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
        timestamp: new Date(),
    })
})

// Start server
const PORT = process.env.PORT || 4000
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down gracefully...")
    server.close(() => {
        mongoose.connection.close(false, () => {
            console.log("MongoDB connection closed")
            process.exit(0)
        })
    })
})
