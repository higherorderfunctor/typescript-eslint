import * as ts from 'typescript';
export declare class Watcher implements ts.FileWatcher {
    private readonly node;
    readonly callback: () => void;
    constructor(node: TrieNode<Watcher>, callback: () => void);
    close(): void;
}
export declare class TrieNode<T> {
    readonly path: string;
    children: Map<string, TrieNode<T>>;
    value: T | null;
    constructor(path: string);
}
export declare class Trie<T> {
    root: TrieNode<T>;
    count: number;
    constructor();
    insert(filePath: string): TrieNode<T>;
    get(filePath: string): TrieNode<T> | null;
}
export declare const watches: Trie<Watcher>;
export declare const saveFileWatchCallback: (path: string, callback: ts.FileWatcherCallback, _pollingInterval?: number, _options?: ts.WatchOptions) => ts.FileWatcher;
export declare const saveDirectoryWatchCallback: (path: string, callback: ts.DirectoryWatcherCallback, _recursive?: boolean, _options?: ts.WatchOptions) => ts.FileWatcher;
//# sourceMappingURL=getWatchesForProjectService.d.ts.map