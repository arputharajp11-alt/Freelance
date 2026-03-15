const nodemailer = require('nodemailer');

const emailUser = 'arjuninfosolution0711@gmail.com';
const emailPass = 'oeqlgibeolxhrjwt';
const emailHost = 'smtp.gmail.com';
const emailPort = 587;

const transporter = nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: false, // true for 465, false for other ports
    auth: {
        user: emailUser,
        pass: emailPass,
    },
});

async function test() {
    console.log('Testing email connection...');
    try {
        await transporter.verify();
        console.log('✅ Connection successful!');
        
        // Try sending a test email to the user
        /*
        await transporter.sendMail({
            from: `"FreelancerHub Test" <${emailUser}>`,
            to: emailUser,
            subject: 'Test Email',
            text: 'It works!'
        });
        console.log('✅ Test email sent!');
        */
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
    }
}

test();
