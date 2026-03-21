
async function testFlow() {
    const API_URL = 'http://localhost:3000/api';

    async function apiRequest(endpoint, options = {}) {
        const resp = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || JSON.stringify(data));
        return data;
    }

    try {
        console.log('🚀 Starting Integration Test Flow...');

        // 1. Login as Client
        console.log('\n🔐 Logging in as Client...');
        const clientLogin = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: 'client@demo.com',
                password: 'demo123'
            })
        });
        const clientToken = clientLogin.token;
        console.log('✅ Client logged in');

        // 2. Client posts a job
        console.log('\n📝 Posting a new job...');
        const jobRes = await apiRequest('/jobs', {
            method: 'POST',
            body: JSON.stringify({
                title: 'Test Blockchain Project',
                description: 'This is a test project for blockchain integration',
                category: 'Blockchain',
                budget_min: 1,
                budget_max: 2,
                budget_type: 'fixed',
                skills_required: ['Solidity', 'Web3']
            }),
            headers: { Authorization: `Bearer ${clientToken}` }
        });
        const jobId = jobRes.job.id;
        console.log(`✅ Job posted (ID: ${jobId})`);

        // 3. Login as Freelancer
        console.log('\n🔐 Logging in as Freelancer...');
        const flLogin = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: 'freelancer@demo.com',
                password: 'demo123'
            })
        });
        const flToken = flLogin.token;
        const freelancerId = flLogin.user.id;
        console.log('✅ Freelancer logged in');

        // 4. Freelancer applies
        console.log('\n✏️ Submitting proposal...');
        await apiRequest(`/jobs/${jobId}/apply`, {
            method: 'POST',
            body: JSON.stringify({
                cover_letter: 'I am a pro testing AI.',
                proposed_amount: 1.5,
                estimated_duration: '1 week'
            }),
            headers: { Authorization: `Bearer ${flToken}` }
        });
        console.log('✅ Proposal submitted');

        // 5. Client hires freelancer
        console.log('\n🤝 Client hiring freelancer...');
        await apiRequest(`/jobs/${jobId}/hire/${freelancerId}`, {
            method: 'POST',
            body: JSON.stringify({
                blockchain_project_id: 123, // Mock ID
                escrow_tx_hash: '0xtest_hash_lock'
            }),
            headers: { Authorization: `Bearer ${clientToken}` }
        });
        console.log('✅ Freelancer hired');

        // 6. Freelancer submits work
        console.log('\n🚀 Freelancer submitting work...');
        await apiRequest(`/jobs/${jobId}/submit`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${flToken}` }
        });
        console.log('✅ Work submitted');

        // 7. Client approves and completes
        console.log('\n✅ Client approving and completing...');
        await apiRequest(`/jobs/${jobId}/complete`, {
            method: 'POST',
            body: JSON.stringify({
                tx_hash: '0xtest_hash_release'
            }),
            headers: { Authorization: `Bearer ${clientToken}` }
        });
        console.log('✅ Project completed!');

        console.log('\n🏆 ALL TESTS PASSED SUCCESSFULLY!');

    } catch (error) {
        console.error('\n❌ Test Flow Failed:');
        console.error(error.message);
        process.exit(1);
    }
}

testFlow();
