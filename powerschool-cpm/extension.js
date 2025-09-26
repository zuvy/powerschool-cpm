const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const https = require('https');

require('dotenv').config({ path: '.env.local' });

class FileSystemSync {
    constructor(psApi, localRootPath) {
        this.psApi = psApi;
        this.localRootPath = localRootPath;
    }

    async syncDirectory() {
        try {
            console.log('Starting directory sync...');
            
            // Get remote folder structure
            const remoteTree = await this.psApi.getFolderTree('/', 5); // Get deeper tree
            
            // Compare and sync
            await this.syncFolderRecursive(remoteTree.folder, this.localRootPath, '/');
            
            return { success: true, message: 'Sync completed successfully' };
        } catch (error) {
            console.error('Sync failed:', error);
            return { success: false, message: error.message };
        }
    }

    getLocalStructure(dirPath) {
        const structure = { folders: [], files: [] };
        
        try {
            if (!fs.existsSync(dirPath)) {
                return structure;
            }
            
            const items = fs.readdirSync(dirPath);
            
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                
                if (stat.isDirectory()) {
                    structure.folders.push({
                        name: item,
                        path: itemPath,
                        children: this.getLocalStructure(itemPath)
                    });
                } else {
                    structure.files.push({
                        name: item,
                        path: itemPath
                    });
                }
            }
        } catch (error) {
            console.error('Error reading local structure:', error);
        }
        
        return structure;
    }

    async syncFolderRecursive(remoteFolder, localPath, remotePath) {
        // Ensure local directory exists
        if (!fs.existsSync(localPath)) {
            fs.mkdirSync(localPath, { recursive: true });
            console.log(`Created local directory: ${localPath}`);
        }

        // Sync files in current folder
        if (remoteFolder.pages) {
            for (const remotePage of remoteFolder.pages) {
                const localFilePath = path.join(localPath, remotePage.text);
                
                if (!fs.existsSync(localFilePath)) {
                    try {
                        // Download file content from PowerSchool
                        const fileContent = await this.downloadFile(remotePath + remotePage.text);
                        fs.writeFileSync(localFilePath, fileContent);
                        console.log(`Downloaded: ${remotePage.text}`);
                    } catch (error) {
                        console.error(`Failed to download ${remotePage.text}:`, error.message);
                    }
                }
            }
        }

        // Sync subfolders
        if (remoteFolder.subFolders) {
            for (const remoteSubFolder of remoteFolder.subFolders) {
                const localSubPath = path.join(localPath, remoteSubFolder.text);
                const remoteSubPath = remotePath + remoteSubFolder.text + '/';
                
                // Recursively sync subfolder
                await this.syncFolderRecursive(remoteSubFolder, localSubPath, remoteSubPath);
            }
        }
        
        // Clean up local files/folders that don't exist remotely
        await this.cleanupLocalItems(remoteFolder, localPath);
    }

    async cleanupLocalItems(remoteFolder, localPath) {
        try {
            if (!fs.existsSync(localPath)) return;
            
            const localItems = fs.readdirSync(localPath);
            
            for (const localItem of localItems) {
                const localItemPath = path.join(localPath, localItem);
                const stat = fs.statSync(localItemPath);
                
                if (stat.isDirectory()) {
                    // Check if remote folder exists
                    const remoteExists = remoteFolder.subFolders && 
                        remoteFolder.subFolders.some(rf => rf.text === localItem);
                    
                    if (!remoteExists) {
                        fs.rmSync(localItemPath, { recursive: true, force: true });
                        console.log(`Removed local directory: ${localItem}`);
                    }
                } else {
                    // Check if remote file exists
                    const remoteExists = remoteFolder.pages && 
                        remoteFolder.pages.some(rp => rp.text === localItem);
                    
                    if (!remoteExists) {
                        fs.unlinkSync(localItemPath);
                        console.log(`Removed local file: ${localItem}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    async downloadFile(filePath) {
        // Use the builtintext endpoint to get file content
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        const token = await this.psApi.authenticate();
        
        const options = {
            hostname: new URL(this.psApi.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/builtintext?${queryParams.toString()}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
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

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });
    }
}

class PowerSchoolAPI {
    constructor() {
        this.baseUrl = process.env.PSTEST_URI;
        this.clientId = process.env.PSTEST_CLIENT_ID;
        this.clientSecret = process.env.PSTEST_CLIENT_SECRET;
        this.accessToken = null;
        this.tokenExpiresAt = null;
    }

    async authenticate() {
        if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        
        const postData = 'grant_type=client_credentials';
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/oauth/access_token/',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
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
                        if (response.access_token) {
                            this.accessToken = response.access_token;
                            this.tokenExpiresAt = Date.now() + (response.expires_in * 1000) - 60000;
                            resolve(this.accessToken);
                        } else {
                            reject(new Error('No access token in response'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    async getFolderTree(path = '/', maxDepth = 1) {
        const token = await this.authenticate();
        
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
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
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

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });
    }
}

function activate(context) {
    console.log('PowerSchool CPM extension is now active!');

    // Check if we're in a ps_webroot workspace
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

    // Auto-sync if ps_webroot is detected and configuration allows it
    if (psWebrootPath) {
        const config = vscode.workspace.getConfiguration('psvc-plugin');
        const autoSync = config.get('autoSync', true);
        
        if (autoSync) {
            console.log('ps_webroot directory detected, starting auto-sync...');
            performSync(psWebrootPath);
        }
    }

    // Register commands
    let syncCommand = vscode.commands.registerCommand('psvc-plugin.syncWithPowerSchool', async function() {
        try {
            // Use current workspace or prompt for directory
            let targetPath = psWebrootPath;
            
            if (!targetPath && workspaceFolders && workspaceFolders.length > 0) {
                targetPath = workspaceFolders[0].uri.fsPath;
            }
            
            if (!targetPath) {
                vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
                return;
            }

            const result = await performSync(targetPath);
            
            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Sync failed: ${error.message}`);
        }
    });

    // Set up file watcher for auto-sync
    if (psWebrootPath) {
        const fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(psWebrootPath, '**/*')
        );

        fileWatcher.onDidCreate(() => {
            debounceSync(psWebrootPath);
        });

        fileWatcher.onDidDelete(() => {
            debounceSync(psWebrootPath);
        });

        context.subscriptions.push(fileWatcher);
    }
}

// Debounced sync to prevent too frequent syncing
let syncTimeout = null;
function debounceSync(targetPath) {
    if (syncTimeout) {
        clearTimeout(syncTimeout);
    }
    
    syncTimeout = setTimeout(() => {
        const config = vscode.workspace.getConfiguration('psvc-plugin');
        const autoSync = config.get('autoSync', true);
        
        if (autoSync) {
            performSync(targetPath);
        }
    }, 2000); // Wait 2 seconds after last change
}

async function performSync(targetPath) {
    try {
        console.log(`Starting sync for: ${targetPath}`);
        
        const api = new PowerSchoolAPI();
        const syncManager = new FileSystemSync(api, targetPath);
        
        const result = await syncManager.syncDirectory();
        
        console.log('Sync result:', result);
        return result;
        
    } catch (error) {
        console.error('Sync error:', error);
        return { 
            success: false, 
            message: `Sync failed: ${error.message}. Note: PowerSchool API may require web session authentication.` 
        };
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
