const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user cart
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [cartItems] = await pool.execute(`
      SELECT ci.*, p.name, p.description, p.price, p.image, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `, [req.user.id]);

    const items = cartItems.map(item => ({
      id: item.id,
      product: {
        id: item.product_id,
        name: item.name,
        description: item.description,
        price: parseFloat(item.price),
        image: item.image,
        stock: item.stock
      },
      quantity: item.quantity,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));

    const total = items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

    res.json({
      items,
      total,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0)
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add item to cart
router.post('/items', authenticateToken, [
  body('productId').isUUID(),
  body('quantity').isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity } = req.body;

    // Check if product exists and has sufficient stock
    const [products] = await pool.execute(
      'SELECT id, name, price, stock FROM products WHERE id = ?',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[0];
    if (product.stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    // Check if item already in cart
    const [existingItems] = await pool.execute(
      'SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?',
      [req.user.id, productId]
    );

    if (existingItems.length > 0) {
      // Update existing item
      const newQuantity = existingItems[0].quantity + quantity;
      if (product.stock < newQuantity) {
        return res.status(400).json({ error: 'Insufficient stock for updated quantity' });
      }

      await pool.execute(
        'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newQuantity, existingItems[0].id]
      );
    } else {
      // Add new item
      await pool.execute(
        'INSERT INTO cart_items (id, user_id, product_id, quantity) VALUES (?, ?, ?, ?)',
        [uuidv4(), req.user.id, productId, quantity]
      );
    }

    res.status(201).json({ message: 'Item added to cart successfully' });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update cart item quantity
router.put('/items/:id', authenticateToken, [
  body('quantity').isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { quantity } = req.body;
    const itemId = req.params.id;

    // Get cart item with product info
    const [cartItems] = await pool.execute(`
      SELECT ci.*, p.stock 
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = ? AND ci.user_id = ?
    `, [itemId, req.user.id]);

    if (cartItems.length === 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    const cartItem = cartItems[0];
    if (cartItem.stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    await pool.execute(
      'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [quantity, itemId]
    );

    res.json({ message: 'Cart item updated successfully' });
  } catch (error) {
    console.error('Update cart item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove item from cart
router.delete('/items/:id', authenticateToken, async (req, res) => {
  try {
    const itemId = req.params.id;

    const [result] = await pool.execute(
      'DELETE FROM cart_items WHERE id = ? AND user_id = ?',
      [itemId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    res.json({ message: 'Item removed from cart successfully' });
  } catch (error) {
    console.error('Remove cart item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear cart
router.delete('/', authenticateToken, async (req, res) => {
  try {
    await pool.execute('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Cart cleared successfully' });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;