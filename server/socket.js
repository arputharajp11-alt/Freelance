const jwt = require('jsonwebtoken');
const { query } = require('./config/database');
const JWT_SECRET = process.env.JWT_SECRET || 'freelancer-hub-secret-key-dev-2024';

function initializeSocket(io) {
    const onlineUsers = new Map();

    // Async auth middleware for Socket.IO
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication required'));
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const result = await query(
                'SELECT id, full_name, avatar, role FROM users WHERE id = $1',
                [decoded.userId]
            );
            if (result.rows.length === 0) return next(new Error('User not found'));
            socket.user = result.rows[0];
            next();
        } catch (err) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', async (socket) => {
        const userId = socket.user.id;
        console.log(`🔌 User connected: ${socket.user.full_name} (ID: ${userId})`);

        onlineUsers.set(userId, socket.id);
        await query('UPDATE users SET is_online = 1 WHERE id = $1', [userId]).catch(() => { });

        socket.join(`user_${userId}`);
        io.emit('user_online', { userId, name: socket.user.full_name });

        // Join all conversation rooms
        try {
            const convResult = await query(
                'SELECT id FROM conversations WHERE user1_id = $1 OR user2_id = $2',
                [userId, userId]
            );
            convResult.rows.forEach(conv => socket.join(`conv_${conv.id}`));
        } catch (e) { /* non-critical */ }

        // Handle sending messages
        socket.on('send_message', async (data) => {
            try {
                const { conversation_id, receiver_id, message, message_type, job_id } = data;
                let convId = conversation_id;

                if (!convId) {
                    convId = job_id
                        ? `job_${job_id}_${Math.min(userId, receiver_id)}_${Math.max(userId, receiver_id)}`
                        : `direct_${Math.min(userId, receiver_id)}_${Math.max(userId, receiver_id)}`;

                    await query(`
                        INSERT INTO conversations (id, user1_id, user2_id, job_id)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (id) DO NOTHING
                    `, [convId, userId, receiver_id, job_id || null]);

                    socket.join(`conv_${convId}`);
                }

                const msgResult = await query(`
                    INSERT INTO messages (conversation_id, sender_id, receiver_id, job_id, message, message_type)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                `, [convId, userId, receiver_id, job_id || null, message, message_type || 'text']);

                await query(
                    'UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2',
                    [message.substring(0, 100), convId]
                );

                const saved = await query(`
                    SELECT m.*, u.full_name as sender_name, u.avatar as sender_avatar
                    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1
                `, [msgResult.rows[0].id]);

                io.to(`conv_${convId}`).emit('new_message', saved.rows[0]);
                io.to(`user_${receiver_id}`).emit('message_notification', {
                    conversationId: convId,
                    senderName: socket.user.full_name,
                    message: message.substring(0, 50)
                });
            } catch (error) {
                console.error('Socket send_message error:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        socket.on('join_conversation', async (conversationId) => {
            socket.join(`conv_${conversationId}`);
            await query(
                'UPDATE messages SET is_read = 1 WHERE conversation_id = $1 AND receiver_id = $2',
                [conversationId, userId]
            ).catch(() => { });
        });

        socket.on('typing', (data) => {
            io.to(`conv_${data.conversationId}`).emit('user_typing', {
                userId, name: socket.user.full_name, conversationId: data.conversationId
            });
        });

        socket.on('stop_typing', (data) => {
            io.to(`conv_${data.conversationId}`).emit('user_stop_typing', {
                userId, conversationId: data.conversationId
            });
        });

        socket.on('disconnect', async () => {
            console.log(`🔌 User disconnected: ${socket.user.full_name}`);
            onlineUsers.delete(userId);
            await query('UPDATE users SET is_online = 0, last_seen = NOW() WHERE id = $1', [userId]).catch(() => { });
            io.emit('user_offline', { userId });
        });
    });

    return io;
}

module.exports = { initializeSocket };
