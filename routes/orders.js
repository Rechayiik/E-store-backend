const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get user orders
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [orders] = await pool.execute(`
      SELECT o.*, a.street, a.city, a.district, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.user.id, parseInt(limit), offset]);

    // Get order items for each order
    for (let order of orders) {
      const [items] = await pool.execute(`
        SELECT oi.*, p.name, p.image
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      order.items = items.map(item => ({
        id: item.id,
        productId: item.product_id,
        name: item.name,
        image: item.image,
        quantity: item.quantity,
        price: parseFloat(item.price)
      }));
    }

    res.json({
      orders: orders.map(order => ({
        id: order.id,
        total: parseFloat(order.total),
        vatAmount: parseFloat(order.vat_amount),
        status: order.status,
        paymentMethod: order.payment_method,
        notes: order.notes,
        shippingAddress: order.street ? {
          street: order.street,
          city: order.city,
          district: order.district,
          country: order.country
        } : null,
        items: order.items,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      }))
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single order
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [orders] = await pool.execute(`
      SELECT o.*, a.street, a.city, a.district, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.id = ? AND (o.user_id = ? OR ? = 1)
    `, [req.params.id, req.user.id, req.user.is_admin]);

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];

    // Get order items
    const [items] = await pool.execute(`
      SELECT oi.*, p.name, p.image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [order.id]);

    res.json({
      id: order.id,
      total: parseFloat(order.total),
      vatAmount: parseFloat(order.vat_amount),
      status: order.status,
      paymentMethod: order.payment_method,
      notes: order.notes,
      shippingAddress: order.street ? {
        street: order.street,
        city: order.city,
        district: order.district,
        country: order.country
      } : null,
      items: items.map(item => ({
        id: item.id,
        productId: item.product_id,
        name: item.name,
        image: item.image,
        quantity: item.quantity,
        price: parseFloat(item.price)
      })),
      createdAt: order.created_at,
      updatedAt: order.updated_at
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create order
router.post('/', authenticateToken, [
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('total').isFloat({ min: 0 }),
  body('vatAmount').isFloat({ min: 0 }),
  body('paymentMethod').isIn(['mobile_money', 'card', 'cash']),
  body('shippingAddress').optional().isObject(),
  body('notes').optional().trim()
], async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await connection.rollback();
      return res.status(400).json({ errors: errors.array() });
    }

    const { items, total, vatAmount, paymentMethod, shippingAddress, notes } = req.body;

    // Validate products and stock
    const productIds = items.map(item => item.productId);
    const [products] = await connection.execute(
      `SELECT id, name, price, stock FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    );

    if (products.length !== items.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Some products not found' });
    }

    // Check stock and calculate total
    let calculatedTotal = 0;
    const productMap = new Map(products.map(p => [p.id, p]));

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (product.stock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({ 
          error: `Insufficient stock for ${product.name}` 
        });
      }
      calculatedTotal += parseFloat(product.price) * item.quantity;
    }

    // Verify total (allow small floating point differences)
    const expectedVat = calculatedTotal * 0.18;
    const expectedTotal = calculatedTotal + expectedVat;
    
    if (Math.abs(expectedTotal - total) > 0.01 || Math.abs(expectedVat - vatAmount) > 0.01) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid total calculation' });
    }

    // Create shipping address if provided
    let shippingAddressId = null;
    if (shippingAddress) {
      shippingAddressId = uuidv4();
      await connection.execute(
        'INSERT INTO addresses (id, user_id, street, city, district, country) VALUES (?, ?, ?, ?, ?, ?)',
        [
          shippingAddressId,
          req.user.id,
          shippingAddress.street,
          shippingAddress.city,
          shippingAddress.district,
          shippingAddress.country || 'Uganda'
        ]
      );
    }

    // Create order
    const orderId = uuidv4();
    await connection.execute(
      'INSERT INTO orders (id, user_id, total, vat_amount, payment_method, shipping_address_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [orderId, req.user.id, total, vatAmount, paymentMethod, shippingAddressId, notes || null]
    );

    // Create order items and update stock
    for (const item of items) {
      const product = productMap.get(item.productId);
      
      // Create order item
      await connection.execute(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), orderId, item.productId, item.quantity, product.price]
      );

      // Update product stock
      await connection.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, item.productId]
      );
    }

    await connection.commit();

    // Get the created order with items
    const [newOrder] = await pool.execute(`
      SELECT o.*, a.street, a.city, a.district, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.id = ?
    `, [orderId]);

    const [orderItems] = await pool.execute(`
      SELECT oi.*, p.name, p.image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [orderId]);

    const order = newOrder[0];
    res.status(201).json({
      message: 'Order created successfully',
      order: {
        id: order.id,
        total: parseFloat(order.total),
        vatAmount: parseFloat(order.vat_amount),
        status: order.status,
        paymentMethod: order.payment_method,
        notes: order.notes,
        shippingAddress: order.street ? {
          street: order.street,
          city: order.city,
          district: order.district,
          country: order.country
        } : null,
        items: orderItems.map(item => ({
          id: item.id,
          productId: item.product_id,
          name: item.name,
          image: item.image,
          quantity: item.quantity,
          price: parseFloat(item.price)
        })),
        createdAt: order.created_at
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection.release();
  }
});

// Update order status (Admin only)
router.patch('/:id/status', authenticateToken, requireAdmin, [
  body('status').isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;
    const orderId = req.params.id;

    const [result] = await pool.execute(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, orderId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: 'Order status updated successfully' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all orders (Admin only)
router.get('/admin/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT o.*, u.first_name, u.last_name, u.email, a.street, a.city, a.district
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE o.status = ?';
      params.push(status);
    }

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [orders] = await pool.execute(query, params);

    res.json({
      orders: orders.map(order => ({
        id: order.id,
        customer: {
          name: `${order.first_name} ${order.last_name}`,
          email: order.email
        },
        total: parseFloat(order.total),
        vatAmount: parseFloat(order.vat_amount),
        status: order.status,
        paymentMethod: order.payment_method,
        shippingAddress: order.street ? {
          street: order.street,
          city: order.city,
          district: order.district
        } : null,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      }))
    });
  } catch (error) {
    console.error('Get admin orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;