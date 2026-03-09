const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// GET /api/blockchain/contract - Get compiled contract ABI
router.get('/contract', (req, res) => {
    try {
        const contractPath = path.join(__dirname, '..', '..', 'build', 'FreelancerEscrow.json');
        if (!fs.existsSync(contractPath)) {
            return res.status(404).json({
                error: 'Contract not compiled yet. Run: npm run compile',
                instructions: 'Make sure to compile and deploy the contract first'
            });
        }
        const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
        res.json(contract);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load contract' });
    }
});

// GET /api/blockchain/status - Get blockchain connection status
router.get('/status', (req, res) => {
    res.json({
        ganache_url: process.env.GANACHE_URL || 'http://127.0.0.1:7545',
        contract_address: process.env.CONTRACT_ADDRESS || 'Not deployed',
        network: 'Ganache Local Testnet'
    });
});

module.exports = router;
