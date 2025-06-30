// routes/otpRoutes.js
const express = require('express');
const router = express.Router();
// FIX: Use destructuring to correctly get the otpController object
const { otpController } = require('../controllers/otpController');

// Middleware to ensure dbPool is set
const ensureDbPool = (req, res, next) => {
  if (!otpController.dbPool) {
    console.error("❌ Database connection pool not set in otpController. This should be set in server.js before routes are initialized.");
    return res.status(500).json({
      success: false,
      message: "Server configuration error: Database connection not established or injected into controller."
    });
  }
  next();
};

// Middleware to log requests
const logRequest = (req, res, next) => {
  console.log(`📍 OTP ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
};

// Email validation middleware for body/query
const validateEmail = (req, res, next) => {
  const { email } = req.body || req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format'
    });
  }

  next();
};

// Email validation middleware for URL parameters
const validateEmailParam = (req, res, next) => {
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format'
    });
  }

  next();
};

// OTP verification middleware
const validateOtp = (req, res, next) => {
  const { otp } = req.body;
  if (!otp || typeof otp !== 'string' || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: 'OTP must be a 6-digit number.'
    });
  }
  next();
};

// Routes
router.post('/send', validateEmail, logRequest, ensureDbPool, otpController.sendOtp);
router.post('/verify', validateEmail, validateOtp, logRequest, ensureDbPool, otpController.verifyOtp);
router.get('/status/:email', validateEmailParam, logRequest, ensureDbPool, otpController.checkVerificationStatus);
router.post('/cleanup-expired', logRequest, ensureDbPool, otpController.cleanupExpiredOtps);

// Log a message to see if otpController methods are defined when routes are being set up
console.log('OTP Controller methods in otpRoutes.js (after require):');
console.log('  otpController.sendOtp type:', typeof otpController.sendOtp);
console.log('  otpController.verifyOtp type:', typeof otpController.verifyOtp);

// Generic error handling for routes within this router (after specific middleware)
router.use((err, req, res, next) => {
  console.error('❌ OTP route error:', err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      error: err.message
    });
  }

  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      message: 'Database connection failed'
    });
  }

  if (err.code === 'ETIMEDOUT') {
    return res.status(504).json({
      success: false,
      message: 'Request timeout. Please try again.'
    });
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Handle 404 for undefined routes within /api/otp
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `OTP API route not found: ${req.method} ${req.originalUrl}`,
  });
});

module.exports = router;