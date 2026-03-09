const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// PUT /api/notifications/read-all  (MUST be before /:id)
router.put('/read-all', authenticate, async (req, res) => {
    try {
        await query('UPDATE notifications SET is_read = 1 WHERE user_id = $1', [req.user.id]);
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

// GET /api/notifications
router.get('/', authenticate, async (req, res) => {
    try {
        const { page, limit: lim, unread_only } = req.query;
        const limitNum = parseInt(lim) || 20;
        const pageNum = parseInt(page) || 1;
        const offset = (pageNum - 1) * limitNum;

        const params = [req.user.id];
        let conditions = 'user_id = $1';
        let idx = 2;

        if (unread_only === 'true') {
            conditions += ` AND is_read = 0`;
        }

        params.push(limitNum, offset);
        const result = await query(
            `SELECT * FROM notifications WHERE ${conditions} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
            params
        );

        const countResult = await query(
            'SELECT COUNT(*) as total FROM notifications WHERE user_id = $1 AND is_read = 0',
            [req.user.id]
        );

        res.json({ notifications: result.rows, unread_total: parseInt(countResult.rows[0].total) });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, async (req, res) => {
    try {
        const result = await query(
            'UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

module.exports = router;
