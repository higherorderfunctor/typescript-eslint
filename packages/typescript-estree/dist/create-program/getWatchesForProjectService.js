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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveDirectoryWatchCallback = exports.saveFileWatchCallback = exports.watches = exports.Trie = exports.TrieNode = exports.Watcher = void 0;
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const node_path_1 = __importDefault(require("node:path"));
const debug_1 = require("debug");
const ts = __importStar(require("typescript"));
const log = (0, debug_1.debug)('typescript-eslint:typescript-estree:getWatchesForProjectService');
class Watcher {
    node;
    callback;
    constructor(node, callback) {
        this.node = node;
        this.callback = callback;
    }
    close() {
        log('closing %s', this.node.path);
        this.node.value = null;
    }
}
exports.Watcher = Watcher;
class TrieNode {
    path;
    children;
    value;
    constructor(path) {
        this.path = path;
        this.children = new Map();
        this.value = null;
    }
}
exports.TrieNode = TrieNode;
class Trie {
    root;
    count;
    constructor() {
        this.root = new TrieNode('');
        this.count = 1;
    }
    insert(filePath) {
        // implicitly blocks a watch on the root of the file system
        const parts = node_path_1.default.resolve(filePath).split(node_path_1.default.sep).slice(1);
        const { currentNode } = parts.reduce(({ currentNode, rootPath }, part) => {
            const currentPath = node_path_1.default.join(rootPath, part);
            if (!currentNode.children.has(part)) {
                currentNode.children.set(part, new TrieNode(currentPath));
                this.count++;
            }
            return {
                currentNode: currentNode.children.get(part),
                rootPath: currentPath,
            };
        }, {
            currentNode: this.root,
            rootPath: this.root.path,
        });
        log('Inserted (%d): %s', this.count, filePath);
        return currentNode;
    }
    get(filePath) {
        const parts = node_path_1.default.resolve(filePath).split(node_path_1.default.sep).slice(1);
        const { lastNodeWithValue } = parts.reduce(({ currentNode, lastNodeWithValue }, part) => {
            if (!currentNode.children.has(part)) {
                return { currentNode: currentNode, lastNodeWithValue };
            }
            const childNode = currentNode.children.get(part);
            return {
                currentNode: childNode,
                lastNodeWithValue: childNode.value != null ? childNode : lastNodeWithValue,
            };
        }, {
            currentNode: this.root,
            lastNodeWithValue: null,
        });
        log('Retrieved (%d): %s: %s', this.count, filePath, lastNodeWithValue?.path);
        return lastNodeWithValue;
    }
}
exports.Trie = Trie;
exports.watches = new Trie();
const saveFileWatchCallback = (path, callback, _pollingInterval, _options) => {
    const node = exports.watches.insert(path);
    if (node.value != null) {
        return node.value;
    }
    const watcher = new Watcher(node, () => {
        // edits are sent through script info, this is only used for new files
        callback(path, ts.FileWatcherEventKind.Created, new Date());
    });
    node.value = watcher;
    return watcher;
};
exports.saveFileWatchCallback = saveFileWatchCallback;
const saveDirectoryWatchCallback = (path, callback, _recursive, _options) => {
    const node = exports.watches.insert(path);
    if (node.value != null) {
        return node.value;
    }
    const watcher = new Watcher(node, () => {
        callback(path);
    });
    node.value = watcher;
    return watcher;
};
exports.saveDirectoryWatchCallback = saveDirectoryWatchCallback;
//# sourceMappingURL=getWatchesForProjectService.js.map