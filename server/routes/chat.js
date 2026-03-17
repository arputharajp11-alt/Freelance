const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/chat/conversations
router.get('/conversations', authenticate, async (req, res) => {
    try {
        const uid = req.user.id;
        const result = await query(`
            SELECT c.*,
                   j.title as job_title, j.status as job_status,
                   CASE WHEN c.user1_id = $1 THEN u2.full_name ELSE u1.full_name END as other_name,
                   CASE WHEN c.user1_id = $2 THEN u2.avatar ELSE u1.avatar END as other_avatar,
                   CASE WHEN c.user1_id = $3 THEN u2.id ELSE u1.id END as other_id,
                   CASE WHEN c.user1_id = $4 THEN u2.is_online ELSE u1.is_online END as other_online,
                   (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.receiver_id = $5 AND m.is_read = 0) as unread_count
            FROM conversations c
            JOIN users u1 ON c.user1_id = u1.id
            JOIN users u2 ON c.user2_id = u2.id
            LEFT JOIN jobs j ON c.job_id = j.id
            WHERE c.user1_id = $6 OR c.user2_id = $7
            ORDER BY c.last_message_at DESC
        `, [uid, uid, uid, uid, uid, uid, uid]);

        res.json({ conversations: result.rows });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// GET /api/chat/messages/:conversationId
router.get('/messages/:conversationId', authenticate, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { page, limit: lim } = req.query;
        const limitNum = parseInt(lim) || 50;
        const pageNum = parseInt(page) || 1;
        const offset = (pageNum - 1) * limitNum;

        // Verify user is part of this conversation
        const convResult = await query(
            'SELECT * FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $3)',
            [conversationId, req.user.id, req.user.id]
        );
        if (convResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not part of this conversation' });
        }

        const msgResult = await query(`
            SELECT m.*, u.full_name as sender_name, u.avatar as sender_avatar
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at DESC
            LIMIT $2 OFFSET $3
        `, [conversationId, limitNum, offset]);

        // Mark messages as read
        await query(
            'UPDATE messages SET is_read = 1 WHERE conversation_id = $1 AND receiver_id = $2 AND is_read = 0',
            [conversationId, req.user.id]
        );

        res.json({ messages: msgResult.rows.reverse(), conversation: convResult.rows[0] });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// POST /api/chat/messages - Send a message
router.post('/messages', authenticate, async (req, res) => {
    try {
        const { conversation_id, receiver_id, message, message_type, job_id } = req.body;

        if (!message || !receiver_id) {
            return res.status(400).json({ error: 'Message and receiver are required' });
        }

        let convId = conversation_id;

        // Create conversation if it doesn't exist
        if (!convId) {
            convId = job_id
                ? `job_${job_id}_${Math.min(req.user.id, receiver_id)}_${Math.max(req.user.id, receiver_id)}`
                : `direct_${Math.min(req.user.id, receiver_id)}_${Math.max(req.user.id, receiver_id)}`;

            await query(`
                INSERT INTO conversations (id, user1_id, user2_id, job_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING
            `, [convId, req.user.id, receiver_id, job_id || null]);
        }

        // Insert message
        const { file_url } = req.body;
        const msgResult = await query(`
            INSERT INTO messages (conversation_id, sender_id, receiver_id, job_id, message, message_type, file_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [convId, req.user.id, receiver_id, job_id || null, message, message_type || 'text', file_url || null]);

        // Update conversation last message
        await query(
            'UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2',
            [message.substring(0, 100), convId]
        );

        // Return the saved message
        const saved = await query(`
            SELECT m.*, u.full_name as sender_name, u.avatar as sender_avatar
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1
        `, [msgResult.rows[0].id]);

        res.status(201).json({ message: saved.rows[0], conversationId: convId });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// GET /api/chat/unread
// POST /api/chat/invite - Client invites freelancer to a job
router.post('/invite', authenticate, async (req, res) => {
    try {
        const { freelancer_id, job_id } = req.body;
        if (!freelancer_id || !job_id) {
            return res.status(400).json({ error: 'Freelancer ID and Job ID are required' });
        }

        // Verify sender is client
        if (req.user.role !== 'client') {
            return res.status(403).json({ error: 'Only clients can invite freelancers' });
        }

        // Verify job belongs to client
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND client_id = $2', [job_id, req.user.id]);
        if (jobResult.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or not yours' });
        }
        const job = jobResult.rows[0];

        const conversationId = `job_${job_id}_${Math.min(req.user.id, freelancer_id)}_${Math.max(req.user.id, freelancer_id)}`;

        // Create conversation
        await query(`
            INSERT INTO conversations (id, user1_id, user2_id, job_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO NOTHING
        `, [conversationId, req.user.id, freelancer_id, job_id]);

        // Send invitation message
        const message = `Hi! I'd like to invite you to collaborate on my project: "${job.title}". Please take a look and let me know if you're interested!`;
        
        const msgResult = await query(`
            INSERT INTO messages (conversation_id, sender_id, receiver_id, job_id, message, message_type)
            VALUES ($1, $2, $3, $4, $5, 'system')
            RETURNING id
        `, [conversationId, req.user.id, freelancer_id, job_id, message]);

        await query(
            'UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2',
            [message.substring(0, 100), conversationId]
        );

        // Notify freelancer
        const clientName = (await query('SELECT full_name FROM users WHERE id = $1', [req.user.id])).rows[0].full_name;
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, 'invitation', $2, $3, $4)
        `, [freelancer_id, `Invitation from ${clientName}`, `You were invited to: ${job.title}`, `/chat.html?conv=${conversationId}`]);

        res.json({ message: 'Invitation sent!', conversationId });
    } catch (error) {
        console.error('Invite error:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

router.get('/unread', authenticate, async (req, res) => {
    try {
        const result = await query(
            'SELECT COUNT(*) as total FROM messages WHERE receiver_id = $1 AND is_read = 0',
            [req.user.id]
        );
        res.json({ unread: parseInt(result.rows[0].total) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

module.exports = router;
