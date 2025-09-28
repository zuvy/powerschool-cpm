const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const https = require('https');

require('dotenv').config({ path: '.env.local' });

// Helper function to find first difference between two strings
function findFirstDifference(str1, str2) {
    const minLength = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLength; i++) {
        if (str1[i] !== str2[i]) {
            return i;
        }
    }
    return minLength; // Strings are identical up to the shorter length
}

// Helper function to generate multipart form data
function generateMultipartData(fields, boundary) {
    let data = '';
    for (const [name, value] of Object.entries(fields)) {
        data += `--${boundary}\r\n`;
        data += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
        data += `${value}\r\n`;
    }
    data += `--${boundary}--\r\n`;
    return data;
}

// File templates for different PowerSchool page types
const FILE_TEMPLATES = {
    adminStudentPage: {
        name: 'Admin Student Page',
        extension: '.html',
        content: `<!--
TemplateName:Admin Student Page
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Page</title>
<!-- required scripts -->
	~[wc:commonscripts] 
<!-- Required style sheets: screen.css, and print.css -->
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
</head> 
<body> 
	~[wc:admin_header_frame_css]
	<!-- breadcrumb start -->
		<a href="/admin/home.html" target="_top">Start Page</a> &gt; <a href="/admin/students/home.html?selectstudent=nosearch" target="_top">Student Selection</a> &gt; New Page
	<!-- breadcrumb end -->
~[wc:admin_navigation_frame_css]
<!-- start of main menu and content -->
~[wc:title_student_begin_css]New Page~[wc:title_student_end_css]
<form action="/~[self.page]?frn=~(studentfrn)&changesSaved=true" method="POST">
<!-- start of content area -->
~[if.~(gpv.changesSaved)=true]<div class="feedback-confirm">~[text:psx.common.changes_recorded]</div>[/if]
	<div class="box-round">
		 <h2>Section Title Text Goes Here</h2>
		 <p>
		 	Your paragraph text goes here.
		 </p>
        <div class="button-row"><input type="hidden" name="ac" value="prim">~[submitbutton]</div>
	</div>
</form>
<!-- end of content area -->
	~[wc:admin_footer_frame_css]
</body> 
</html>`
    },
    adminGeneralPage: {
        name: 'Admin General Page',
        extension: '.html',
        content: `<!--
TemplateName:Admin General Page
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Admin Page</title>
<!-- required scripts -->
	~[wc:commonscripts] 
<!-- Required style sheets: screen.css, and print.css -->
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
</head> 
<body> 
	~[wc:admin_header_frame_css]
	<!-- breadcrumb start -->
		<a href="/admin/home.html" target="_top">Start Page</a> &gt; New Admin Page
	<!-- breadcrumb end -->
~[wc:admin_navigation_frame_css]
<!-- start of main menu and content -->
~[wc:title_bar_begin_css]New Admin Page~[wc:title_bar_end_css]
<form action="/~[self.page]?changesSaved=true" method="POST">
<!-- start of content area -->
~[if.~(gpv.changesSaved)=true]<div class="feedback-confirm">~[text:psx.common.changes_recorded]</div>[/if]
	<div class="box-round">
		 <h2>Admin Page Content</h2>
		 <p>
		 	Your admin page content goes here.
		 </p>
        <div class="button-row"><input type="hidden" name="ac" value="prim">~[submitbutton]</div>
	</div>
</form>
<!-- end of content area -->
	~[wc:admin_footer_frame_css]
</body> 
</html>`
    },
    publicPage: {
        name: 'Public Page',
        extension: '.html',
        content: `<!--
TemplateName:Public Page
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Public Page</title>
<!-- Required style sheets: screen.css, and print.css -->
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
    ~[wc:commonscripts]
</head> 
<body> 
	~[wc:public_header_frame_css]
<!-- start of main content -->
	<div class="box-round">
		 <h1>New Public Page</h1>
		 <p>
		 	Your public page content goes here.
		 </p>
	</div>
<!-- end of main content -->
	~[wc:public_footer_frame_css]
</body> 
</html>`
    },
    javascript: {
        name: 'JavaScript File',
        extension: '.js',
        content: `// PowerSchool Custom JavaScript
// Created: ${new Date().toISOString().split('T')[0]}

(function() {
    'use strict';
    
    // Your JavaScript code goes here
    console.log('PowerSchool custom script loaded');
    
    // Example: Wait for DOM ready
    $(document).ready(function() {
        // DOM manipulation code here
    });
    
})();`
    },
    css: {
        name: 'CSS Stylesheet',
        extension: '.css',
        content: `/* PowerSchool Custom CSS
 * Created: ${new Date().toISOString().split('T')[0]}
 */

/* Custom styles go here */

.custom-style {
    /* Your custom styles */
}

/* Responsive design */
@media (max-width: 768px) {
    /* Mobile styles */
}`
    }
};

class PowerSchoolTreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, resourceUri, contextValue, remotePath, psApi, localRootPath) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.contextValue = contextValue;
        this.remotePath = remotePath;
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        
        if (contextValue === 'file') {
            this.command = {
                command: 'powerschool-cpm.downloadFile',
                title: 'Download File',
                arguments: [this]
            };
            this.iconPath = this.getFileIcon();
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
        
        this.tooltip = contextValue === 'file' ? 
            `${label}\nClick to download from PowerSchool` :
            `${label} folder`;
    }
    
    getFileIcon() {
        const localPath = path.join(this.localRootPath, this.remotePath.replace(/^\/+/g, ''));
        const exists = fs.existsSync(localPath);
        
        if (exists) {
            return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.green'));
        } else {
            return new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
        }
    }
}

class PowerSchoolTreeProvider {
    constructor(psApi, localRootPath) {
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.treeCache = new Map();
    }
    
