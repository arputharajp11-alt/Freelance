const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { sendJobNotification, sendStatusUpdate } = require('../services/email');
const { sendRealtimeNotification } = require('../socket');

// ─── Helper: credit wallet ────────────────────────────────────────────────
async function creditWallet(userId, amount, description, jobId = null, txHash = '') {
    try {
        await query(`
            INSERT INTO wallet_transactions (user_id, type, amount, description, job_id, tx_hash, status)
            VALUES ($1, 'credit', $2, $3, $4, $5, 'completed')
        `, [userId, amount, description, jobId, txHash]);
    } catch (err) {
        console.error('creditWallet error:', err);
    }
}

// ─── Static sub-routes MUST come before /:id ─────────────────────────────

// GET /api/jobs/my/posted - Client's posted jobs
router.get('/my/posted', authenticate, async (req, res) => {
    try {
        const result = await query(`
            SELECT j.*, u.full_name as freelancer_name, u.avatar as freelancer_avatar,
                   (SELECT COUNT(*) FROM proposals WHERE job_id = j.id) as proposal_count
            FROM jobs j
            LEFT JOIN users u ON j.freelancer_id = u.id
            WHERE j.client_id = $1
            ORDER BY j.created_at DESC
        `, [req.user.id]);

        res.json({ jobs: result.rows.map(j => ({ ...j, skills_required: JSON.parse(j.skills_required || '[]') })) });
    } catch (error) {
        console.error('Get posted jobs error:', error);
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

// GET /api/jobs/my/applied - Freelancer's applied jobs
router.get('/my/applied', authenticate, async (req, res) => {
    try {
        const result = await query(`
            SELECT j.*, p.status as proposal_status, p.proposed_amount, p.cover_letter,
                   u.full_name as client_name, u.avatar as client_avatar
            FROM proposals p
            JOIN jobs j ON p.job_id = j.id
            JOIN users u ON j.client_id = u.id
            WHERE p.freelancer_id = $1
            ORDER BY p.created_at DESC
        `, [req.user.id]);

        res.json({ jobs: result.rows.map(j => ({ ...j, skills_required: JSON.parse(j.skills_required || '[]') })) });
    } catch (error) {
        console.error('Get applied jobs error:', error);
        res.status(500).json({ error: 'Failed to fetch applied jobs' });
    }
});

// GET /api/jobs - List all jobs with filters
router.get('/', async (req, res) => {
    try {
        const { status, category, search, min_budget, max_budget, experience, page, limit: lim } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(lim) || 20;
        const offset = (pageNum - 1) * limitNum;

        const params = [];
        let conditions = '1=1';
        let idx = 1;

        if (status && status !== 'all') {
            conditions += ` AND j.status = $${idx++}`;
            params.push(status);
        } else {
            conditions += ` AND j.status != $${idx++}`;
            params.push('cancelled');
        }

        if (category) {
            conditions += ` AND j.category = $${idx++}`;
            params.push(category);
        }
        if (search) {
            conditions += ` AND (j.title ILIKE $${idx} OR j.description ILIKE $${idx})`;
            params.push(`%${search}%`);
            idx++;
        }
        if (min_budget) {
            conditions += ` AND j.budget_max >= $${idx++}`;
            params.push(parseFloat(min_budget));
        }
        if (max_budget) {
            conditions += ` AND j.budget_min <= $${idx++}`;
            params.push(parseFloat(max_budget));
        }
        if (experience) {
            conditions += ` AND j.experience_level = $${idx++}`;
            params.push(experience);
        }

        // Count query
        const countResult = await query(
            `SELECT COUNT(*) as total FROM jobs j WHERE ${conditions}`,
            [...params]
        );
        const total = parseInt(countResult.rows[0].total);

        // Data query
        params.push(limitNum, offset);
        const result = await query(`
            SELECT j.*, u.full_name as client_name, u.avatar as client_avatar, u.rating as client_rating,
                   (SELECT COUNT(*) FROM proposals WHERE job_id = j.id) as proposal_count
            FROM jobs j
            JOIN users u ON j.client_id = u.id
            WHERE ${conditions}
            ORDER BY j.created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, params);

        const parsedJobs = result.rows.map(job => ({
            ...job,
            skills_required: JSON.parse(job.skills_required || '[]'),
            attachments: JSON.parse(job.attachments || '[]')
        }));

        res.json({
            jobs: parsedJobs,
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('List jobs error:', error);
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

// GET /api/jobs/:id - Get job details
router.get('/:id', async (req, res) => {
    try {
        const jobResult = await query(`
            SELECT j.*, u.full_name as client_name, u.avatar as client_avatar, u.rating as client_rating, u.email as client_email,
                   f.full_name as freelancer_name, f.avatar as freelancer_avatar, f.rating as freelancer_rating
            FROM jobs j
            JOIN users u ON j.client_id = u.id
            LEFT JOIN users f ON j.freelancer_id = f.id
            WHERE j.id = $1
        `, [req.params.id]);

        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

        const job = jobResult.rows[0];

        const proposalsResult = await query(`
            SELECT p.*, u.full_name, u.avatar, u.rating, u.skills, u.bio, u.total_reviews
            FROM proposals p
            JOIN users u ON p.freelancer_id = u.id
            WHERE p.job_id = $1
            ORDER BY p.created_at DESC
        `, [req.params.id]);

        const proposals = proposalsResult.rows.map(p => ({
            ...p,
            skills: JSON.parse(p.skills || '[]')
        }));

        res.json({
            job: {
                ...job,
                skills_required: JSON.parse(job.skills_required || '[]'),
                attachments: JSON.parse(job.attachments || '[]')
            },
            proposals
        });
    } catch (error) {
        console.error('Get job error:', error);
        res.status(500).json({ error: 'Failed to fetch job details' });
    }
});

// POST /api/jobs - Create a new job
router.post('/', authenticate, authorize('client'), async (req, res) => {
    try {
        const { title, description, category, skills_required, budget_min, budget_max, budget_type, duration, experience_level, deadline } = req.body;

        if (!title || !description || !category) {
            return res.status(400).json({ error: 'Title, description, and category are required' });
        }

        const result = await query(`
            INSERT INTO jobs (client_id, title, description, category, skills_required, budget_min, budget_max, budget_type, duration, experience_level, deadline)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            req.user.id, title, description, category,
            JSON.stringify(skills_required || []),
            budget_min || 0, budget_max || 0,
            budget_type || 'fixed',
            duration || '',
            experience_level || 'intermediate',
            deadline || null
        ]);

        const job = result.rows[0];

        // Notify verified freelancers (non-blocking)
        const clientRow = await query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);
        const clientName = clientRow.rows[0]?.full_name || 'A client';

        query("SELECT email, full_name, id FROM users WHERE role = 'freelancer' AND is_verified = 1 LIMIT 50")
            .then(async ({ rows: freelancers }) => {
                for (const fl of freelancers) {
                    sendJobNotification(fl.email, fl.full_name, title, clientName, `${budget_min || 0}-${budget_max || 0}`)
                        .catch(() => { });
                    await query(`
                        INSERT INTO notifications (user_id, type, title, message, link)
                        VALUES ($1, 'new_job', $2, $3, $4)
                    `, [fl.id, `New Job: ${title}`, `${clientName} posted a new job`, `/job-detail.html?id=${job.id}`]);
                }
            })
            .catch(console.error);

        res.status(201).json({
            message: 'Job posted successfully!',
            job: { ...job, skills_required: JSON.parse(job.skills_required || '[]') }
        });
    } catch (error) {
        console.error('Create job error:', error);
        res.status(500).json({ error: 'Failed to create job' });
    }
});

// POST /api/jobs/:id/apply - Freelancer applies to a job
router.post('/:id/apply', authenticate, authorize('freelancer'), async (req, res) => {
    try {
        const { cover_letter, proposed_amount, estimated_duration } = req.body;
        const jobId = req.params.id;

        if (!cover_letter || !proposed_amount) {
            return res.status(400).json({ error: 'Cover letter and proposed amount are required' });
        }

        const jobResult = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        const job = jobResult.rows[0];
        if (job.status !== 'open') return res.status(400).json({ error: 'Job is no longer accepting proposals' });

        const existing = await query(
            'SELECT id FROM proposals WHERE job_id = $1 AND freelancer_id = $2', [jobId, req.user.id]
        );
        if (existing.rows.length > 0) return res.status(400).json({ error: 'You already applied to this job' });

        await query(`
            INSERT INTO proposals (job_id, freelancer_id, cover_letter, proposed_amount, estimated_duration)
            VALUES ($1, $2, $3, $4, $5)
        `, [jobId, req.user.id, cover_letter, proposed_amount, estimated_duration || '']);

        // Notify client
        const clientRow = await query('SELECT email, full_name FROM users WHERE id = $1', [job.client_id]);
        const freelancerRow = await query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);
        const client = clientRow.rows[0];
        const freelancer = freelancerRow.rows[0];

        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, 'new_proposal', $2, $3, $4)
        `, [job.client_id, `New proposal on: ${job.title}`, `${freelancer.full_name} submitted a proposal`, `/job-detail.html?id=${jobId}`]);

        sendStatusUpdate(client.email, client.full_name, job.title, 'New Proposal',
            `${freelancer.full_name} has submitted a proposal for your project.`).catch(() => { });

        res.status(201).json({ message: 'Proposal submitted successfully!' });
    } catch (error) {
        console.error('Apply error:', error);
        res.status(500).json({ error: 'Failed to submit proposal' });
    }
});

// POST /api/jobs/:id/hire/:freelancerId - Client hires a freelancer
router.post('/:id/hire/:freelancerId', authenticate, authorize('client'), async (req, res) => {
    try {
        const { id: jobId, freelancerId } = req.params;
        const { blockchain_project_id, escrow_tx_hash, escrow_amount } = req.body;

        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND client_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
        const job = jobResult.rows[0];
        if (job.status !== 'open') return res.status(400).json({ error: 'Job is no longer open' });

        const flResult = await query("SELECT id FROM users WHERE id = $1 AND role = 'freelancer'", [freelancerId]);
        if (flResult.rows.length === 0) return res.status(404).json({ error: 'Freelancer not found' });

        await query(`
            UPDATE jobs SET
                freelancer_id = $1, status = 'in_progress',
                blockchain_project_id = $2, escrow_tx_hash = $3, escrow_amount = $4,
                updated_at = NOW()
            WHERE id = $5
        `, [parseInt(freelancerId), blockchain_project_id || null, escrow_tx_hash || '', escrow_amount || 0, jobId]);

        await query("UPDATE proposals SET status = 'accepted' WHERE job_id = $1 AND freelancer_id = $2", [jobId, freelancerId]);
        await query("UPDATE proposals SET status = 'rejected' WHERE job_id = $1 AND freelancer_id != $2", [jobId, freelancerId]);

        // Create conversation
        const conversationId = `job_${jobId}_${Math.min(req.user.id, parseInt(freelancerId))}_${Math.max(req.user.id, parseInt(freelancerId))}`;
        await query(`
            INSERT INTO conversations (id, user1_id, user2_id, job_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO NOTHING
        `, [conversationId, req.user.id, parseInt(freelancerId), parseInt(jobId)]);

        // Notify freelancer
        const notifData = {
            type: 'hired',
            title: `You've been hired!`,
            message: `You've been hired for: ${job.title}`,
            link: `/dashboard.html`
        };
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, $2, $3, $4, $5)
        `, [parseInt(freelancerId), notifData.type, notifData.title, notifData.message, notifData.link]);

        sendRealtimeNotification(parseInt(freelancerId), notifData);

        sendStatusUpdate(freelancer.email, freelancer.full_name, job.title, 'Hired',
            'Congratulations! You have been hired for this project.').catch(() => { });

        if (escrow_tx_hash) {
            await query(`
                INSERT INTO transactions (job_id, tx_hash, from_address, amount, tx_type, status)
                VALUES ($1, $2, $3, $4, 'escrow_lock', 'confirmed')
            `, [jobId, escrow_tx_hash, req.user.wallet_address || '', escrow_amount || 0]);
        }

        res.json({ message: 'Freelancer hired successfully!', conversationId });
    } catch (error) {
        console.error('Hire error:', error);
        res.status(500).json({ error: 'Failed to hire freelancer' });
    }
});

// POST /api/jobs/:id/submit - Freelancer submits work
router.post('/:id/submit', authenticate, authorize('freelancer'), async (req, res) => {
    try {
        const jobId = req.params.id;
        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND freelancer_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or you are not the assigned freelancer' });
        const job = jobResult.rows[0];
        if (job.status !== 'in_progress') return res.status(400).json({ error: 'Job is not in progress' });

        await query("UPDATE jobs SET status = 'submitted', updated_at = NOW() WHERE id = $1", [jobId]);

        const notifData = {
            type: 'work_submitted',
            title: 'Work Submitted',
            message: `Freelancer submitted work for: ${job.title}`,
            link: `/job-detail.html?id=${jobId}`
        };
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, $2, $3, $4, $5)
        `, [job.client_id, notifData.type, notifData.title, notifData.message, notifData.link]);

        sendRealtimeNotification(job.client_id, notifData);

        sendStatusUpdate(client.email, client.full_name, job.title, 'Work Submitted',
            'The freelancer has submitted their work for review.').catch(() => { });

        res.json({ message: 'Work submitted successfully!' });
    } catch (error) {
        console.error('Submit error:', error);
        res.status(500).json({ error: 'Failed to submit work' });
    }
});

