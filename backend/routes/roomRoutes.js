const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Import fs for file system operations

const { roomController } = require('../controllers/roomController'); // Import the room controller

// --- Multer Storage Configuration ---
// Configures how uploaded files (images) will be stored on the server.
const storage = multer.diskStorage({
  // Defines the destination directory for uploaded files
  destination: (req, file, cb) => {
    // Save files to the public/uploads directory relative to server.js
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads');
    // Ensure the directory exists. This is also handled in server.js, but good to have here too.
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  // Defines the filename for the uploaded file
  filename: (req, file, cb) => {
    // Create a unique filename to prevent overwrites,
    // using current timestamp and a random number, preserving original extension.
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Initialize multer upload middleware with the configured storage.
// This middleware will process 'image' field in multipart/form-data.
const upload = multer({ storage: storage });

// --- Middleware for Admin Authentication (Simplified for this example) ---
// This middleware ensures that only authenticated admin requests can access room modification routes.
// In a real application, this would involve JWT verification or session checks.
const authenticateAdmin = (req, res, next) => {
  const adminToken = req.headers['x-admin-auth']; // Expecting a custom header for admin auth

  // For demonstration, use a hardcoded token. This should be replaced by a robust auth system.
  const HARDCODED_ADMIN_TOKEN = 'simulated_admin_token'; 

  if (adminToken === HARDCODED_ADMIN_TOKEN) {
    next(); // Admin authenticated, proceed to the next middleware/route handler
  } else {
    res.status(401).json({ message: 'Unauthorized: Admin authentication required.' });
  }
};

// --- API Routes for Rooms ---

// GET all rooms (Publicly accessible)
router.get('/', roomController.getAllRooms);

// POST a new room (Requires admin authentication, uses Multer for image upload)
// 'upload.single('image')' middleware handles parsing the 'image' file from the form data.
router.post('/', authenticateAdmin, upload.single('image'), roomController.createRoom);

// PUT (update) a room by ID (Requires admin authentication, optional new image upload)
router.put('/:id', authenticateAdmin, upload.single('image'), roomController.updateRoom);

// DELETE a room by ID (Requires admin authentication)
router.delete('/:id', authenticateAdmin, roomController.deleteRoom);

module.exports = router;
