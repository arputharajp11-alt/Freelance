const path = require('path');
const fs = require('fs');
const solc = require('solc');

console.log('🔧 Compiling Solidity contracts...');

const contractPath = path.join(__dirname, '..', 'contracts', 'Escrow.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'Escrow.sol': {
            content: source
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['abi', 'evm.bytecode.object']
            }
        }
    }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

// Check for errors
if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    if (errors.length > 0) {
        console.error('❌ Compilation errors:');
        errors.forEach(e => console.error(e.formattedMessage));
        process.exit(1);
    }
    // Show warnings
    output.errors.filter(e => e.severity === 'warning').forEach(w => {
        console.warn('⚠️ ', w.formattedMessage.trim());
    });
}

// Build output directory
const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
}

// Extract contract
const contract = output.contracts['Escrow.sol']['FreelancerEscrow'];
const contractData = {
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object
};

const outputPath = path.join(buildDir, 'FreelancerEscrow.json');
fs.writeFileSync(outputPath, JSON.stringify(contractData, null, 2));

console.log('✅ Contract compiled successfully!');
console.log(`   Output: ${outputPath}`);
console.log(`   ABI methods: ${contract.abi.length}`);