// POST /api/jobs/:id/complete - Client approves and releases payment
router.post('/:id/complete', authenticate, authorize('client'), async (req, res) => {
    try {
        const jobId = req.params.id;
        const { tx_hash } = req.body;

        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND client_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
        const job = jobResult.rows[0];
        if (job.status !== 'submitted') return res.status(400).json({ error: 'Work has not been submitted yet' });

        await query("UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = $1", [jobId]);

        if (job.escrow_amount > 0) {
            await query('UPDATE users SET total_earnings = total_earnings + $1 WHERE id = $2', [job.escrow_amount, job.freelancer_id]);
            await query('UPDATE users SET total_spent = total_spent + $1 WHERE id = $2', [job.escrow_amount, job.client_id]);
            await creditWallet(job.freelancer_id, job.escrow_amount, `Payment for: ${job.title}`, parseInt(jobId), tx_hash || '');
        }

        const freelancer = (await query('SELECT email, full_name, wallet_address FROM users WHERE id = $1', [job.freelancer_id])).rows[0];

        if (tx_hash) {
            await query(`
                INSERT INTO transactions (job_id, tx_hash, from_address, to_address, amount, tx_type, status)
                VALUES ($1, $2, $3, $4, $5, 'escrow_release', 'confirmed')
            `, [jobId, tx_hash, req.user.wallet_address || 'escrow', freelancer.wallet_address || '', job.escrow_amount || 0]);
        }

        const notifData = {
            type: 'payment_released',
            title: 'Payment Released! 🎉',
            message: `Payment released for: ${job.title}`,
            link: `/dashboard.html`
        };
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, $2, $3, $4, $5)
        `, [job.freelancer_id, notifData.type, notifData.title, notifData.message, notifData.link]);

        sendRealtimeNotification(job.freelancer_id, notifData);

        sendStatusUpdate(freelancer.email, freelancer.full_name, job.title, 'Completed & Paid',
            `Congratulations! The client approved your work and ${job.escrow_amount} ETH has been released to your wallet.`).catch(() => { });

        res.json({ message: 'Project completed! Payment released to freelancer.' });
    } catch (error) {
        console.error('Complete error:', error);
        res.status(500).json({ error: 'Failed to complete project' });
    }
});

// POST /api/jobs/:id/dispute
router.post('/:id/dispute', authenticate, authorize('client'), async (req, res) => {
    try {
        const jobId = req.params.id;
        const { reason } = req.body;

        const jobResult = await query('SELECT * FROM jobs WHERE id = $1 AND client_id = $2', [jobId, req.user.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
        const job = jobResult.rows[0];
        if (job.status !== 'submitted') return res.status(400).json({ error: 'Can only dispute submitted work' });

        await query("UPDATE jobs SET status = 'disputed', updated_at = NOW() WHERE id = $1", [jobId]);

        const freelancer = (await query('SELECT email, full_name FROM users WHERE id = $1', [job.freelancer_id])).rows[0];
        const notifData = {
            type: 'dispute',
            title: 'Dispute Raised',
            message: `Client raised a dispute for: ${job.title}. Reason: ${reason || 'Not specified'}`,
            link: `/dashboard.html`
        };
        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, $2, $3, $4, $5)
        `, [job.freelancer_id, notifData.type, notifData.title, notifData.message, notifData.link]);

        sendRealtimeNotification(job.freelancer_id, notifData);

        sendStatusUpdate(freelancer.email, freelancer.full_name, job.title, 'Disputed',
            `The client has raised a dispute. Reason: ${reason || 'Not specified'}`).catch(() => { });

        res.json({ message: 'Dispute raised. Our team will review the case.' });
    } catch (error) {
        console.error('Dispute error:', error);
        res.status(500).json({ error: 'Failed to raise dispute' });
    }
});

module.exports = router;
module.exports.creditWallet = creditWallet;
