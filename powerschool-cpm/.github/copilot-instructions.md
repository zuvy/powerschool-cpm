# PowerSchool CPM Extension Development Guide

## Project Overview
VS Code extension for PowerSchool Custom Page Management (CPM). Syncs local workspace with PowerSchool's undocumented CPM APIs (`/ws/cpm/*`), enabling local development of custom pages with bidirectional file sync.

## Architecture

### Core Components
- **`extension.js`**: Main entry point (~2100 lines) containing all extension logic
- **`templates.js`**: PowerSchool page templates (Admin, Teacher, Parent portal)
- **`code_snippets.js`**: Reusable PowerSchool UI components and patterns
- **`plugin.xml`**: PowerSchool server-side plugin enabling OAuth/API access

### Key Classes
```javascript
PowerSchoolAPI         // Authentication & API client
PowerSchoolTreeProvider // VS Code tree view data provider  
PowerSchoolTreeItem    // Individual tree items (files/folders)
```

## Critical Developer Workflows

### Plugin Development with web_root Structure
**PowerSchool plugins use a `web_root` directory for web files:**

```
my-plugin/
├── plugin.xml
├── web_root/          ← PowerSchool files go here
│   ├── admin/
│   │   └── page.html
│   └── images/
└── queries_root/
```

**The extension automatically detects and uses web_root:**
- Setting: `ps-vscode-cpm.pluginWebRoot` (default: "web_root")
- On activation, checks for `workspace/web_root/` directory
- If found, uses `web_root` as the base for all file operations
- If not found, falls back to workspace root

**Command: "Setup Plugin Web Root Directory"**
- Creates the web_root directory if it doesn't exist
- Updates tree provider to use new location
- Helpful when starting a new plugin project

### File Synchronization Pattern
**Local files mirror PowerSchool's directory structure exactly:**

```javascript
// PowerSchool path: /admin/students/grades.html
// Plugin structure:  workspace/web_root/admin/students/grades.html
// Without web_root:  workspace/admin/students/grades.html

const localPath = path.join(workspaceRoot, remotePath.replace(/^\/+/g, ''));
```

**When downloading from PowerSchool:**
1. File is saved to `web_root/{powerSchoolPath}` (if web_root exists)
2. Directory structure created automatically with `mkdirSync({recursive: true})`
3. User sees: "Downloaded file.html to admin/students/file.html"

**When creating new files:**
1. User selects template type
2. User selects/browses PowerSchool directory (with folder browser option)
3. File created locally in web_root matching directory structure
4. Shows both local path and PowerSchool path in confirmation

**Path info command:** Right-click any file → "Show File Path Info" displays local and PowerSchool paths

### Plugin Packaging
**Command: "PowerSchool CPM: Package Plugin as ZIP"**

Automates plugin ZIP creation for PowerSchool installation:

```javascript
// Helper functions for packaging
parsePluginVersion(pluginXmlPath)           // Extract version from plugin.xml
updatePluginVersion(pluginXmlPath, version) // Update version attribute
incrementVersion(version, type)             // Semantic versioning (major/minor/patch)
createPluginZip(root, name, version, dirs)  // Creates ZIP using native zip command
```

**Packaging workflow:**
1. Checks for `plugin.xml` in workspace root
2. Parses current version (e.g., "1.0.0")
3. Asks user: "Use current version or update?"
4. If updating, shows version increment options:
   - **Patch**: 1.0.0 → 1.0.1 (bug fixes)
   - **Minor**: 1.0.0 → 1.1.0 (new features)
   - **Major**: 1.0.0 → 2.0.0 (breaking changes)
   - **Custom**: Manual version input with validation
5. Updates `plugin.xml` with new version
6. Auto-detects standard PowerSchool plugin directories (if present):
   - `web_root` - Custom page content files
   - `queries_root` - Named queries XML
   - `permissions_root` - Permission mappings XML
   - `MessageKeys` - Internationalization properties files
   - `pagecataloging` - Page cataloging JSON
7. Creates `plugin-name-1.0.1.zip` using native `zip` command
8. Option to reveal ZIP in file explorer

**Version validation:**
- Regex: `/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/`
- Supports pre-release tags: `1.0.0-beta`, `1.0.0-rc.1`

**Hybrid authentication is the key architectural decision:**

```javascript
// Different PowerSchool API tiers require different auth
getAuthMethodForEndpoint(endpoint) {
    if (authMethod === 'session') return 'session';
    if (authMethod === 'oauth') return 'oauth';
    
    // HYBRID: CPM endpoints need session, others use OAuth
    if (authMethod === 'hybrid') {
        return endpoint.includes('/ws/cpm/') ? 'session' : 'oauth';
    }
}
```

**Why:** CPM APIs (`/ws/cpm/*`) are "internal-only" and reject OAuth tokens. Standard APIs (`/ws/v1/*`) work with OAuth. Extension defaults to hybrid mode to support both.

### Authentication Flow
1. **OAuth**: Client credentials flow → Bearer token (standard APIs)
2. **Session**: Form login → Cookie management (CPM APIs)
3. **Token caching**: OAuth tokens expire, check `tokenExpiry` before requests
4. **Session validation**: Check every 5 minutes, re-login if expired

## PowerSchool CPM API Endpoints

Critical undocumented APIs (see `API.md`):

```javascript
GET  /ws/cpm/tree              // Folder structure (maxDepth, path params)
GET  /ws/cpm/builtintext       // File content download
POST /ws/cpm/customPageContent // Upload/publish (multipart form data)
POST /ws/cpm/createAsset       // Create new file/folder
```

