const https = require('https');
require('dotenv').config({ path: '.env.local' });

// Test implementation of PowerSchoolAPI with programmatic login
class PowerSchoolAPI {
    constructor() {
        this.baseUrl = process.env.PSTEST_URI;
        this.username = process.env.PS_USER;
        this.password = process.env.PS_PASS;
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.sessionCheckInterval = 5 * 60 * 1000;
        this.cookies = new Map();
    }

    parseCookies(cookieHeaders) {
        if (!cookieHeaders) return;
        
        for (const cookie of cookieHeaders) {
            const [nameValue] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            if (name && value) {
                this.cookies.set(name.trim(), value.trim());
            }
        }
    }

    getCookieHeader() {
        if (this.cookies.size === 0) return '';
        
        const cookieStrings = [];
        for (const [name, value] of this.cookies) {
            cookieStrings.push(`${name}=${value}`);
        }
        return cookieStrings.join('; ');
    }

    async getLoginPage() {
        console.log('📄 Getting login page...');
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/pw.html',
            method: 'GET',
            headers: {
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0'
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                this.parseCookies(res.headers['set-cookie']);
                console.log(`   Status: ${res.statusCode}`);
                console.log(`   Cookies received: ${this.cookies.size}`);
                
                if (this.cookies.size > 0) {
                    console.log('   Cookie names:', Array.from(this.cookies.keys()).join(', '));
                }
                
                resolve();
            });

