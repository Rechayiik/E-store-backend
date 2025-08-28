const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all products with filtering and sorting
router.get('/', async (req, res) => {
  try {
    const { 
      category, 
      search, 
      minPrice, 
      maxPrice, 
      minRating, 
      sortBy = 'name', 
      order = 'ASC',
      page = 1,
      limit = 20
    } = req.query;

    let query = `
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    const params = [];

    // Apply filters
    if (category && category !== 'all') {
      query += ' AND c.name = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (minPrice) {
      query += ' AND p.price >= ?';
      params.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      query += ' AND p.price <= ?';
      params.push(parseFloat(maxPrice));
    }

    if (minRating) {
      query += ' AND p.rating >= ?';
      params.push(parseFloat(minRating));
    }

    // Apply sorting
    const validSortFields = ['name', 'price', 'rating', 'created_at', 'stock'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    query += ` ORDER BY p.${sortField} ${sortOrder}`;

    // Apply pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [products] = await pool.execute(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    const countParams = [];

    // Apply same filters for count
    if (category && category !== 'all') {
      countQuery += ' AND c.name = ?';
      countParams.push(category);
    }

    if (search) {
      countQuery += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }

    if (minPrice) {
      countQuery += ' AND p.price >= ?';
      countParams.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      countQuery += ' AND p.price <= ?';
      countParams.push(parseFloat(maxPrice));
    }

    if (minRating) {
      countQuery += ' AND p.rating >= ?';
      countParams.push(parseFloat(minRating));
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      products: products.map(product => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: parseFloat(product.price),
        image: product.image,
        category: product.category_name,
        stock: product.stock,
        rating: parseFloat(product.rating),
        reviews: product.reviews_count,
        createdAt: product.created_at,
        updatedAt: product.updated_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const [products] = await pool.execute(`
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.id = ?
    `, [req.params.id]);

    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[0];
    res.json({
      id: product.id,
      name: product.name,
      description: product.description,
      price: parseFloat(product.price),
      image: product.image,
      category: product.category_name,
      stock: product.stock,
      rating: parseFloat(product.rating),
      reviews: product.reviews_count,
      createdAt: product.created_at,
      updatedAt: product.updated_at
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create product (Admin only)
router.post('/', authenticateToken, requireAdmin, [
  body('name').trim().isLength({ min: 1 }),
  body('description').trim().isLength({ min: 1 }),
  body('price').isFloat({ min: 0 }),
  body('categoryId').isUUID(),
  body('stock').isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, price, image, categoryId, stock } = req.body;

    const productId = uuidv4();
    await pool.execute(
      'INSERT INTO products (id, name, description, price, image, category_id, stock) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [productId, name, description, price, image || null, categoryId, stock]
    );

    // Get the created product with category info
    const [products] = await pool.execute(`
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.id = ?
    `, [productId]);

    const product = products[0];
    res.status(201).json({
      message: 'Product created successfully',
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        price: parseFloat(product.price),
        image: product.image,
        category: product.category_name,
        stock: product.stock,
        rating: parseFloat(product.rating),
        reviews: product.reviews_count
      }
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update product (Admin only)
router.put('/:id', authenticateToken, requireAdmin, [
  body('name').optional().trim().isLength({ min: 1 }),
  body('description').optional().trim().isLength({ min: 1 }),
  body('price').optional().isFloat({ min: 0 }),
  body('categoryId').optional().isUUID(),
  body('stock').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, price, image, categoryId, stock } = req.body;
    const productId = req.params.id;

    // Check if product exists
    const [existingProducts] = await pool.execute('SELECT id FROM products WHERE id = ?', [productId]);
    if (existingProducts.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Build update query dynamically
    const updateFields = [];
    const updateParams = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateParams.push(name);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateParams.push(description);
    }
    if (price !== undefined) {
      updateFields.push('price = ?');
      updateParams.push(price);
    }
    if (image !== undefined) {
      updateFields.push('image = ?');
      updateParams.push(image);
    }
    if (categoryId !== undefined) {
      updateFields.push('category_id = ?');
      updateParams.push(categoryId);
    }
    if (stock !== undefined) {
      updateFields.push('stock = ?');
      updateParams.push(stock);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateParams.push(productId);

    await pool.execute(
      `UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated product
    const [products] = await pool.execute(`
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.id = ?
    `, [productId]);

    const product = products[0];
    res.json({
      message: 'Product updated successfully',
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        price: parseFloat(product.price),
        image: product.image,
        category: product.category_name,
        stock: product.stock,
        rating: parseFloat(product.rating),
        reviews: product.reviews_count
      }
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete product (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;

    const [result] = await pool.execute('DELETE FROM products WHERE id = ?', [productId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;