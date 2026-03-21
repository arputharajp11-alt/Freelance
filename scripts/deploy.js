const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
    const GANACHE_URL = process.env.GANACHE_URL || 'http://127.0.0.1:7545';
    console.log(`📡 Connecting to Ganache at ${GANACHE_URL}...`);
    
    const provider = new ethers.JsonRpcProvider(GANACHE_URL);
    
    try {
        const network = await provider.getNetwork();
        console.log(`✅ Connected to network ${network.chainId}`);
    } catch (e) {
        console.error('❌ Could not connect to Ganache. Is it running?');
        process.exit(1);
    }

    const signer = await provider.getSigner(0);
    console.log(`👤 Deploying with account: ${await signer.getAddress()}`);

    const buildPath = path.join(__dirname, '..', 'build', 'FreelancerEscrow.json');
    const contractJson = JSON.parse(fs.readFileSync(buildPath, 'utf8'));

    console.log('🚀 Deploying FreelancerEscrow contract...');
    const factory = new ethers.ContractFactory(contractJson.abi, contractJson.bytecode, signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log(`✅ Contract deployed to: ${address}`);

    // Update .env file
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    if (envContent.includes('CONTRACT_ADDRESS=')) {
        envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${address}`);
    } else {
        envContent += `\nCONTRACT_ADDRESS=${address}`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('📝 Updated .env with new CONTRACT_ADDRESS');

    // Create a client-side config snippet if needed, but the backend serves it
}

main().catch(console.error);
