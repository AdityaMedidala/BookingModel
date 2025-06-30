const express = require('express');
const router = express.Router();
// Correctly destructure the import to get the bookingController object
const { bookingController } = require('../controllers/bookingController');

// Middleware to ensure dbPool is set
const ensureDbPool = (req, res, next) => {
  // Access the dbPool property on the imported controller object
  if (!bookingController.dbPool) {
    console.error("❌ Database connection pool not set in bookingController.");
    return res.status(500).json({
      success: false,
      message: "Server configuration error: Database connection not established."
    });
  }
  next();
};

// Middleware to log requests (for debugging)
const logRequest = (req, res, next) => {
  console.log(`📍 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log('📄 Request body:', JSON.stringify(req.body, null, 2));
  }
  if (Object.keys(req.query).length > 0) {
    console.log('🔍 Query params:', req.query);
  }
  next();
};

// Apply middleware to all routes
router.use(logRequest);
router.use(ensureDbPool);

// Validation middleware for common fields
const validateEmail = (req, res, next) => {
  // Check for email in body, params, or query for flexibility
  const email = req.body.email || req.body.organizer_email || req.params.email;

  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
  }
  next();
};

const validateDateRange = (req, res, next) => {
  const { start_datetime, end_datetime } = req.body;

  if (start_datetime && end_datetime) {
    const startTime = new Date(start_datetime);
    const endTime = new Date(end_datetime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use ISO date format.'
      });
    }

    if (startTime >= endTime) {
      return res.status(400).json({
        success: false,
        message: 'Start date/time must be before end date/time'
      });
    }

    // Check if booking is in the future (allow 5 minutes grace period)
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    if (startTime < fiveMinutesAgo) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create bookings in the past'
      });
    }
  }
  next();
};

// --- Booking Routes ---

// GET all bookings
router.get('/', bookingController.getAllBookings);

// GET bookings by room and date range
router.get('/events', bookingController.getBookingsByRoomAndDate);

// GET bookings by organizer's email
router.get('/by-email/:email', validateEmail, bookingController.getBookingsByEmail);

// POST to create a new booking
router.post('/create',
  validateEmail,
  validateDateRange,
  (req, res, next) => {
    // Additional validation for booking creation
    const { subject } = req.body;
    const totalParticipants = parseInt(req.body.total_participants);

    if (!subject || subject.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required and cannot be empty'
      });
    }

    if (isNaN(totalParticipants) || totalParticipants < 1) {
      return res.status(400).json({
        success: false,
        message: 'Total participants must be at least 1.'
      });
    }

    next();
  },
  bookingController.createBooking
);

// POST for cancelling a booking
router.post('/cancel/:eventId', bookingController.cancelBooking);

// --- NEW ROUTE: PUT to update (reschedule) a booking ---
router.put('/:eventId', 
  validateEmail, // Validate email in body
  validateDateRange, // Validate new dates
  (req, res, next) => {
    // Additional validation for booking update, similar to create
    const { subject } = req.body;
    const totalParticipants = parseInt(req.body.total_participants);

    if (!subject || subject.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required and cannot be empty.'
      });
    }

    if (isNaN(totalParticipants) || totalParticipants < 1) {
      return res.status(400).json({
        success: false,
        message: 'Total participants must be at least 1.'
      });
    }
    next();
  },
  bookingController.updateBooking
);


// --- Error Handling ---

// Error handling middleware specific to booking routes
router.use((err, req, res, next) => {
  console.error('❌ Booking route error:', err);
  const statusCode = err.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Handle specific, known error codes from Graph or other services
  if (err.code === 'InvalidAuthenticationToken') {
    return res.status(401).json({ success: false, message: 'Authentication failed. Please check credentials.' });
  }
  if (err.code === 'Forbidden') {
    return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: isDevelopment ? err.stack : undefined
  });
});

// Handle 404 for undefined routes within /api/bookings
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    availableRoutes: {
      'GET /api/bookings': 'Get all bookings',
      'GET /api/bookings/events': 'Get bookings by room and date',
      'GET /api/bookings/by-email/:email': 'Get bookings by email',
      'POST /api/bookings/create': 'Create new booking',
      'POST /api/bookings/cancel/:eventId': 'Cancel booking',
      'PUT /api/bookings/:eventId': 'Update (reschedule) booking', 
      // Removed OTP routes from here as they belong to /api/otp
      // 'POST /api/bookings/send-otp': 'Send OTP for email verification',
      // 'POST /api/bookings/verify-otp': 'Verify OTP'
    }
  });
});

module.exports = router;
