const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// POST /api/reviews - Post a review
router.post('/', authenticate, async (req, res) => {
    try {
        const { job_id, reviewee_id, rating, comment } = req.body;

        if (!job_id || !reviewee_id || !rating) {
            return res.status(400).json({ error: 'Job ID, Reviewee ID, and Rating (1-5) are required' });
        }

        // Verify job is completed
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1', [job_id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        const job = jobResult.rows[0];

        if (job.status !== 'completed') {
            return res.status(400).json({ error: 'Reviews can only be posted for completed jobs' });
        }

        // Verify user was part of the job
        if (req.user.id !== job.client_id && req.user.id !== job.freelancer_id) {
            return res.status(403).json({ error: 'You were not part of this job' });
        }

        // Check if already reviewed
        const existing = await query('SELECT id FROM reviews WHERE job_id = $1 AND reviewer_id = $2 AND reviewee_id = $3', [job_id, req.user.id, reviewee_id]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'You have already reviewed this user for this job' });
        }

        // Insert review
        await query(`
            INSERT INTO reviews (job_id, reviewer_id, reviewee_id, rating, comment)
            VALUES ($1, $2, $3, $4, $5)
        `, [job_id, req.user.id, reviewee_id, rating, comment || '']);

        // Update user's average rating
        const allReviews = await query('SELECT rating FROM reviews WHERE reviewee_id = $1', [reviewee_id]);
        const count = allReviews.rows.length;
        const sum = allReviews.rows.reduce((s, r) => s + r.rating, 0);
        const avg = sum / count;

        await query('UPDATE users SET rating = $1, total_reviews = $2 WHERE id = $3', [avg, count, reviewee_id]);

        // Notify reviewee
        const reviewerName = (await query('SELECT full_name FROM users WHERE id = $1', [req.user.id])).rows[0].full_name;
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, 'new_review', $2, $3, $4)
        `, [reviewee_id, `New Review Received`, `${reviewerName} gave you a ${rating}-star review for: ${job.title}`, `/profile.html`]);

        res.status(201).json({ message: 'Review posted successfully!', rating: avg });
    } catch (error) {
        console.error('Post review error:', error);
        res.status(500).json({ error: 'Failed to post review' });
    }
});

// GET /api/reviews/:userId - Get reviews for a user
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await query(`
            SELECT r.*, u.full_name as reviewer_name, u.avatar as reviewer_avatar
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            WHERE r.reviewee_id = $1
            ORDER BY r.created_at DESC
        `, [userId]);

        res.json({ reviews: result.rows });
    } catch (error) {
        console.error('Get reviews error:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

module.exports = router;
