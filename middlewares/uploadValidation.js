module.exports = (req, res, next) => {
    // Check for multipart/form-data content type
    if (!req.is('multipart/form-data')) {
        return res.status(400).json({
            error: "Invalid content type. Use multipart/form-data"
        });
    }

    // Validate that 'title' exists in the form body
    if (!req.body.title || typeof req.body.title !== 'string') {
        return res.status(400).json({
            error: "Title is required and must be a string"
        });
    }

    next();
};
