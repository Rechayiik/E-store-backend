const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { testConnection } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const orderRoutes = require('./routes/orders');
const cartRoutes = require('./routes/cart');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'E-Commerce API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Register new user',
        'POST /api/auth/login': 'Login user',
        'GET /api/auth/me': 'Get current user (requires auth)'
      },
      products: {
        'GET /api/products': 'Get all products (with filtering/sorting)',
        'GET /api/products/:id': 'Get single product',
        'POST /api/products': 'Create product (admin only)',
        'PUT /api/products/:id': 'Update product (admin only)',
        'DELETE /api/products/:id': 'Delete product (admin only)'
      },
      categories: {
        'GET /api/categories': 'Get all categories',
        'GET /api/categories/:id': 'Get single category',
        'POST /api/categories': 'Create category (admin only)',
        'PUT /api/categories/:id': 'Update category (admin only)',
        'DELETE /api/categories/:id': 'Delete category (admin only)'
      },
      orders: {
        'GET /api/orders': 'Get user orders (requires auth)',
        'GET /api/orders/:id': 'Get single order (requires auth)',
        'POST /api/orders': 'Create order (requires auth)',
        'PATCH /api/orders/:id/status': 'Update order status (admin only)',
        'GET /api/orders/admin/all': 'Get all orders (admin only)'
      },
      cart: {
        'GET /api/cart': 'Get user cart (requires auth)',
        'POST /api/cart/items': 'Add item to cart (requires auth)',
        'PUT /api/cart/items/:id': 'Update cart item (requires auth)',
        'DELETE /api/cart/items/:id': 'Remove cart item (requires auth)',
        'DELETE /api/cart': 'Clear cart (requires auth)'
      }
    },
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer <token>',
      note: 'Include JWT token in Authorization header for protected routes'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request entity too large' });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
});

// Start server
const startServer = async () => {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. Please check your database configuration.');
      process.exit(1);
    }

    app.listen(PORT, () => {
      console.log(`🚀 E-Commerce Backend Server running on port ${PORT}`);
      console.log(`📚 API Documentation: http://localhost:${PORT}/api`);
      console.log(`🔍 Health Check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`💾 Database: ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('\n📋 Quick Start:');
        console.log('1. Run database setup: npm run setup-db');
        console.log('2. Test API: http://localhost:3001/api');
        console.log('3. Admin Login: admin@estore.com / admin123');
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

startServer();

module.exports = app;