    refresh() {
        this.treeCache.clear();
        this._onDidChangeTreeData.fire();
    }
    
    getTreeItem(element) {
        return element;
    }
    
    async getChildren(element) {
        try {
            if (!element) {
                console.log('📡 Loading PowerSchool file tree...');
                const rootTree = await this.psApi.getFolderTree('/', 1);
                
                if (rootTree.folder) {
                    return this.createTreeItems(rootTree.folder, '/');
                }
                return [];
            } else if (element.contextValue === 'folder') {
                const cacheKey = element.remotePath;
                
                if (this.treeCache.has(cacheKey)) {
                    return this.treeCache.get(cacheKey);
                }
                
                console.log(`📂 Loading folder: ${element.remotePath}`);
                const folderTree = await this.psApi.getFolderTree(element.remotePath, 1);
                
                if (folderTree.folder) {
                    const items = this.createTreeItems(folderTree.folder, element.remotePath);
                    this.treeCache.set(cacheKey, items);
                    return items;
                }
                return [];
            }
            return [];
        } catch (error) {
            console.error('Error loading tree data:', error);
            vscode.window.showErrorMessage(`Failed to load PowerSchool data: ${error.message}`);
            return [];
        }
    }
    
    createTreeItems(folderData, currentPath) {
        const items = [];
        
        // Sort subfolders alphabetically and add to items
        if (folderData.subFolders) {
            const sortedSubfolders = [...folderData.subFolders].sort((a, b) => 
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );
            
            for (const subfolder of sortedSubfolders) {
                const folderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                const item = new PowerSchoolTreeItem(
                    subfolder.text,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    null,
                    'folder',
                    folderPath,
                    this.psApi,
                    this.localRootPath
                );
                items.push(item);
            }
        }
        
        // Sort pages alphabetically and add to items
        if (folderData.pages) {
            const sortedPages = [...folderData.pages].sort((a, b) => 
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );
            
            for (const page of sortedPages) {
                const filePath = currentPath === '/' ? `/${page.text}` : `${currentPath}/${page.text}`;
                const item = new PowerSchoolTreeItem(
                    page.text,
                    vscode.TreeItemCollapsibleState.None,
                    null,
                    'file',
                    filePath,
                    this.psApi,
                    this.localRootPath
                );
                items.push(item);
            }
        }
        
        return items;
    }
    
