const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
  try {
    const [categories] = await pool.execute(
      'SELECT id, name, slug, description, created_at FROM categories ORDER BY name'
    );

    res.json({
      categories: categories.map(category => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        createdAt: category.created_at
      }))
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single category
router.get('/:id', async (req, res) => {
  try {
    const [categories] = await pool.execute(
      'SELECT id, name, slug, description, created_at FROM categories WHERE id = ? OR slug = ?',
      [req.params.id, req.params.id]
    );

    if (categories.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const category = categories[0];
    res.json({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      createdAt: category.created_at
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create category (Admin only)
router.post('/', authenticateToken, requireAdmin, [
  body('name').trim().isLength({ min: 1 }),
  body('slug').trim().isLength({ min: 1 }).matches(/^[a-z0-9-]+$/),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, slug, description } = req.body;

    // Check if slug exists
    const [existingCategories] = await pool.execute(
      'SELECT id FROM categories WHERE slug = ?',
      [slug]
    );

    if (existingCategories.length > 0) {
      return res.status(400).json({ error: 'Category slug already exists' });
    }

    const categoryId = uuidv4();
    await pool.execute(
      'INSERT INTO categories (id, name, slug, description) VALUES (?, ?, ?, ?)',
      [categoryId, name, slug, description || null]
    );

    res.status(201).json({
      message: 'Category created successfully',
      category: {
        id: categoryId,
        name,
        slug,
        description
      }
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update category (Admin only)
router.put('/:id', authenticateToken, requireAdmin, [
  body('name').optional().trim().isLength({ min: 1 }),
  body('slug').optional().trim().isLength({ min: 1 }).matches(/^[a-z0-9-]+$/),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, slug, description } = req.body;
    const categoryId = req.params.id;

    // Check if category exists
    const [existingCategories] = await pool.execute('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (existingCategories.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if new slug conflicts with existing one
    if (slug) {
      const [slugConflicts] = await pool.execute(
        'SELECT id FROM categories WHERE slug = ? AND id != ?',
        [slug, categoryId]
      );
      if (slugConflicts.length > 0) {
        return res.status(400).json({ error: 'Category slug already exists' });
      }
    }

    // Build update query
    const updateFields = [];
    const updateParams = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateParams.push(name);
    }
    if (slug !== undefined) {
      updateFields.push('slug = ?');
      updateParams.push(slug);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      updateParams.push(description);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateParams.push(categoryId);

    await pool.execute(
      `UPDATE categories SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Get updated category
    const [categories] = await pool.execute(
      'SELECT id, name, slug, description FROM categories WHERE id = ?',
      [categoryId]
    );

    res.json({
      message: 'Category updated successfully',
      category: categories[0]
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete category (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const categoryId = req.params.id;

    // Check if category has products
    const [products] = await pool.execute(
      'SELECT COUNT(*) as count FROM products WHERE category_id = ?',
      [categoryId]
    );

    if (products[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete category with existing products' 
      });
    }

    const [result] = await pool.execute('DELETE FROM categories WHERE id = ?', [categoryId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;