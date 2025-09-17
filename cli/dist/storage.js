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
exports.FragmentStorage = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
class FragmentStorage {
    static isInitialized(dir = process.cwd()) {
        return fs.existsSync(path.join(dir, this.STORAGE_FILE));
    }
    static async initialize(dir = process.cwd(), versions = ['public', 'private'], activeVersion = 'public') {
        const data = {
            activeVersion,
            availableVersions: versions,
            fragments: {},
            metadata: {
                created: new Date(),
                modified: new Date(),
                version: this.SCHEMA_VERSION
            }
        };
        await this.save(data, dir);
        return data;
    }
    static async load(dir = process.cwd()) {
        const filePath = path.join(dir, this.STORAGE_FILE);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const compressed = fs.readFileSync(filePath);
        const decompressed = zlib.gunzipSync(compressed);
        const data = JSON.parse(decompressed.toString());
        if (data.metadata.created) {
            data.metadata.created = new Date(data.metadata.created);
        }
        if (data.metadata.modified) {
            data.metadata.modified = new Date(data.metadata.modified);
        }
        return data;
    }
    static async save(data, dir = process.cwd()) {
        const filePath = path.join(dir, this.STORAGE_FILE);
        data.metadata.modified = new Date();
        const json = JSON.stringify(data, null, 2);
        const compressed = zlib.gzipSync(json);
        fs.writeFileSync(filePath, compressed);
    }
    static async updateFragment(fragmentId, version, content, dir = process.cwd()) {
        const data = await this.load(dir);
        if (!data) {
            throw new Error('Fragments not initialized. Run "fragments init" first.');
        }
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
        await this.save(data, dir);
    }
    static async getFragmentContent(fragmentId, version, dir = process.cwd()) {
        const data = await this.load(dir);
        if (!data) {
            return null;
        }
        const fragment = data.fragments[fragmentId];
        if (!fragment) {
            return null;
        }
        return fragment.versions[version] || null;
    }
}
exports.FragmentStorage = FragmentStorage;
FragmentStorage.STORAGE_FILE = '.fragments';
FragmentStorage.SCHEMA_VERSION = '1.0.0';
//# sourceMappingURL=storage.js.map