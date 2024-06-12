/* eslint-disable @typescript-eslint/no-non-null-assertion */
import path from 'node:path';

import { debug } from 'debug';
import * as ts from 'typescript';

const log = debug(
  'typescript-eslint:typescript-estree:getWatchesForProjectService',
);

export class Watcher implements ts.FileWatcher {
  constructor(
    private readonly node: TrieNode<Watcher>,
    public readonly callback: () => void,
  ) {}

  close(): void {
    log('closing %s', this.node.path);
    this.node.value = null;
  }
}

export class TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  value: T | null;
  constructor(public readonly path: string) {
    this.children = new Map();
    this.value = null;
  }
}

export class Trie<T> {
  root: TrieNode<T>;
  count: number;

  constructor() {
    this.root = new TrieNode('');
    this.count = 1;
  }

  insert(filePath: string): TrieNode<T> {
    // implicitly blocks a watch on the root of the file system
    const parts = path.resolve(filePath).split(path.sep).slice(1);
    const { currentNode } = parts.reduce(
      ({ currentNode, rootPath }, part) => {
        const currentPath = path.join(rootPath, part);
        if (!currentNode.children.has(part)) {
          currentNode.children.set(part, new TrieNode(currentPath));
          this.count++;
        }
        return {
          currentNode: currentNode.children.get(part)!,
          rootPath: currentPath,
        };
      },
      {
        currentNode: this.root,
        rootPath: this.root.path,
      },
    );
    log('Inserted (%d): %s', this.count, filePath);
    return currentNode;
  }

  get(filePath: string): TrieNode<T> | null {
    const parts = path.resolve(filePath).split(path.sep).slice(1);
    const { lastNodeWithValue } = parts.reduce(
      ({ currentNode, lastNodeWithValue }, part) => {
        if (!currentNode.children.has(part)) {
          return { currentNode: currentNode, lastNodeWithValue };
        }
        const childNode = currentNode.children.get(part)!;
        return {
          currentNode: childNode,
          lastNodeWithValue:
            childNode.value != null ? childNode : lastNodeWithValue,
        };
      },
      {
        currentNode: this.root,
        lastNodeWithValue: null as TrieNode<T> | null,
      },
    );
    log(
      'Retrieved (%d): %s: %s',
      this.count,
      filePath,
      lastNodeWithValue?.path,
    );
    return lastNodeWithValue;
  }
}

export const watches = new Trie<Watcher>();

export const saveFileWatchCallback = (
  path: string,
  callback: ts.FileWatcherCallback,
  _pollingInterval?: number,
  _options?: ts.WatchOptions,
): ts.FileWatcher => {
  const node = watches.insert(path);
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

export const saveDirectoryWatchCallback = (
  path: string,
  callback: ts.DirectoryWatcherCallback,
  _recursive?: boolean,
  _options?: ts.WatchOptions,
): ts.FileWatcher => {
  const node = watches.insert(path);
  if (node.value != null) {
    return node.value;
  }
  const watcher = new Watcher(node, () => {
    callback(path);
  });
  node.value = watcher;
  return watcher;
};
