require('dotenv').config();
const { Web3 } = require('web3');
const fs = require('fs');
const path = require('path');

async function deploy() {
    console.log('🚀 Deploying FreelancerEscrow contract...');

    const contractPath = path.join(__dirname, '..', 'build', 'FreelancerEscrow.json');
    if (!fs.existsSync(contractPath)) {
        console.error('❌ Contract not compiled. Run: npm run compile');
        process.exit(1);
    }

    const { abi, bytecode } = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const ganacheUrl = process.env.GANACHE_URL || 'http://127.0.0.1:7545';

    console.log(`   Connecting to Ganache at: ${ganacheUrl}`);

    const web3 = new Web3(ganacheUrl);

    try {
        const accounts = await web3.eth.getAccounts();
        if (accounts.length === 0) {
            console.error('❌ No accounts found. Make sure Ganache is running.');
            process.exit(1);
        }

        console.log(`   Deploying from account: ${accounts[0]}`);

        const contract = new web3.eth.Contract(abi);
        const deployed = await contract.deploy({ data: '0x' + bytecode })
            .send({
                from: accounts[0],
                gas: 6000000
            });

        const contractAddress = deployed.options.address;
        console.log('');
        console.log('✅ Contract deployed successfully!');
        console.log(`   Contract Address: ${contractAddress}`);
        console.log('');

        // Update .env file
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${contractAddress}`);
            fs.writeFileSync(envPath, envContent);
            console.log('   ✅ Updated .env with contract address');
        }

        console.log('');
        console.log('   Next steps:');
        console.log('   1. Start the server: npm start');
        console.log('   2. Open http://localhost:3000');

    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        console.error('   Make sure Ganache is running on', ganacheUrl);
        process.exit(1);
    }
}

deploy();