    async downloadFile(treeItem) {
        try {
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            
            const localDir = path.dirname(localFilePath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            
            console.log(`📥 Downloading: ${treeItem.remotePath}`);
            vscode.window.showInformationMessage(`Downloading ${treeItem.label}...`);
            
            const fileContent = await this.downloadFileContent(treeItem.remotePath);
            fs.writeFileSync(localFilePath, fileContent);
            
            console.log(`✅ Downloaded: ${treeItem.remotePath}`);
            vscode.window.showInformationMessage(`Downloaded ${treeItem.label} successfully!`);
            
            this._onDidChangeTreeData.fire(treeItem);
            
            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);
            
            return { success: true };
        } catch (error) {
            console.error(`❌ Failed to download ${treeItem.remotePath}:`, error);
            vscode.window.showErrorMessage(`Failed to download ${treeItem.label}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    async downloadFileContent(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        await this.psApi.ensureAuthenticated();
        
        const options = {
            hostname: new URL(this.psApi.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/builtintext?${queryParams.toString()}`,
            method: 'GET',
            headers: {
                'Referer': `${this.psApi.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Cookie': this.psApi.getCookieHeader()
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200) {
                            const content = response.activeCustomText || response.builtInText || '';
                            resolve(content);
                        } else {
                            reject(new Error(`Failed to download file: ${response.message || data}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async publishFile(treeItem) {
        try {
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            
            if (!fs.existsSync(localFilePath)) {
                vscode.window.showErrorMessage(`Local file not found: ${treeItem.label}. Please download it first.`);
                return { success: false, message: 'File not found locally' };
            }
            
            console.log(`📤 Publishing: ${treeItem.remotePath}`);
            vscode.window.showInformationMessage(`Publishing ${treeItem.label} to PowerSchool...`);
            
            const fileContent = fs.readFileSync(localFilePath, 'utf8');
            console.log(`📄 Local file content (${fileContent.length} chars): ${fileContent.substring(0, 200)}...`);
            
            // Upload the file
            const uploadResult = await this.psApi.uploadFileContent(treeItem.remotePath, fileContent);
            
            // Verify the upload by re-downloading
            vscode.window.showInformationMessage(`Verifying upload of ${treeItem.label}...`);
            const verifiedContent = await this.psApi.verifyUpload(treeItem.remotePath);
            
            // Compare content
            const uploadSuccessful = fileContent === verifiedContent;
            
            if (uploadSuccessful) {
                console.log(`✅ Published and verified: ${treeItem.remotePath}`);
                vscode.window.showInformationMessage(`Published ${treeItem.label} successfully! Content verified.`);
            } else {
                console.log(`⚠️  Upload completed but verification shows different content`);
                console.log(`   Original length: ${fileContent.length}`);
                console.log(`   Verified length: ${verifiedContent.length}`);
                console.log(`   First difference at char: ${findFirstDifference(fileContent, verifiedContent)}`);
                vscode.window.showWarningMessage(`Published ${treeItem.label} but content verification failed. Check console for details.`);
            }
            
            return { success: true, verified: uploadSuccessful, uploadResult };
        } catch (error) {
            console.error(`❌ Failed to publish ${treeItem.remotePath}:`, error);
            vscode.window.showErrorMessage(`Failed to publish ${treeItem.label}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    async publishCurrentFile() {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active file to publish.');
                return { success: false, message: 'No active file' };
            }
            
            const filePath = activeEditor.document.fileName;
            const relativePath = path.relative(this.localRootPath, filePath);
            
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showWarningMessage('File is not in the PowerSchool workspace. Only files downloaded from PowerSchool can be published.');
                return { success: false, message: 'File not in workspace' };
            }
            
            // Convert local path to PowerSchool path format
            const remotePath = '/' + relativePath.replace(/\\/g, '/');
            
            console.log(`📤 Publishing current file: ${remotePath}`);
            vscode.window.showInformationMessage(`Publishing ${path.basename(filePath)} to PowerSchool...`);
            
            // Save the file first if it has unsaved changes
            if (activeEditor.document.isDirty) {
                await activeEditor.document.save();
            }
            
            const fileContent = fs.readFileSync(filePath, 'utf8');
            console.log(`📄 Publishing file content (${fileContent.length} chars): ${fileContent.substring(0, 200)}...`);
            
            // Upload the file
            const uploadResult = await this.psApi.uploadFileContent(remotePath, fileContent);
            
            // Verify the upload
            vscode.window.showInformationMessage(`Verifying upload of ${path.basename(filePath)}...`);
            const verifiedContent = await this.psApi.verifyUpload(remotePath);
            
            // Compare content
            const uploadSuccessful = fileContent === verifiedContent;
            
            if (uploadSuccessful) {
                console.log(`✅ Published and verified: ${remotePath}`);
                vscode.window.showInformationMessage(`Published ${path.basename(filePath)} successfully! Content verified.`);
            } else {
                console.log(`⚠️  Upload completed but verification shows different content`);
                console.log(`   Original length: ${fileContent.length}`);
                console.log(`   Verified length: ${verifiedContent.length}`);
                console.log(`   First difference at char: ${findFirstDifference(fileContent, verifiedContent)}`);
                vscode.window.showWarningMessage(`Published ${path.basename(filePath)} but content verification failed. Check console for details.`);
            }
            
            return { success: true, verified: uploadSuccessful, uploadResult };
        } catch (error) {
            console.error(`❌ Failed to publish current file:`, error);
            vscode.window.showErrorMessage(`Failed to publish file: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
}

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
                resolve();
            });
            req.on('error', reject);
            req.end();
        });
    }

    async submitLogin() {
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
                
                if (res.statusCode === 200 || res.statusCode === 302) {
                    this.sessionValid = true;
                    this.lastSessionCheck = Date.now();
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    async checkSession() {
        if (this.sessionValid && (Date.now() - this.lastSessionCheck < this.sessionCheckInterval)) {
            return true;
        }

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/customization/home.html',
            method: 'GET',
            headers: {
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Cookie': this.getCookieHeader()
            }
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                this.lastSessionCheck = Date.now();
                this.parseCookies(res.headers['set-cookie']);
                
                if (res.statusCode === 200) {
                    this.sessionValid = true;
                    resolve(true);
                } else {
                    this.sessionValid = false;
                    resolve(false);
                }
            });
            req.on('error', () => {
                this.sessionValid = false;
                resolve(false);
            });
            req.end();
        });
    }

    async ensureAuthenticated() {
        let isLoggedIn = await this.checkSession();
        
        if (!isLoggedIn) {
            if (!this.username || !this.password) {
                throw new Error('PowerSchool credentials missing. Please check .env.local file.');
            }
            
            await this.getLoginPage();
            isLoggedIn = await this.submitLogin();
            
            if (!isLoggedIn) {
                throw new Error('PowerSchool login failed. Please check your credentials.');
            }
        }
        
        return true;
    }

    async getFolderTree(path = '/', maxDepth = 1) {
        await this.ensureAuthenticated();
        
        const queryParams = new URLSearchParams({
            path: path,
            maxDepth: maxDepth.toString()
        });
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/tree?${queryParams.toString()}`,
            method: 'GET',
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Cookie': this.getCookieHeader()
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200) {
                            resolve(response);
                        } else {
                            reject(new Error(`API Error ${res.statusCode}: ${response.message || data}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async createNewFile(filePath, content) {
        await this.ensureAuthenticated();
        
        console.log('🆕 CREATING NEW FILE ON POWERSCHOOL:');
        console.log(`   File path: ${filePath}`);
        console.log(`   Content length: ${content.length} characters`);
        
        const pathParts = filePath.split('/');
        const fileName = pathParts.pop();
        const folderPath = pathParts.join('/') || '/';
        
        const createData = new URLSearchParams({
            'newAssetName': fileName,
            'newAssetPath': folderPath,
            'newAssetType': 'file',
            'newAssetRoot': ''
        }).toString();
        
        const createOptions = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/ws/cpm/createAsset',
            method: 'POST',
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(createData),
                'Cookie': this.getCookieHeader()
            }
        };
        
        return new Promise((resolve, reject) => {
            const req = https.request(createOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log('📤 CREATE FILE API RESPONSE:');
                    console.log(`   Status: ${res.statusCode}`);
                    console.log(`   Raw response: ${data}`);
                    
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200 && response.returnMessage && response.returnMessage.includes('successfully')) {
                            console.log('   ✅ File created successfully, now adding content...');
                            this.updateExistingFileContent(filePath, content).then(resolve).catch(reject);
                        } else {
                            reject(new Error(`Failed to create file: ${response.returnMessage || data}`));
                        }
                    } catch (parseError) {
                        reject(new Error(`PowerSchool returned invalid JSON: ${parseError.message}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(createData);
            req.end();
        });
    }

    async updateExistingFileContent(filePath, content) {
        await this.ensureAuthenticated();
        
        console.log('✏️  UPDATING EXISTING FILE CONTENT:');
        console.log(`   File path: ${filePath}`);
        console.log(`   Content length: ${content.length} characters`);
        
        // Get file info to get customContentId
        const fileInfo = await this.downloadFileInfo(filePath);
        
        // Generate key path from file path (remove leading slash and replace / with .)
        const keyPath = filePath.replace(/^\/+/, '').replace(/\//g, '.').replace(/\.(html|htm|js|css|txt)$/i, '');
        
        // Generate boundary for multipart data
        const boundary = `----formdata-node-${Math.random().toString(36).substr(2, 16)}`;
        
        // Create multipart form data according to PowerSchool API spec
        const formFields = {
            'customContentId': fileInfo.activeCustomContentId || fileInfo.draftCustomContentId || 0,
            'customContent': content,
            'customContentPath': filePath,
            'keyPath': keyPath,
            'keyValueMap': 'null',
            'publish': 'true'  // Publish directly
        };
        
        const multipartData = this.generateMultipartData(formFields, boundary);
        
        console.log(`   Using boundary: ${boundary}`);
        console.log(`   Custom content ID: ${formFields.customContentId}`);
        console.log(`   Key path: ${keyPath}`);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/ws/cpm/customPageContent',
            method: 'POST',
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(multipartData),
                'Cookie': this.getCookieHeader()
            }
        };
        
        console.log(`   Request URL: https://${options.hostname}${options.path}`);

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log('📤 UPDATE FILE API RESPONSE:');
                    console.log(`   Status: ${res.statusCode}`);
                    console.log(`   Raw response: ${data}`);
                    
                    try {
                        const response = JSON.parse(data);
                        console.log(`   Parsed response:`, response);
                        
                        if (res.statusCode === 200) {
                            console.log('   ✅ File content updated successfully');
                            resolve(response);
                        } else {
                            console.log(`   ❌ Update failed with status ${res.statusCode}`);
                            reject(new Error(`Update failed ${res.statusCode}: ${response.returnMessage || data}`));
                        }
                    } catch (parseError) {
                        console.log(`   ❌ Failed to parse update response: ${parseError.message}`);
                        reject(new Error(`PowerSchool returned invalid JSON: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.log(`   ❌ Update request error: ${error.message}`);
                reject(error);
            });
            
            req.write(multipartData);
            req.end();
        });
    }

    async checkFileExists(filePath) {
        try {
            await this.downloadFileInfo(filePath);
            return true;
        } catch (error) {
            console.log(`   ℹ️  File ${filePath} does not exist on PowerSchool: ${error.message}`);
            return false;
        }
    }

    generateMultipartData(fields, boundary) {
        let data = '';
        for (const [name, value] of Object.entries(fields)) {
            data += `--${boundary}\r\n`;
            data += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
            data += `${value}\r\n`;
        }
        data += `--${boundary}--\r\n`;
        return data;
    }

    async downloadFileInfo(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        await this.ensureAuthenticated();
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/builtintext?${queryParams.toString()}`,
            method: 'GET',
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Cookie': this.getCookieHeader()
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200) {
                            resolve(response);
                        } else {
                            reject(new Error(`Failed to get file info: ${response.message || data}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async verifyUpload(filePath) {
        console.log('🔍 VERIFYING UPLOAD:');
        console.log(`   Re-downloading ${filePath} to verify changes...`);
        
        try {
            // Wait a moment for PowerSchool to process the upload
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const verifyContent = await this.downloadFileContent(filePath);
            console.log(`   Verification content length: ${verifyContent.length}`);
            console.log(`   Verification preview: ${verifyContent.substring(0, 200)}${verifyContent.length > 200 ? '...' : ''}`);
            return verifyContent;
        } catch (error) {
            console.log(`   ❌ Verification failed: ${error.message}`);
            throw error;
        }
    }

    async downloadFileContent(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        await this.ensureAuthenticated();
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/builtintext?${queryParams.toString()}`,
            method: 'GET',
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Cookie': this.getCookieHeader()
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200) {
                            // Return the active custom text or built-in text
                            const content = response.activeCustomText || response.builtInText || '';
                            resolve(content);
                        } else {
                            reject(new Error(`Failed to download file: ${response.message || data}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async getCompleteDirectoryStructure(rootPath = '/', maxDepth = 3) {
        console.log('🌲 SCANNING COMPLETE POWERSCHOOL DIRECTORY STRUCTURE');
        console.log('====================================================');
        
        const scannedPaths = new Set();
        const allFiles = [];
        const allFolders = [];

        const scanFolder = async (currentPath, depth = 0) => {
            if (depth > maxDepth || scannedPaths.has(currentPath)) {
                return;
            }
            
            scannedPaths.add(currentPath);
            console.log(`${'  '.repeat(depth)}📂 Scanning: ${currentPath} (depth ${depth})`);
            
            try {
                const tree = await this.getFolderTree(currentPath, 1);
                
                if (tree.folder) {
                    const folderInfo = {
                        path: currentPath,
                        name: tree.folder.text,
                        depth: depth
                    };
                    allFolders.push(folderInfo);
                    
                    // Scan subfolders
                    if (tree.folder.subFolders && tree.folder.subFolders.length > 0) {
                        for (const subfolder of tree.folder.subFolders) {
                            const subfolderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                            await scanFolder(subfolderPath, depth + 1);
                        }
                    }
                    
                    // Collect files
                    if (tree.folder.pages && tree.folder.pages.length > 0) {
                        for (const page of tree.folder.pages) {
                            const filePath = currentPath === '/' ? `/${page.text}` : `${currentPath}/${page.text}`;
                            const fileInfo = {
                                path: filePath,
                                name: page.text,
                                folderPath: currentPath,
                                depth: depth
                            };
                            allFiles.push(fileInfo);
                            console.log(`${'  '.repeat(depth + 1)}📄 ${filePath}`);
                        }
                    }
                }
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.log(`${'  '.repeat(depth)}❌ Error scanning ${currentPath}: ${error.message}`);
            }
        };

        await scanFolder(rootPath, 0);
        
        console.log(`\\n📊 SCAN COMPLETE: Found ${allFiles.length} files in ${allFolders.length} folders`);
        
        return {
            files: allFiles.sort((a, b) => a.path.localeCompare(b.path)),
            folders: allFolders.sort((a, b) => a.path.localeCompare(b.path)),
            totalFiles: allFiles.length,
            totalFolders: allFolders.length
        };
    }

    async testUploadEndpoint() {
        await this.ensureAuthenticated();
        
        console.log('🔍 TESTING UPLOAD ENDPOINT AVAILABILITY:');
        
        // Try different possible upload endpoints
        const possibleEndpoints = [
            '/ws/cpm/updatetext',
            '/ws/cpm/save',
            '/ws/cpm/upload',
            '/admin/customization/save.html',
            '/admin/customization/updatetext.html'
        ];
        
        for (const endpoint of possibleEndpoints) {
            console.log(`   Testing: ${endpoint}`);
            
            const options = {
                hostname: new URL(this.baseUrl).hostname,
                port: 443,
                path: endpoint,
                method: 'OPTIONS', // Use OPTIONS to test endpoint availability
                headers: {
                    'Referer': `${this.baseUrl}/admin/customization/home.html`,
                    'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                    'Cookie': this.getCookieHeader()
                }
            };
            
            try {
                const result = await new Promise((resolve) => {
                    const req = https.request(options, (res) => {
                        console.log(`     Status: ${res.statusCode}`);
                        resolve({ endpoint, status: res.statusCode, available: res.statusCode !== 404 });
                    });
                    req.on('error', () => {
                        resolve({ endpoint, status: 'error', available: false });
                    });
                    req.setTimeout(5000, () => {
                        req.abort();
                        resolve({ endpoint, status: 'timeout', available: false });
                    });
                    req.end();
                });
                
                if (result.available) {
                    console.log(`     ✅ ${endpoint} appears to be available`);
                } else {
                    console.log(`     ❌ ${endpoint} not available`);
                }
            } catch (error) {
                console.log(`     ❌ ${endpoint} error: ${error.message}`);
            }
        }
    }

    async uploadFileContent(filePath, content) {
        await this.ensureAuthenticated();
        
        console.log('🔍 UPLOAD DEBUG INFO (CORRECT PowerSchool API):');
        console.log(`   File path: ${filePath}`);
        console.log(`   Content length: ${content.length} characters`);
        console.log(`   Content preview: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
        
        // First try to get the file info to get customContentId if it exists
        let fileInfo = null;
        try {
            fileInfo = await this.downloadFileInfo(filePath);
        } catch (error) {
            console.log(`   ℹ️  File doesn't exist on PowerSchool yet (new file): ${error.message}`);
            fileInfo = { activeCustomContentId: 0 }; // New file
        }
        
        // Generate key path from file path (remove leading slash and replace / with .)
        const keyPath = filePath.replace(/^\/+/, '').replace(/\//g, '.').replace(/\.(html|htm|js|css|txt)$/i, '');
        
        // Generate boundary for multipart data
        const boundary = `----formdata-node-${Math.random().toString(36).substr(2, 16)}`;
        
        // Create multipart form data according to PowerSchool API spec
        const formFields = {
            'customContentId': fileInfo.activeCustomContentId || 0,
            'customContent': content,
            'customContentPath': filePath,
            'keyPath': keyPath,
            'keyValueMap': 'null',
            'publish': 'true'  // Publish directly instead of saving as draft
        };
        
        const multipartData = generateMultipartData(formFields, boundary);
        
        console.log(`   Using boundary: ${boundary}`);
        console.log(`   Custom content ID: ${formFields.customContentId}`);
        console.log(`   Key path: ${keyPath}`);
        console.log(`   Multipart data length: ${multipartData.length} bytes`);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/ws/cpm/customPageContent',
            method: 'POST',
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'PowerSchool-CPM-VSCode-Extension/1.0',
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(multipartData),
                'Cookie': this.getCookieHeader()
            }
        };
        
        console.log(`   Request URL: https://${options.hostname}${options.path}`);
        console.log(`   Cookie count: ${this.cookies.size}`);

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log('📤 PowerSchool CPM API RESPONSE:');
                    console.log(`   Status: ${res.statusCode}`);
                    console.log(`   Headers:`, res.headers);
                    console.log(`   Raw response: ${data}`);
                    
                    try {
                        const response = JSON.parse(data);
                        console.log(`   Parsed response:`, response);
                        
                        if (res.statusCode === 200) {
                            console.log('   ✅ PowerSchool upload completed successfully');
                            if (response.returnMessage && response.returnMessage.includes('successfully')) {
                                console.log(`   ✅ Success message: ${response.returnMessage}`);
                                resolve(response);
                            } else {
                                console.log(`   ⚠️  Unexpected response: ${response.returnMessage}`);
                                resolve(response);
                            }
                        } else {
                            console.log(`   ❌ Upload failed with status ${res.statusCode}`);
                            reject(new Error(`Upload failed ${res.statusCode}: ${response.returnMessage || data}`));
                        }
                    } catch (parseError) {
                        console.log(`   ❌ Failed to parse response JSON: ${parseError.message}`);
                        console.log(`   Raw data: ${data.substring(0, 500)}${data.length > 500 ? '...' : ''}`);
                        reject(new Error(`PowerSchool returned invalid JSON response: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.log(`   ❌ Request error: ${error.message}`);
                reject(error);
            });
            
            req.write(multipartData);
            req.end();
        });
    }
}

function activate(context) {
    console.log('PowerSchool CPM extension is now active!');

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let psWebrootPath = null;
    
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            if (folder.name === 'ps_webroot' || folder.uri.path.endsWith('/ps_webroot')) {
                psWebrootPath = folder.uri.fsPath;
                break;
            }
        }
    }
    
    if (!psWebrootPath && workspaceFolders && workspaceFolders.length > 0) {
        psWebrootPath = workspaceFolders[0].uri.fsPath;
    }
    
    if (!psWebrootPath) {
        vscode.window.showWarningMessage('No workspace folder found. Please open a folder to use PowerSchool CPM extension.');
        return;
    }

    // Initialize PowerSchool API and Tree Provider
    const api = new PowerSchoolAPI();
    const treeProvider = new PowerSchoolTreeProvider(api, psWebrootPath);
    
    // Register the tree view
    const treeView = vscode.window.createTreeView('powerschool-cpm-explorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    
    // Register commands
    const helloCommand = vscode.commands.registerCommand('powerschool-cpm.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from PowerSchool CPM!');
    });

    const refreshCommand = vscode.commands.registerCommand('powerschool-cpm.refresh', () => {
        treeProvider.refresh();
        vscode.window.showInformationMessage('PowerSchool file tree refreshed!');
    });
    
    const downloadCommand = vscode.commands.registerCommand('powerschool-cpm.downloadFile', async (treeItem) => {
        await treeProvider.downloadFile(treeItem);
    });
    
    const publishCommand = vscode.commands.registerCommand('powerschool-cpm.publishFile', async (treeItem) => {
        await treeProvider.publishFile(treeItem);
    });
    
    const publishCurrentCommand = vscode.commands.registerCommand('powerschool-cpm.publishCurrentFile', async () => {
        await treeProvider.publishCurrentFile();
    });
    
    const debugUploadCommand = vscode.commands.registerCommand('powerschool-cpm.debugUpload', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('No active file to debug.');
            return;
        }
        
        try {
            const filePath = activeEditor.document.fileName;
            const relativePath = path.relative(psWebrootPath, filePath);
            const remotePath = '/' + relativePath.replace(/\\/g, '/');
            
            vscode.window.showInformationMessage('Running comprehensive upload debug analysis...');
            
            console.log('🔍 UPLOAD DEBUG ANALYSIS');
            console.log('==========================');
            console.log(`Local file: ${filePath}`);
            console.log(`Remote path: ${remotePath}`);
            console.log(`PS Server: ${api.baseUrl}`);
            
            // Check current session
            const sessionValid = await api.checkSession();
            console.log(`Session valid: ${sessionValid}`);
            console.log(`Session cookies: ${api.cookies.size}`);
            
            // Test upload endpoints
            console.log('\\nTesting upload endpoints...');
            await api.testUploadEndpoint();
            
            // Read local file
            const localContent = fs.readFileSync(filePath, 'utf8');
            console.log(`\\nLocal content length: ${localContent.length}`);
            
            // Download current remote content
            console.log('\\nDownloading current remote content...');
            const remoteContent = await api.downloadFileContent(remotePath);
            console.log(`Remote content length: ${remoteContent.length}`);
            
            // Compare
            const matches = localContent === remoteContent;
            console.log(`Content matches: ${matches}`);
            
            if (!matches) {
                const firstDiff = findFirstDifference(localContent, remoteContent);
                console.log(`First difference at character: ${firstDiff}`);
                console.log(`Local around diff: "${localContent.substring(Math.max(0, firstDiff-20), firstDiff+20)}"`);
                console.log(`Remote around diff: "${remoteContent.substring(Math.max(0, firstDiff-20), firstDiff+20)}"`);
            }
            
            vscode.window.showInformationMessage('Debug analysis complete. Check VS Code Developer Console for details.');
            
        } catch (error) {
            console.error('Debug analysis failed:', error);
            vscode.window.showErrorMessage(`Debug analysis failed: ${error.message}`);
        }
    });

    const testEndpointsCommand = vscode.commands.registerCommand('powerschool-cpm.testEndpoints', async () => {
        try {
            vscode.window.showInformationMessage('Testing PowerSchool upload endpoints...');
            console.log('🔍 TESTING POWERSCHOOL UPLOAD ENDPOINTS');
            console.log('========================================');
            await api.testUploadEndpoint();
            vscode.window.showInformationMessage('Endpoint testing complete. Check VS Code Developer Console for results.');
        } catch (error) {
            console.error('Endpoint testing failed:', error);
            vscode.window.showErrorMessage(`Endpoint testing failed: ${error.message}`);
        }
    });

    const createNewFileCommand = vscode.commands.registerCommand('powerschool-cpm.createNewFile', async () => {
        try {
            // Show quick pick for file type
            const templateOptions = Object.keys(FILE_TEMPLATES).map(key => ({
                label: FILE_TEMPLATES[key].name,
                description: `Create a new ${FILE_TEMPLATES[key].name.toLowerCase()}`,
                key: key
            }));
            
            const selectedTemplate = await vscode.window.showQuickPick(templateOptions, {
                placeHolder: 'Select the type of PowerSchool file to create'
            });
            
            if (!selectedTemplate) return;
            
            // Get file name from user
            const fileName = await vscode.window.showInputBox({
                prompt: `Enter name for new ${selectedTemplate.label}`,
                placeHolder: `my-new-page${FILE_TEMPLATES[selectedTemplate.key].extension}`,
                validateInput: (value) => {
                    if (!value) return 'File name is required';
                    if (!value.endsWith(FILE_TEMPLATES[selectedTemplate.key].extension)) {
                        return `File name must end with ${FILE_TEMPLATES[selectedTemplate.key].extension}`;
                    }
                    return null;
                }
            });
            
            if (!fileName) return;
            
            // Get target directory
            const pathOptions = [
                { label: '/admin', description: 'Admin pages (admin folder)' },
                { label: '/admin/students', description: 'Student admin pages' },
                { label: '/admin/teachers', description: 'Teacher admin pages' },
                { label: '/admin/schools', description: 'School admin pages' },
                { label: '/public', description: 'Public pages' },
                { label: '/images/css', description: 'CSS stylesheets' },
                { label: '/images/javascript', description: 'JavaScript files' },
                { label: 'Custom path...', description: 'Enter a custom PowerSchool path' }
            ];
            
            const selectedPath = await vscode.window.showQuickPick(pathOptions, {
                placeHolder: 'Select where to create the file in PowerSchool'
            });
            
            if (!selectedPath) return;
            
            let targetPath = selectedPath.label;
            if (selectedPath.label === 'Custom path...') {
                const customPath = await vscode.window.showInputBox({
                    prompt: 'Enter PowerSchool path (e.g., /admin/custom)',
                    placeHolder: '/admin/custom',
                    validateInput: (value) => {
                        if (!value) return 'Path is required';
                        if (!value.startsWith('/')) return 'Path must start with /';
                        return null;
                    }
                });
                if (!customPath) return;
                targetPath = customPath;
            }
            
            // Create local file path
            const remotePath = `${targetPath}/${fileName}`;
            const localFilePath = path.join(psWebrootPath, remotePath.replace(/^\/+/g, ''));
            
            // Create local directory if it doesn't exist
            const localDir = path.dirname(localFilePath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            
            // Write template content to local file
            const template = FILE_TEMPLATES[selectedTemplate.key];
            fs.writeFileSync(localFilePath, template.content);
            
            // Open the file in editor
            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);
            
            vscode.window.showInformationMessage(`Created ${fileName} locally. Edit the file and use "Publish to PowerSchool" when ready.`);
            
        } catch (error) {
            console.error('Failed to create new file:', error);
            vscode.window.showErrorMessage(`Failed to create file: ${error.message}`);
        }
    });
    
    const publishAnyFileCommand = vscode.commands.registerCommand('powerschool-cpm.publishAnyFile', async () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active file to publish.');
                return;
            }
            
            const filePath = activeEditor.document.fileName;
            const relativePath = path.relative(psWebrootPath, filePath);
            
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showWarningMessage('File is not in the PowerSchool workspace.');
                return;
            }
            
            // Convert local path to PowerSchool path format
            const remotePath = '/' + relativePath.replace(/\\/g, '/');
            
            // Try to find similar files to suggest the correct path
            let suggestedPath = remotePath;
            let pathSuggestions = [remotePath];
            
            try {
                console.log('🔍 Looking for similar files to suggest correct path...');
                const fileName = path.basename(filePath);
                const fileNameWithoutExt = path.parse(fileName).name;
                
                // Search in common admin areas first
                const searchPaths = ['/admin/students', '/admin/teachers', '/admin/schools', '/admin', '/public'];
                
                for (const searchPath of searchPaths) {
                    try {
                        const tree = await api.getFolderTree(searchPath, 1);
                        if (tree.folder && tree.folder.pages) {
                            for (const page of tree.folder.pages) {
                                if (page.text.toLowerCase().includes(fileNameWithoutExt.toLowerCase()) || 
                                    fileNameWithoutExt.toLowerCase().includes(page.text.toLowerCase().split('.')[0])) {
                                    const suggestion = `${searchPath}/${page.text}`;
                                    if (!pathSuggestions.includes(suggestion)) {
                                        pathSuggestions.push(suggestion);
                                        console.log(`   💡 Found similar file: ${suggestion}`);
                                    }
                                }
                            }
                        }
                    } catch {
                        // Continue searching other paths
                    }
                }
                
                if (pathSuggestions.length > 1) {
                    suggestedPath = pathSuggestions[1]; // Use the first match found
                }
                
            } catch (error) {
                console.log('   ⚠️ Could not search for similar files:', error.message);
            }

            // Ask user to confirm the PowerSchool path with suggestions
            let confirmedPath;
            if (pathSuggestions.length > 1) {
                const pathChoice = await vscode.window.showQuickPick(
                    pathSuggestions.map(p => ({ label: p, description: p === remotePath ? 'Original guess' : 'Similar file found' })),
                    {
                        placeHolder: 'Select the correct PowerSchool path for this file',
                        canPickMany: false
                    }
                );
                
                if (!pathChoice) return;
                
                confirmedPath = await vscode.window.showInputBox({
                    prompt: 'Confirm or edit the PowerSchool path for this file',
                    value: pathChoice.label,
                    validateInput: (value) => {
                        if (!value) return 'Path is required';
                        if (!value.startsWith('/')) return 'Path must start with /';
                        return null;
                    }
                });
            } else {
                confirmedPath = await vscode.window.showInputBox({
                    prompt: 'Confirm or edit the PowerSchool path for this file (use "Show Full Directory Structure" command to see all paths)',
                    value: suggestedPath,
                    validateInput: (value) => {
                        if (!value) return 'Path is required';
                        if (!value.startsWith('/')) return 'Path must start with /';
                        return null;
                    }
                });
            }
            
            if (!confirmedPath) return;
            
            console.log(`📤 Publishing file to PowerSchool: ${confirmedPath}`);
            vscode.window.showInformationMessage(`Publishing ${path.basename(filePath)} to PowerSchool...`);
            
            // Save the file first if it has unsaved changes
            if (activeEditor.document.isDirty) {
                await activeEditor.document.save();
            }
            
            const fileContent = fs.readFileSync(filePath, 'utf8');
            console.log(`📄 File content (${fileContent.length} chars): ${fileContent.substring(0, 200)}...`);
            
            // Check if file exists on PowerSchool to determine which API endpoint to use
            console.log('🔍 Checking if file exists on PowerSchool...');
            const fileExists = await api.checkFileExists(confirmedPath);
            
            let uploadResult;
            if (fileExists) {
                console.log('✏️  File exists, updating content...');
                uploadResult = await api.updateExistingFileContent(confirmedPath, fileContent);
            } else {
                console.log('🆕 File does not exist, creating new file...');
                uploadResult = await api.createNewFile(confirmedPath, fileContent);
            }
            console.log(`📤 Upload result:`, uploadResult);
            
            // Verify the upload
            vscode.window.showInformationMessage(`Verifying upload of ${path.basename(filePath)}...`);
            const verifiedContent = await api.verifyUpload(confirmedPath);
            
            // Compare content
            const uploadSuccessful = fileContent === verifiedContent;
            
            if (uploadSuccessful) {
                console.log(`✅ Published and verified: ${confirmedPath}`);
                vscode.window.showInformationMessage(`Published ${path.basename(filePath)} successfully! Content verified.`);
                
                // Refresh tree view to show the new file
                treeProvider.refresh();
            } else {
                console.log(`⚠️  Upload completed but verification shows different content`);
                console.log(`   Original length: ${fileContent.length}`);
                console.log(`   Verified length: ${verifiedContent.length}`);
                console.log(`   First difference at char: ${findFirstDifference(fileContent, verifiedContent)}`);
                vscode.window.showWarningMessage(`Published ${path.basename(filePath)} but content verification failed. Check console for details.`);
            }
            
        } catch (error) {
            console.error('❌ Failed to publish file:', error);
            vscode.window.showErrorMessage(`Failed to publish file: ${error.message}`);
        }
    });

    const showFullPathsCommand = vscode.commands.registerCommand('powerschool-cpm.showFullPaths', async () => {
        try {
            vscode.window.showInformationMessage('Scanning PowerSchool directory structure... This may take a moment.');
            console.log('🌲 Starting complete PowerSchool directory scan...');
            
            const structure = await api.getCompleteDirectoryStructure('/', 3);
            
            // Show results in output channel for easy viewing
            const outputChannel = vscode.window.createOutputChannel('PowerSchool Directory Structure');
            outputChannel.clear();
            outputChannel.show(true);
            
            outputChannel.appendLine('========================================');
            outputChannel.appendLine('POWERSCHOOL COMPLETE DIRECTORY STRUCTURE');
            outputChannel.appendLine('========================================');
            outputChannel.appendLine('');
            outputChannel.appendLine(`Total Folders: ${structure.totalFolders}`);
            outputChannel.appendLine(`Total Files: ${structure.totalFiles}`);
            outputChannel.appendLine('');
            
            outputChannel.appendLine('📁 FOLDERS:');
            outputChannel.appendLine('----------');
            for (const folder of structure.folders) {
                const indent = '  '.repeat(folder.depth);
                outputChannel.appendLine(`${indent}📂 ${folder.path} (${folder.name})`);
            }
            
            outputChannel.appendLine('');
            outputChannel.appendLine('📄 FILES:');
            outputChannel.appendLine('--------');
            for (const file of structure.files) {
                outputChannel.appendLine(`📄 ${file.path}`);
                outputChannel.appendLine(`   └─ Folder: ${file.folderPath}`);
                outputChannel.appendLine(`   └─ Name: ${file.name}`);
                outputChannel.appendLine('');
            }
            
            // Also search for the specific file mentioned
            const generalDemographicsFiles = structure.files.filter(f => 
                f.name.toLowerCase().includes('generaldemographics') || 
                f.path.toLowerCase().includes('generaldemographics')
            );
            
            if (generalDemographicsFiles.length > 0) {
                outputChannel.appendLine('🎯 GENERALDEMOGRAPHICS FILES FOUND:');
                outputChannel.appendLine('================================');
                for (const file of generalDemographicsFiles) {
                    outputChannel.appendLine(`✅ ${file.path}`);
                    outputChannel.appendLine(`   └─ Use this exact path when publishing: ${file.path}`);
                    outputChannel.appendLine('');
                }
            }
            
            outputChannel.appendLine('📋 HOW TO USE THESE PATHS:');
            outputChannel.appendLine('========================');
            outputChannel.appendLine('1. When creating new files, use any folder path shown above');
            outputChannel.appendLine('2. When publishing files, use the EXACT file path shown above');
            outputChannel.appendLine('3. Example: /admin/students/generaldemographics.html');
            outputChannel.appendLine('4. Make sure your local folder structure matches the PowerSchool structure');
            
            vscode.window.showInformationMessage(`Directory scan complete! Found ${structure.totalFiles} files in ${structure.totalFolders} folders. Check the "PowerSchool Directory Structure" output panel for details.`);
            
        } catch (error) {
            console.error('Failed to scan directory structure:', error);
            vscode.window.showErrorMessage(`Failed to scan PowerSchool structure: ${error.message}`);
        }
    });

    context.subscriptions.push(treeView, helloCommand, refreshCommand, downloadCommand, publishCommand, publishCurrentCommand, debugUploadCommand, testEndpointsCommand, createNewFileCommand, publishAnyFileCommand, showFullPathsCommand);
    
    console.log('🌲 PowerSchool CPM tree view initialized!');
    vscode.window.showInformationMessage('PowerSchool CPM: Use the PowerSchool Explorer panel to browse and download files!');
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