**Publishing requires multipart/form-data with specific fields:**
```javascript
{
    customContentId: 0,              // 0 for new files
    customContent: "file content",
    customContentPath: "/admin/page.html",
    keyPath: "admin.page",           // Path with dots, no extension
    keyValueMap: "null",
    publish: "true"                  // "false" for draft
}
```

## Development Workflows

### Adding New Commands
1. Register in `package.json` `contributes.commands`
2. Implement handler in `activate()` using `registerCommandSafely()`
3. Add to appropriate menu in `contributes.menus` (e.g., `editor/context`)

### Template/Snippet System
- **Templates** (`templates.js`): Full page scaffolds categorized by portal type
- **Snippets** (`code_snippets.js`): UI components (box-round, tabs, TList SQL)
- Both use category-based organization for QuickPick menus

### File Operations Pattern
```javascript
// Always verify uploads by re-downloading
const uploadResult = await api.uploadFileContent(path, content);
const verified = await api.verifyUpload(path);
if (content !== verified) {
    // Log discrepancy with findFirstDifference()
}
```

## Common Patterns

### PowerSchool Path Format
```javascript
// PowerSchool uses leading slashes and double-slashes
"/admin/students/page.html"        // Standard path
"//wildcards/custom.txt"           // Double slash for custom areas

// Convert to keyPath for API calls
"admin.students.page"              // Remove leading /, replace / with .
```

### VS Code Settings Integration
```javascript
// Always reload config when settings change
vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('ps-vscode-cpm')) {
        api.clearAuth();  // Force re-authentication
        treeProvider.refresh();
    }
});
```

### Tree View Lazy Loading
- Load depth=1 initially, cache results per path
- Expand folders on-demand (avoid loading entire tree)
- Clear cache on refresh command

## PowerSchool-Specific Conventions

### Template Syntax
```html
~[wc:admin_header_css]          <!-- Wildcard includes -->
~(studentname)                  <!-- Variable substitution -->
~[if.condition]...[else]...[/if] <!-- Conditional blocks -->
~[tlist_sql;query;...]           <!-- SQL data iteration -->
```

### Standard Page Structure
1. Wildcard header (`~[wc:admin_header_css]`)
2. Breadcrumb navigation
3. Content in `<div class="box-round">`
4. Wildcard footer (`~[wc:admin_footer_css]`)

### Portal Types
- **Admin**: `/admin/*` - Requires `~[wc:admin_*]` wildcards
- **Teacher**: `/teachers/*` - Uses `~[wc:teachers_*]`
- **Parent**: `/guardian/*` - Guardian portal pages
- **Public**: `/public/*` - No authentication required

## Testing & Debugging

### Connection Testing
```javascript
// Test both auth methods
await api.testOAuthConnection();
// Returns: { basicAPI, cpmTree, alternatives }
```

### Console Logging Pattern
Use emoji prefixes for visual scanning:
- 🚀 Extension lifecycle
- 📡 Network requests
- ✅ Success operations
- ❌ Errors
- 🔍 Debug info
- 📤 Uploads
- 📥 Downloads

### Common Issues
1. **401 on CPM APIs**: Check `authMethod` is 'hybrid' or 'session'
2. **Missing plugin**: Install `plugin.xml` in PowerSchool admin
3. **Path mismatches**: PowerSchool paths are case-sensitive
4. **Upload failures**: Verify multipart boundary generation

## File Organization

```
ps-vscode-cpm/
├── extension.js           # All extension logic (monolithic)
├── templates.js          # Page scaffolds by portal type
├── code_snippets.js      # UI component library
├── plugin.xml            # PowerSchool server plugin
├── package.json          # Extension manifest
├── API.md               # Undocumented CPM API reference
├── OAUTH_SETUP.md       # OAuth configuration guide
├── HYBRID_AUTH_SETUP.md # Hybrid auth explanation
└── permissions_root/    # Permission mappings (unused currently)
```

## Extension Settings Schema

```javascript
'ps-vscode-cpm.serverUrl'     // https://pstest.school.org
'ps-vscode-cpm.authMethod'    // 'oauth' | 'session' | 'hybrid'
'ps-vscode-cpm.clientId'      // OAuth client ID
'ps-vscode-cpm.clientSecret'  // OAuth client secret  
'ps-vscode-cpm.username'      // Admin username (session auth)
'ps-vscode-cpm.password'      // Admin password (session auth)
'ps-vscode-cpm.pluginWebRoot' // Subdirectory for plugin files (default: 'web_root')
```

**Plugin development workflow:**
1. Open your plugin directory in VS Code
2. Run "Setup Plugin Web Root Directory" to create web_root/
3. Files download/sync to web_root/ automatically
4. Test changes, then package plugin for installation

**Packaging plugins:**
- Command: "PowerSchool CPM: Package Plugin as ZIP"
- Automatically includes: plugin.xml, web_root/, queries_root/, permissions_root/
- Version management with semantic versioning (major.minor.patch)
- Creates `plugin-name-1.0.0.zip` ready for PowerSchool installation

## Key Dependencies

**Zero npm dependencies** - Uses only Node.js built-ins:
- `https` - All API requests (no axios/fetch)
- `fs` - Local file operations
- `path` - Path manipulation
- `vscode` - Extension API

## Publishing Workflow

1. User edits file locally in workspace
2. Right-click → "Publish to PowerSchool"
3. Extension reads file, determines if exists on server
4. Calls `createNewFile()` OR `updateExistingFileContent()`
5. Verifies upload by re-downloading
6. Shows success/warning based on content match

## Quick Reference

**Start debugging:** F5 (opens Extension Development Host)  
**Reload extension:** Cmd+R in dev host window  
**View logs:** Debug Console in main VS Code window  
**Test connection:** Cmd+Shift+P → "PowerSchool CPM: Test OAuth Connection"
