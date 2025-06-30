// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { adminController } = require('../controllers/adminController'); // Destructure properly
const multer = require('multer'); // Import multer for file uploads in admin routes if needed for rooms
const path = require('path'); // For path operations if handling files directly in routes

// --- Multer Storage Configuration (for room management within admin routes if you chose to put it here) ---
// Note: Room management routes are now handled by roomRoutes.js which has its own multer setup.
// This block is kept commented out as a reference if you decide to consolidate.
/*
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });
*/

// Middleware to ensure dbPool is set for admin routes before any operations
const ensureDbPool = (req, res, next) => {
  if (!adminController.dbPool) {
    console.error("❌ Database connection pool not set in adminController.");
    return res.status(500).json({
      success: false,
      message: "Server configuration error: Database connection not established."
    });
  }
  next(); // Proceed to the next middleware or route handler
};

router.use(ensureDbPool); // Apply this middleware to all admin routes

// Test route to verify admin routes are working
router.get('/test', (req, res) => {
    res.json({ message: 'Admin routes are working!', timestamp: new Date().toISOString() });
});

// Admin Authentication Route
// This route handles admin login and returns a token upon successful authentication.
router.post('/login', adminController.adminLogin);

// Public route to get active rooms (doesn't require authentication via x-admin-auth)
// This is for the main public facing site to list available rooms.
// If your room listing endpoint for the main page is different, adjust this.
router.get('/rooms', async (req, res) => {
    try {
        if (!adminController.dbPool) {
            return res.status(500).json({ error: 'Database connection not available' });
        }
        const request = adminController.dbPool.request();
        // Assuming 'is_active' column in 'rooms' table for publicly visible rooms
        // If not, simply query all rooms: 'SELECT * FROM rooms'
        const result = await request.query('SELECT * FROM rooms');
        res.json(result.recordset.map(room => ({
            ...room,
            features: room.features ? room.features.split(',').map(f => f.trim()) : [],
            image: room.image ? `${req.protocol}://${req.get('host')}${room.image}` : null
        })));
    } catch (error) {
        console.error('Error fetching rooms for public view:', error);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// Simplified Admin Authentication Middleware
// This middleware acts as a gatekeeper for routes that require admin privileges.
// IMPORTANT: This is a SIMPLIFIED authentication and is INSECURE for production.
// A real application would use JWT verification, session management, etc.
const authenticateAdmin = async (req, res, next) => {
    // This middleware expects a custom header 'x-admin-auth' containing the simulated token.
    const hardcodedAdminToken = 'simulated_admin_token'; // Matches the token set in adminController.js
    const authHeader = req.headers['x-admin-auth'] || req.headers['authorization']; // Check both headers

    // Compare the provided token with the hardcoded admin token
    if (authHeader === hardcodedAdminToken || (authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1] === hardcodedAdminToken)) {
        next(); // User is "authenticated" as admin, proceed to the next middleware/route
    } else {
        // If authentication fails, send a 401 Unauthorized response
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin access required.' });
    }
};

// --- Protected Admin Routes ---
// Apply the simplified authentication middleware to all routes defined below this line.
router.use(authenticateAdmin);

// Booking Management (Admin View)
// Route to get all bookings, typically for a calendar or list view in the admin dashboard.
router.get('/bookings', adminController.getAllBookings); // <--- CORRECTED: Changed getAllBookingsAdmin to getAllBookings

// Admin booking cancellation
// Route to delete/cancel a booking by its event ID.
router.delete('/bookings/:eventId', adminController.deleteBooking); // <--- CORRECTED: Changed deleteBookingAdmin to deleteBooking

// Admin-specific Email Sending
// Route to send custom emails related to bookings (e.g., reschedule notifications).
router.post('/send-reschedule-email', adminController.sendRescheduleEmail);

// Admin-specific create booking
// Route for administrators to manually create new bookings.
router.post('/bookings', adminController.createBookingAdmin);


// Admin-specific error handling middleware
// Catches any errors that occur in the admin routes and sends a consistent error response.
router.use((err, req, res, next) => {
    console.error('❌ Admin route error:', err); // Log the detailed error
    res.status(500).json({
        success: false,
        message: 'Internal server error in admin routes',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong' // Show error message in dev mode
    });
});

// Handle 404 for undefined routes within the /api/admin path
// This catches any requests to /api/admin/* that don't match the defined routes above.
router.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: `Admin Route ${req.method} ${req.originalUrl} not found`,
        availableRoutes: { // Provide a list of available admin routes for debugging/API documentation
            'POST /api/admin/login': 'Admin login',
            'GET /api/admin/rooms': 'Get active rooms (public)', // Note: This is a public route under /admin for convenience
            'GET /api/admin/bookings': 'Get all bookings (admin view)',
            'DELETE /api/admin/bookings/:eventId': 'Delete booking (admin only)',
            'POST /api/admin/send-reschedule-email': 'Send reschedule email',
            'POST /api/admin/bookings': 'Create new booking (admin only)'
        }
    });
});

module.exports = router;
