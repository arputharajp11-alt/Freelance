const nodemailer = require('nodemailer');

let transporter = null;

/**
 * Initialize email transporter
 */
async function initializeEmail() {
    try {
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            transporter = nodemailer.createTransport({
                host: process.env.EMAIL_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.EMAIL_PORT) || 587,
                secure: false,
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });
            await transporter.verify();
            console.log('✅ Email service connected');
        } else {
            // Create ethereal test account for development
            const testAccount = await nodemailer.createTestAccount();
            transporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass
                }
            });
            console.log('✅ Email service using Ethereal test account');
            console.log(`   📧 Test emails visible at: https://ethereal.email/login`);
            console.log(`   User: ${testAccount.user}`);
            console.log(`   Pass: ${testAccount.pass}`);
        }
    } catch (error) {
        console.log('⚠️  Email service not available - emails will be logged to console');
        transporter = null;
    }
}

/**
 * Send an email
 */
async function sendEmail(to, subject, html) {
    try {
        if (!transporter) {
            console.log(`📧 [EMAIL LOG] To: ${to} | Subject: ${subject}`);
            console.log(`   Body: ${html.substring(0, 200)}...`);
            return { messageId: 'logged-' + Date.now() };
        }

        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || 'FreelancerHub <noreply@freelancerhub.com>',
            to,
            subject,
            html
        });

        // Log ethereal preview URL
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
            console.log(`📧 Email preview: ${previewUrl}`);
        }

        return info;
    } catch (error) {
        console.error('Email send error:', error.message);
        return null;
    }
}

/**
 * Send verification email
 */
async function sendVerificationEmail(email, name, token) {
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/api/auth/verify/${token}`;
    const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0f1e; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #4f46e5, #06b6d4); padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; color: white;">🚀 FreelancerHub</h1>
            <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">Verify Your Email Address</p>
        </div>
        <div style="padding: 30px;">
            <p style="font-size: 16px;">Hello <strong>${name}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Welcome to FreelancerHub! Please verify your email address to get started.
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${verifyUrl}" style="background: linear-gradient(135deg, #4f46e5, #06b6d4); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
                    ✅ Verify Email
                </a>
            </div>
            <p style="font-size: 12px; color: #64748b; text-align: center;">
                This link expires in 24 hours. If you didn't create an account, please ignore this email.
            </p>
        </div>
    </div>`;

    return sendEmail(email, '🚀 Verify your FreelancerHub account', html);
}

/**
 * Send job notification to freelancers
 */
async function sendJobNotification(email, freelancerName, jobTitle, clientName, budget) {
    const jobsUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/jobs.html`;
    const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0f1e; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #4f46e5, #06b6d4); padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; color: white;">🚀 FreelancerHub</h1>
            <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">New Job Opportunity!</p>
        </div>
        <div style="padding: 30px;">
            <p style="font-size: 16px;">Hi <strong>${freelancerName}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #94a3b8;">
                A new job matching your skills has been posted!
            </p>
            <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #4f46e5;">
                <h3 style="margin: 0 0 8px; color: #e2e8f0;">${jobTitle}</h3>
                <p style="margin: 4px 0; color: #94a3b8; font-size: 14px;">👤 Posted by: ${clientName}</p>
                <p style="margin: 4px 0; color: #06b6d4; font-size: 14px; font-weight: 600;">💰 Budget: ${budget} ETH</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${jobsUrl}" style="background: linear-gradient(135deg, #4f46e5, #06b6d4); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
                    🔍 View Job Details
                </a>
            </div>
        </div>
    </div>`;

    return sendEmail(email, `🆕 New Job: ${jobTitle}`, html);
}

/**
 * Send project status update
 */
async function sendStatusUpdate(email, name, jobTitle, status, message) {
    const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0f1e; color: #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #4f46e5, #06b6d4); padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; color: white;">🚀 FreelancerHub</h1>
            <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">Project Update</p>
        </div>
        <div style="padding: 30px;">
            <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #94a3b8;">${message}</p>
            <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin: 20px 0;">
                <h3 style="margin: 0 0 8px; color: #e2e8f0;">📋 ${jobTitle}</h3>
                <p style="margin: 4px 0; color: #06b6d4; font-size: 14px;">Status: <strong>${status}</strong></p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard.html" style="background: linear-gradient(135deg, #4f46e5, #06b6d4); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
                    📊 Go to Dashboard
                </a>
            </div>
        </div>
    </div>`;

    return sendEmail(email, `📋 Project Update: ${jobTitle}`, html);
}

module.exports = {
    initializeEmail,
    sendEmail,
    sendVerificationEmail,
    sendJobNotification,
    sendStatusUpdate
};
