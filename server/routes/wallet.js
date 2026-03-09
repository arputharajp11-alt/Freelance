const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/wallet  — Wallet summary + recent transactions
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        const userResult = await query(
            'SELECT id, full_name, role, total_earnings, total_spent, wallet_address FROM users WHERE id = $1',
            [userId]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userResult.rows[0];

        const txResult = await query(`
            SELECT wt.*, j.title as job_title
            FROM wallet_transactions wt
            LEFT JOIN jobs j ON wt.job_id = j.id
            WHERE wt.user_id = $1
            ORDER BY wt.created_at DESC
            LIMIT 50
        `, [userId]);

        const transactions = txResult.rows;

        const balance = transactions.reduce((acc, tx) => {
            if (tx.type === 'credit' || tx.type === 'deposit') return acc + parseFloat(tx.amount);
            if (tx.type === 'debit' || tx.type === 'withdrawal') return acc - parseFloat(tx.amount);
            return acc;
        }, 0);

        const totalCredits = transactions
            .filter(t => t.type === 'credit' || t.type === 'deposit')
            .reduce((s, t) => s + parseFloat(t.amount), 0);

        const totalDebits = transactions
            .filter(t => t.type === 'debit' || t.type === 'withdrawal')
            .reduce((s, t) => s + parseFloat(t.amount), 0);

        res.json({
            wallet: {
                balance: Math.max(0, balance),
                total_earned: parseFloat(user.total_earnings) || 0,
                total_spent: parseFloat(user.total_spent) || 0,
                total_credits: totalCredits,
                total_debits: totalDebits,
                pending_count: transactions.filter(t => t.status === 'pending').length,
                wallet_address: user.wallet_address || '',
                role: user.role
            },
            transactions
        });
    } catch (error) {
        console.error('Wallet fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch wallet data' });
    }
});

// GET /api/wallet/transactions — Paginated history
router.get('/transactions', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { type, page, limit: lim } = req.query;
        const limitNum = parseInt(lim) || 20;
        const pageNum = parseInt(page) || 1;
        const offset = (pageNum - 1) * limitNum;

        const params = [userId];
        let conditions = 'wt.user_id = $1';
        let idx = 2;

        if (type && type !== 'all') {
            conditions += ` AND wt.type = $${idx++}`;
            params.push(type);
        }

        params.push(limitNum, offset);
        const result = await query(`
            SELECT wt.*, j.title as job_title
            FROM wallet_transactions wt
            LEFT JOIN jobs j ON wt.job_id = j.id
            WHERE ${conditions}
            ORDER BY wt.created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, params);

        const countParams = [userId];
        let countCond = 'user_id = $1';
        if (type && type !== 'all') { countCond += ' AND type = $2'; countParams.push(type); }
        const countResult = await query(`SELECT COUNT(*) as total FROM wallet_transactions WHERE ${countCond}`, countParams);
        const total = parseInt(countResult.rows[0].total);

        res.json({
            transactions: result.rows,
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('Transactions fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// POST /api/wallet/withdraw
router.post('/withdraw', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { amount, wallet_address } = req.body;

        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal amount' });
        }
        const withdrawAmount = parseFloat(amount);

        // Calculate balance
        const txResult = await query(
            "SELECT type, amount FROM wallet_transactions WHERE user_id = $1 AND status = 'completed'",
            [userId]
        );
        const balance = txResult.rows.reduce((acc, tx) => {
            if (tx.type === 'credit' || tx.type === 'deposit') return acc + parseFloat(tx.amount);
            if (tx.type === 'debit' || tx.type === 'withdrawal') return acc - parseFloat(tx.amount);
            return acc;
        }, 0);

        if (withdrawAmount > balance) {
            return res.status(400).json({ error: `Insufficient balance. Available: ${balance.toFixed(4)} ETH` });
        }

        if (wallet_address) {
            await query('UPDATE users SET wallet_address = $1 WHERE id = $2', [wallet_address, userId]);
        }

        const result = await query(`
            INSERT INTO wallet_transactions (user_id, type, amount, description, status)
            VALUES ($1, 'withdrawal', $2, $3, 'pending')
            RETURNING id
        `, [userId, withdrawAmount, `Withdrawal of ${withdrawAmount} ETH to ${wallet_address || 'wallet'}`]);

        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, 'wallet', $2, $3, $4)
        `, [userId, 'Withdrawal Requested', `Your withdrawal of ${withdrawAmount} ETH is being processed.`, '/wallet.html']);

        res.json({
            message: `Withdrawal of ${withdrawAmount} ETH requested successfully!`,
            transaction_id: result.rows[0].id
        });
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ error: 'Failed to process withdrawal' });
    }
});

// POST /api/wallet/deposit
router.post('/deposit', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { amount, tx_hash } = req.body;

        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Invalid deposit amount' });
        }
        const depositAmount = parseFloat(amount);

        const result = await query(`
            INSERT INTO wallet_transactions (user_id, type, amount, description, tx_hash, status)
            VALUES ($1, 'deposit', $2, $3, $4, 'completed')
            RETURNING id
        `, [userId, depositAmount, `Deposit of ${depositAmount} ETH`, tx_hash || '']);

        await query(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES ($1, 'wallet', $2, $3, $4)
        `, [userId, 'Funds Deposited 💰', `${depositAmount} ETH has been added to your wallet.`, '/wallet.html']);

        res.json({
            message: `${depositAmount} ETH deposited successfully!`,
            transaction_id: result.rows[0].id
        });
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ error: 'Failed to process deposit' });
    }
});

// Internal helper: credit a user's wallet (used from jobs route)
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

module.exports = router;
module.exports.creditWallet = creditWallet;
