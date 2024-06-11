/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { debug } from 'debug';
import * as ts from 'typescript';

const log = debug(
  'typescript-eslint:typescript-estree:getWatchesForProjectService',
);

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

  insert(path: string): TrieNode<T> {
    if (!path.startsWith('/')) {
      throw new Error('absolute paths only');
    }
    const parts = path.split('/').slice(1); // drop the first empty string
    const { currentNode } = parts.reduce(
      ({ currentNode, rootPath }, part) => {
        path = `${rootPath}/${part}`;
        if (!currentNode.children.has(part)) {
          currentNode.children.set(part, new TrieNode(path));
          this.count++;
        }
        return {
          currentNode: currentNode.children.get(part)!,
          rootPath: path,
        };
      },
      {
        currentNode: this.root,
        rootPath: this.root.path,
      },
    );
    log('inserted %s (%d)', path, this.count);
    return currentNode;
  }

  get(path: string): TrieNode<T> | null {
    const parts = path.split('/');
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
    return lastNodeWithValue;
  }
}

export const watches = new Trie<Watcher>();

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
    callback(path, ts.FileWatcherEventKind.Changed, new Date());
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
