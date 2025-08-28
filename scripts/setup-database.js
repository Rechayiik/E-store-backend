const mysql = require('mysql2/promise');
require('dotenv').config();

const setupDatabase = async () => {
  let connection;
  
  try {
    // Connect without specifying database first
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'ecommerce_db',
      port: process.env.DB_PORT || 3306
    });

    console.log('📡 Connected to MySQL server');

    // Create database if it doesn't exist
    await connection.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'ecommerce_db'}`);
    console.log(`📦 Database ${process.env.DB_NAME || 'ecommerce_db'} created/verified`);

    // Use the database
    //await connection.execute(`USE ${process.env.DB_NAME || 'ecommerce_db'}`);

    // Create tables
    const createTablesSQL = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email)
    );

    -- Categories table
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_slug (slug)
    );

    -- Products table
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(12, 2) NOT NULL,
      image VARCHAR(500),
      category_id VARCHAR(36),
      stock INT DEFAULT 0,
      rating DECIMAL(3, 2) DEFAULT 0,
      reviews_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      INDEX idx_category (category_id),
      INDEX idx_price (price),
      INDEX idx_stock (stock)
    );

    -- Addresses table
    CREATE TABLE IF NOT EXISTS addresses (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      street VARCHAR(255) NOT NULL,
      city VARCHAR(100) NOT NULL,
      district VARCHAR(100) NOT NULL,
      postal_code VARCHAR(20),
      country VARCHAR(100) NOT NULL DEFAULT 'Uganda',
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user (user_id)
    );

    -- Orders table
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      total DECIMAL(12, 2) NOT NULL,
      vat_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
      status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
      payment_method VARCHAR(50),
      shipping_address_id VARCHAR(36),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (shipping_address_id) REFERENCES addresses(id),
      INDEX idx_user (user_id),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at)
    );

    -- Order Items table
    CREATE TABLE IF NOT EXISTS order_items (
      id VARCHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL,
      product_id VARCHAR(36) NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(12, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      INDEX idx_order (order_id),
      INDEX idx_product (product_id)
    );

    -- Shopping Cart table
    CREATE TABLE IF NOT EXISTS cart_items (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      product_id VARCHAR(36) NOT NULL,
      quantity INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_product (user_id, product_id),
      INDEX idx_user (user_id)
    );

    -- Product Reviews table
    CREATE TABLE IF NOT EXISTS reviews (
      id VARCHAR(36) PRIMARY KEY,
      product_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_product_review (user_id, product_id),
      INDEX idx_product (product_id),
      INDEX idx_rating (rating)
    );
    `;

    // Execute table creation
    const statements = createTablesSQL.split(';').filter(stmt => stmt.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.execute(statement);
      }
    }

    console.log('🏗️  All tables created successfully');

    // Insert sample categories
    const { v4: uuidv4 } = require('uuid');
    
    const categories = [
      { id: uuidv4(), name: 'Electronics', slug: 'electronics', description: 'Latest electronic devices and gadgets' },
      { id: uuidv4(), name: 'Clothing', slug: 'clothing', description: 'Fashion and apparel for all' },
      { id: uuidv4(), name: 'Home & Garden', slug: 'home-garden', description: 'Everything for your home and garden' },
      { id: uuidv4(), name: 'Sports', slug: 'sports', description: 'Sports equipment and accessories' },
      { id: uuidv4(), name: 'Books', slug: 'books', description: 'Books and educational materials' }
    ];

    for (const category of categories) {
      await connection.execute(
        'INSERT IGNORE INTO categories (id, name, slug, description) VALUES (?, ?, ?, ?)',
        [category.id, category.name, category.slug, category.description]
      );
    }

    // Insert sample products
    const products = [
      {
        id: uuidv4(),
        name: 'Wireless Bluetooth Headphones',
        description: 'High-quality wireless headphones with noise cancellation and 30-hour battery life.',
        price: 750000,
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&h=500&fit=crop',
        category_id: categories[0].id,
        stock: 50,
        rating: 4.5,
        reviews_count: 127
      },
      {
        id: uuidv4(),
        name: 'Smart Watch Series X',
        description: 'Advanced fitness tracking, heart rate monitor, and smartphone integration.',
        price: 1100000,
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&h=500&fit=crop',
        category_id: categories[0].id,
        stock: 30,
        rating: 4.7,
        reviews_count: 89
      },
      {
        id: uuidv4(),
        name: 'Premium Cotton T-Shirt',
        description: 'Comfortable, breathable cotton t-shirt available in multiple colors and sizes.',
        price: 110000,
        image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500&h=500&fit=crop',
        category_id: categories[1].id,
        stock: 100,
        rating: 4.3,
        reviews_count: 245
      },
      {
        id: uuidv4(),
        name: 'Leather Messenger Bag',
        description: 'Handcrafted genuine leather messenger bag perfect for work or travel.',
        price: 550000,
        image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&h=500&fit=crop',
        category_id: categories[1].id,
        stock: 25,
        rating: 4.6,
        reviews_count: 67
      },
      {
        id: uuidv4(),
        name: 'Coffee Maker Deluxe',
        description: 'Programmable coffee maker with built-in grinder and thermal carafe.',
        price: 660000,
        image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=500&h=500&fit=crop',
        category_id: categories[2].id,
        stock: 40,
        rating: 4.4,
        reviews_count: 156
      },
      {
        id: uuidv4(),
        name: 'Yoga Mat Pro',
        description: 'Non-slip, eco-friendly yoga mat with alignment guides and carrying strap.',
        price: 220000,
        image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=500&h=500&fit=crop',
        category_id: categories[3].id,
        stock: 75,
        rating: 4.2,
        reviews_count: 203
      },
      {
        id: uuidv4(),
        name: 'Programming Fundamentals Book',
        description: 'Comprehensive guide to programming concepts with practical examples.',
        price: 145000,
        image: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=500&h=500&fit=crop',
        category_id: categories[4].id,
        stock: 60,
        rating: 4.8,
        reviews_count: 312
      },
      {
        id: uuidv4(),
        name: '4K Webcam',
        description: 'Ultra HD webcam with auto-focus and built-in microphone for streaming.',
        price: 480000,
        image: 'https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=500&h=500&fit=crop',
        category_id: categories[0].id,
        stock: 35,
        rating: 4.1,
        reviews_count: 94
      }
    ];

    for (const product of products) {
      await connection.execute(
        'INSERT IGNORE INTO products (id, name, description, price, image, category_id, stock, rating, reviews_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [product.id, product.name, product.description, product.price, product.image, product.category_id, product.stock, product.rating, product.reviews_count]
      );
    }

    // Create admin user
    const bcrypt = require('bcryptjs');
    const adminPassword = await bcrypt.hash('admin123', 10);
    await connection.execute(
      'INSERT IGNORE INTO users (id, email, password_hash, first_name, last_name, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), 'admin@estore.com', adminPassword, 'Admin', 'User', true]
    );

    console.log('🌱 Sample data inserted successfully');
    console.log('👤 Admin user created: admin@estore.com / admin123');
    console.log('🎉 Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

// Run setup if called directly
if (require.main === module) {
  setupDatabase();
}

module.exports = setupDatabase;