            req.on('error', reject);
            req.end();
        });
    }

    async submitLogin() {
        console.log('🔐 Submitting login credentials...');
        const postData = new URLSearchParams({
            username: this.username,
            password: this.password,
            ldappassword: this.password,
            request_locale: 'en_US'
        }).toString();

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/home.html',
            method: 'POST',
            headers: {
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Cookie': this.getCookieHeader(),
                'Referer': `${this.baseUrl}/admin/pw.html`
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                this.parseCookies(res.headers['set-cookie']);
                
                console.log(`   Status: ${res.statusCode}`);
                console.log(`   Total cookies after login: ${this.cookies.size}`);
                
                // Check for redirect (common after successful login)
                if (res.headers.location) {
                    console.log(`   Redirect to: ${res.headers.location}`);
                }
                
                if (res.statusCode === 200 || res.statusCode === 302) {
                    this.sessionValid = true;
                    this.lastSessionCheck = Date.now();
                    console.log('   ✅ Login appears successful!');
                    resolve(true);
                } else {
                    console.log('   ❌ Login may have failed');
                    resolve(false);
                }
            });

            req.on('error', reject);
            
            req.write(postData);
            req.end();
        });
    }

    async checkCustomizationPage() {
        console.log('🏠 Checking customization page access...');
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/customization/home.html',
            method: 'GET',
            headers: {
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Cookie': this.getCookieHeader(),
                'Referer': `${this.baseUrl}/admin/home.html`
            }
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                console.log(`   Status: ${res.statusCode}`);
                
                if (res.headers.location) {
                    console.log(`   Redirect to: ${res.headers.location}`);
                }
                
                if (res.statusCode === 200) {
                    console.log('   ✅ Customization page accessible!');
                    resolve(true);
                } else {
                    console.log('   ❌ Customization page not accessible');
                    resolve(false);
                }
            });

            req.on('error', (error) => {
                console.error('   Request error:', error.message);
                resolve(false);
            });

            req.end();
        });
    }

    async testTreeEndpoint() {
        console.log('🌳 Testing tree endpoint...');
        const queryParams = new URLSearchParams({
            path: '/',
            maxDepth: '1'
        });
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/tree?${queryParams.toString()}`,
            method: 'GET',
            headers: {
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Accept': 'application/json',
                'Cookie': this.getCookieHeader(),
                'Referer': `${this.baseUrl}/admin/customization/home.html`
            }
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log(`   Status: ${res.statusCode}`);
                    
                    try {
                        const response = JSON.parse(data);
                        if (response.message) {
                            console.log(`   Message: ${response.message}`);
                        }
                        if (response.folder) {
                            console.log(`   ✅ Success! Found root folder: "${response.folder.text}"`);
                            console.log(`   Subfolders: ${response.folder.subFolders ? response.folder.subFolders.length : 0}`);
                            console.log(`   Pages: ${response.folder.pages ? response.folder.pages.length : 0}`);
                        }
                        resolve(res.statusCode === 200 && response.folder);
                    } catch (error) {
                        console.log(`   ❌ Error parsing response: ${error.message}`);
                        console.log(`   Raw response (first 200 chars): ${data.substring(0, 200)}...`);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('   Request error:', error.message);
                resolve(false);
            });

            req.end();
        });
    }
}

async function testLoginSession() {
    console.log('='.repeat(70));
    console.log('🚀 PowerSchool Programmatic Login Test');
    console.log('='.repeat(70));
    console.log(`🌐 Base URL: ${process.env.PSTEST_URI}`);
    console.log(`👤 Username: ${process.env.PS_USER}`);
    console.log(`🔑 Password: ${process.env.PS_PASS ? '***' + process.env.PS_PASS.slice(-3) : 'NOT SET'}`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log();

    const api = new PowerSchoolAPI();

    if (!api.username || !api.password) {
        console.log('❌ FAILED: PS_USER or PS_PASS not set in environment');
        console.log('Please check your .env.local file');
        return;
    }

    let stepsPassed = 0;
    const totalSteps = 4;

    // Test 1: Get login page and cookies
    console.log('STEP 1/4: Getting login page and initial cookies');
    console.log('-'.repeat(60));
    
    try {
        await api.getLoginPage();
        console.log('✅ Login page accessed successfully\n');
        stepsPassed++;
    } catch (error) {
        console.log('❌ Failed to get login page:', error.message);
        return;
    }

    // Test 2: Submit login credentials
    console.log('STEP 2/4: Submitting login credentials');
    console.log('-'.repeat(60));
    
    try {
        const loginSuccess = await api.submitLogin();
        if (loginSuccess) {
            console.log('✅ Login submission successful\n');
            stepsPassed++;
        } else {
            console.log('❌ Login submission failed\n');
        }
    } catch (error) {
        console.log('❌ Login error:', error.message);
    }

    // Test 3: Check customization page access
    console.log('STEP 3/4: Checking customization page access');
    console.log('-'.repeat(60));
    
    try {
        const customizationSuccess = await api.checkCustomizationPage();
        if (customizationSuccess) {
            console.log('✅ Customization page accessible\n');
            stepsPassed++;
        } else {
            console.log('❌ Customization page not accessible\n');
        }
    } catch (error) {
        console.log('❌ Customization page error:', error.message);
    }

    // Test 4: Test tree endpoint with session
    console.log('STEP 4/4: Testing CPM tree endpoint');
    console.log('-'.repeat(60));
    
    try {
        const treeSuccess = await api.testTreeEndpoint();
        if (treeSuccess) {
            console.log('✅ Tree endpoint accessible - EXTENSION SHOULD WORK!\n');
            stepsPassed++;
        } else {
            console.log('❌ Tree endpoint still not accessible\n');
        }
    } catch (error) {
        console.log('❌ Tree endpoint error:', error.message);
    }

    // Summary
    console.log('='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Steps passed: ${stepsPassed}/${totalSteps}`);
    console.log(`🍪 Session cookies stored: ${api.cookies.size}`);
    
    if (api.cookies.size > 0) {
        console.log('📋 Cookie details:');
        for (const [name, value] of api.cookies) {
            console.log(`   ${name}: ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}`);
        }
    }
    
    console.log();
    if (stepsPassed === totalSteps) {
        console.log('🎉 ALL TESTS PASSED! Your VS Code extension should now work correctly.');
    } else if (stepsPassed >= 2) {
        console.log('⚠️  PARTIAL SUCCESS: Login worked but API access may be limited.');
    } else {
        console.log('❌ TESTS FAILED: Check your credentials and network connection.');
    }
    console.log('='.repeat(70));
}

// Run the test
testLoginSession().catch(console.error);