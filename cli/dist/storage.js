"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FragmentStorage = exports.EncryptionService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const crypto = __importStar(require("crypto"));
const fragmentUtils_1 = require("./fragmentUtils");
class EncryptionService {
    generateKeyHash(key) {
        return crypto.createHash('sha256').update(key).digest();
    }
    encrypt(content, key) {
        const keyBytes = this.generateKeyHash(key);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher('aes-256-cbc', keyBytes);
        const encrypted = Buffer.concat([
            cipher.update(content, 'utf8'),
            cipher.final()
        ]);
        const result = {
            algorithm: 'AES-256-CBC',
            iv: iv.toString('base64'),
            content: encrypted.toString('base64')
        };
        return 'encrypted:' + Buffer.from(JSON.stringify(result)).toString('base64');
    }
    decrypt(encryptedContent, key) {
        if (!encryptedContent.startsWith('encrypted:')) {
            throw new Error('Content is not encrypted');
        }
        const encryptedData = encryptedContent.substring(10);
        const data = JSON.parse(Buffer.from(encryptedData, 'base64').toString());
        const keyBytes = this.generateKeyHash(key);
        const encrypted = Buffer.from(data.content, 'base64');
        const decipher = crypto.createDecipher('aes-256-cbc', keyBytes);
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        return decrypted.toString('utf8');
    }
}
exports.EncryptionService = EncryptionService;
class FragmentStorage {
    SCHEMA_VERSION = '2.0.0';
    storageFilePath;
    encryptionService;
    constructor(storageFilePath, encryptionService) {
        this.storageFilePath = storageFilePath;
        this.encryptionService = encryptionService || new EncryptionService();
    }
    isInitialized() {
        return fs.existsSync(this.storageFilePath);
    }
    async initialize(versions = ['public', 'private'], activeVersion = 'public') {
        const versionConfig = {};
        // Create default version configurations
        versions.forEach(version => {
            versionConfig[version] = {
                name: version.charAt(0).toUpperCase() + version.slice(1),
                encrypted: false
            };
        });
        const data = {
            schema: this.SCHEMA_VERSION,
            activeVersion,
            availableVersions: versions,
            versionConfig,
            fragments: {},
            metadata: {
                created: new Date(),
                modified: new Date(),
                version: this.SCHEMA_VERSION
            }
        };
        await this.save(data);
        return data;
    }
    async load() {
        if (!fs.existsSync(this.storageFilePath)) {
            // Auto-create storage with defaults
            console.error('[Storage] No storage file found, creating new one');
            return await this.initialize();
        }
        try {
            const compressed = fs.readFileSync(this.storageFilePath);
            const decompressed = zlib.gunzipSync(compressed);
            const data = JSON.parse(decompressed.toString());
            // Convert metadata dates
            if (data.metadata.created) {
                data.metadata.created = new Date(data.metadata.created);
            }
            if (data.metadata.modified) {
                data.metadata.modified = new Date(data.metadata.modified);
            }
            // Convert fragment metadata dates
            Object.values(data.fragments).forEach(fragment => {
                if (fragment.metadata?.created) {
                    fragment.metadata.created = new Date(fragment.metadata.created);
                }
                if (fragment.metadata?.modified) {
                    fragment.metadata.modified = new Date(fragment.metadata.modified);
                }
            });
            return data;
        }
        catch (error) {
            console.error('[Storage] Error reading storage file, creating new one:', error);
            return await this.initialize();
        }
    }
    async save(data) {
        data.metadata.modified = new Date();
        const json = JSON.stringify(data, null, 2);
        const compressed = zlib.gzipSync(json);
        fs.writeFileSync(this.storageFilePath, compressed);
    }
    async ensureFragment(fragmentId, currentContent = '') {
        const data = await this.load();
        if (!data.fragments[fragmentId]) {
            console.error(`[Storage] Auto-creating fragment: ${fragmentId} with content for ${data.activeVersion}`);
            // Create fragment with current content for active version, empty for others
            const versions = {};
            for (const version of data.availableVersions) {
                versions[version] = version === data.activeVersion ? currentContent : '';
            }
            data.fragments[fragmentId] = {
                id: fragmentId,
                versions,
                metadata: {
                    created: new Date(),
                    modified: new Date()
                }
            };
            await this.save(data);
        }
    }
    async updateFragment(fragmentId, version, content) {
        const data = await this.load();
        if (!data.fragments[fragmentId]) {
            data.fragments[fragmentId] = {
                id: fragmentId,
                versions: {},
                metadata: {
                    created: new Date(),
                    modified: new Date()
                }
            };
        }
        data.fragments[fragmentId].versions[version] = content;
        data.fragments[fragmentId].metadata.modified = new Date();
        await this.save(data);
    }
    async getFragmentContent(fragmentId, version) {
        const data = await this.load();
        if (!data) {
            return null;
        }
        const fragment = data.fragments[fragmentId];
        if (!fragment) {
            return null;
        }
        return fragment.versions[version] || null;
    }
    async createVersion(name, encrypted = false, key) {
        const data = await this.load();
        if (!data) {
            throw new Error('Fragments not initialized. Run "fragments init" first.');
        }
        if (data.availableVersions.includes(name)) {
            throw new Error(`Version '${name}' already exists.`);
        }
        // Generate key ID if encrypted
        let keyId;
        if (encrypted) {
            if (!key) {
                throw new Error('Key required for encrypted version.');
            }
            keyId = `${name}-key`;
        }
        // Add version configuration
        data.versionConfig[name] = {
            name: name.charAt(0).toUpperCase() + name.slice(1),
            encrypted,
            keyId
        };
        // Add to available versions
        data.availableVersions.push(name);
        await this.save(data);
    }
    async listVersions() {
        const data = await this.load();
        if (!data) {
            return null;
        }
        const versions = data.availableVersions.map(version => ({
            name: version,
            encrypted: data.versionConfig[version]?.encrypted || false,
            keyId: data.versionConfig[version]?.keyId
        }));
        return {
            active: data.activeVersion,
            versions
        };
    }
    async switchVersion(versionName) {
        const data = await this.load();
        if (!data) {
            throw new Error('Fragments not initialized. Run "fragments init" first.');
        }
        if (!data.availableVersions.includes(versionName)) {
            throw new Error(`Version '${versionName}' does not exist. Available versions: ${data.availableVersions.join(', ')}`);
        }
        data.activeVersion = versionName;
        await this.save(data);
    }
    async updateFilesWithVersion(workingDirectory, versionName) {
        const data = await this.load();
        if (!data) {
            throw new Error('Fragments not initialized. Run "fragments init" first.');
        }
        if (!data.availableVersions.includes(versionName)) {
            throw new Error(`Version '${versionName}' does not exist. Available versions: ${data.availableVersions.join(', ')}`);
        }
        const updatedFiles = [];
        let fragmentsProcessed = 0;
        // Recursively scan for files with common code extensions
        const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.dart', '.sql', '.html', '.css', '.scss', '.less', '.vue', '.svelte'];
        const scanDirectory = (dir) => {
            if (!fs.existsSync(dir)) {
                return;
            }
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Skip common directories that shouldn't contain fragments
                    if (!['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage'].includes(entry.name)) {
                        scanDirectory(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (codeExtensions.includes(ext)) {
                        const relativePath = path.relative(workingDirectory, fullPath);
                        if (this.updateFileFragments(fullPath, versionName, data)) {
                            updatedFiles.push(relativePath);
                        }
                    }
                }
            }
        };
        scanDirectory(workingDirectory);
        // Count total fragments processed
        for (const filePath of updatedFiles) {
            const fullPath = path.join(workingDirectory, filePath);
            const content = fs.readFileSync(fullPath, 'utf-8');
            const fragments = fragmentUtils_1.FragmentUtils.parseFragmentsWithLines(content);
            fragmentsProcessed += fragments.length;
        }
        return { updatedFiles, fragmentsProcessed };
    }
    updateFileFragments(filePath, versionName, data) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fragments = fragmentUtils_1.FragmentUtils.parseFragmentsWithLines(content);
            if (fragments.length === 0) {
                return false;
            }
            let updatedContent = content;
            let hasChanges = false;
            for (const fragment of fragments) {
                const fragmentData = data.fragments[fragment.id];
                if (fragmentData && fragmentData.versions[versionName] !== undefined) {
                    const newContent = fragmentData.versions[versionName];
                    if (newContent !== fragment.currentContent) {
                        updatedContent = fragmentUtils_1.FragmentUtils.replaceFragmentContent(updatedContent, fragment.id, newContent);
                        hasChanges = true;
                    }
                }
            }
            if (hasChanges) {
                fs.writeFileSync(filePath, updatedContent, 'utf-8');
                return true;
            }
            return false;
        }
        catch (error) {
            console.warn(`Warning: Could not process file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }
}
exports.FragmentStorage = FragmentStorage;
//# sourceMappingURL=storage.js.map