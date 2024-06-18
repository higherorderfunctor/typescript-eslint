import path from 'node:path';
import util from 'node:util';

import debug from 'debug';
import { diffChars } from 'diff';
import { LRUCache } from 'lru-cache';
import { minimatch } from 'minimatch';
import * as ts from 'typescript';

import { createProjectProgram } from './create-program/createProjectProgram';
import type { ProjectServiceSettings } from './create-program/createProjectService';
import { watches } from './create-program/getWatchesForProjectService';
import type { ASTAndDefiniteProgram } from './create-program/shared';
import { DEFAULT_PROJECT_FILES_ERROR_EXPLANATION } from './create-program/validateDefaultProjectForFilesGlob';
import type { MutableParseSettings } from './parseSettings';

const log = debug(
  'typescript-eslint:typescript-estree:useProgramFromProjectService',
);
const logEdits = debug(
  'typescript-eslint:typescript-estree:useProgramFromProjectService:editContent',
);

const serviceFileExtensions = new WeakMap<ts.server.ProjectService, string[]>();

const updateExtraFileExtensions = (
  service: ts.server.ProjectService,
  extraFileExtensions: string[],
): void => {
  const currentServiceFileExtensions = serviceFileExtensions.get(service) ?? [];
  if (
    !util.isDeepStrictEqual(currentServiceFileExtensions, extraFileExtensions)
  ) {
    log(
      'Updating extra file extensions: before=%s: after=%s',
      currentServiceFileExtensions,
      extraFileExtensions,
    );
    service.setHostConfiguration({
      extraFileExtensions: extraFileExtensions.map(extension => ({
        extension,
        isMixedContent: false,
        scriptKind: ts.ScriptKind.Deferred,
      })),
    });
    serviceFileExtensions.set(service, extraFileExtensions);
    log('Extra file extensions updated: %o', extraFileExtensions);
  }
};

const serviceOpenFiles = new WeakMap<
  ts.server.ProjectService,
  LRUCache<string, ts.server.OpenConfiguredProjectResult>
>();

const getOrCreateOpenedFilesCache = (
  service: ts.server.ProjectService,
  options: {
    max: number;
  },
): Map<string, ts.server.OpenConfiguredProjectResult> => {
  const currentServiceOpenFiles = serviceOpenFiles.get(service);
  if (currentServiceOpenFiles) {
    return currentServiceOpenFiles;
  }
  const newServiceOpenFiles = new LRUCache<
    string,
    ts.server.OpenConfiguredProjectResult
  >({
    max: options.max,
    dispose: (_, key): void => {
      log(`Closing project service file: ${key}`);
      service.closeClientFile(key);
    },
  });
  serviceOpenFiles.set(service, newServiceOpenFiles);
  return newServiceOpenFiles;
};

const filePathMatchedByConfiguredProject = (
  service: ts.server.ProjectService,
  filePath: string,
): boolean => {
  const configuredProjects = service.configuredProjects;
  for (const project of configuredProjects.values()) {
    if (project.containsFile(filePath as ts.server.NormalizedPath)) {
      return true;
    }
  }
  return false;
};

interface ContentEdit {
  start: number;
  end: number;
  content: string;
}

const makeEdits = (oldContent: string, newContent: string): ContentEdit[] => {
  const changes = diffChars(oldContent, newContent);
  const edits: ContentEdit[] = [];

  let offset = 0;
  changes.forEach(change => {
    if (change.count === undefined) {
      return;
    }
    edits.push({
      start: offset,
      end: change.added ? offset : offset + change.count,
      content: change.removed ? '' : change.value,
    });
    if (!change.removed) {
      offset += change.count;
    }
  });
  return edits;
};

export function useProgramFromProjectService(
  {
    allowDefaultProject,
    maximumDefaultProjectFileMatchCount,
    maximumOpenFiles,
    incremental,
    service,
  }: ProjectServiceSettings,
  parseSettings: Readonly<MutableParseSettings>,
  hasFullTypeInformation: boolean,
  defaultProjectMatchedFiles: Set<string>,
): ASTAndDefiniteProgram | undefined {
  // NOTE: triggers a full project reload when changes are detected
  updateExtraFileExtensions(service, parseSettings.extraFileExtensions);

  const openedFilesCache = getOrCreateOpenedFilesCache(service, {
    max: maximumOpenFiles,
  });

  // We don't canonicalize the filename because it caused a performance regression.
  // See https://github.com/typescript-eslint/typescript-eslint/issues/8519
  const filePathAbsolute = absolutify(parseSettings.filePath);

  log(
    'Opening project service file for: %s at absolute path %s',
    parseSettings.filePath,
    filePathAbsolute,
  );

  const isOpened = openedFilesCache.has(filePathAbsolute);
  if (!isOpened) {
    if (!filePathMatchedByConfiguredProject(service, filePathAbsolute)) {
      log('Orphaned file: %s', filePathAbsolute);
      const watcher = watches.get(filePathAbsolute);
      if (watcher?.value != null) {
        log('Triggering watcher: %s', watcher.path);
        watcher.value.callback();
      } else {
        log('No watcher found for: %s', filePathAbsolute);
      }
    }
  }

  const isFileInConfiguredProject = filePathMatchedByConfiguredProject(
    service,
    filePathAbsolute,
  );

  // when reusing an openClientFile handler, we need to ensure that
  // the file is still open and manually update its contents
  const cachedScriptInfo = !isOpened
    ? undefined
    : service.getScriptInfo(filePathAbsolute);

  if (cachedScriptInfo) {
    log(
      'File already opened, sending changes to tsserver: %s',
      filePathAbsolute,
    );

    const snapshot = cachedScriptInfo.getSnapshot();
    const edits = incremental
      ? makeEdits(
          snapshot.getText(0, snapshot.getLength()),
          parseSettings.codeFullText,
        )
      : [
          {
            start: 0,
            end: snapshot.getLength(),
            content: parseSettings.codeFullText,
          },
        ];

    edits.forEach(({ start, end, content }) => {
      logEdits(
        'Sending %s edit for: %s: %o',
        incremental ? 'incremental' : 'full',
        filePathAbsolute,
        {
          start,
          end,
          content,
        },
      );
      cachedScriptInfo.editContent(start, end, content);
    });
  }

  const opened = isOpened
    ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      openedFilesCache.get(filePathAbsolute)!
    : service.openClientFile(
        filePathAbsolute,
        parseSettings.codeFullText,
        /* scriptKind */ undefined,
        parseSettings.tsconfigRootDir,
      );

  if (!isOpened) {
    openedFilesCache.set(filePathAbsolute, opened);
  }

  log(
    '%s (%s/%s): %o',
    isOpened
      ? 'Reusing project service file from cache'
      : 'Opened project service file',
    service.openFiles.size,
    maximumOpenFiles,
    opened,
  );

  if (hasFullTypeInformation) {
    log(
      'Project service type information enabled; checking for file path match on: %o',
      allowDefaultProject,
    );

    const isDefaultProjectAllowedPath = filePathMatchedBy(
      parseSettings.filePath,
      allowDefaultProject,
    );

    log(
      'Default project allowed path: %s, based on config file: %s',
      isDefaultProjectAllowedPath,
      opened.configFileName,
    );

    if (isFileInConfiguredProject && isDefaultProjectAllowedPath) {
      throw new Error(
        `${parseSettings.filePath} was included by allowDefaultProject but also was found in the project service. Consider removing it from allowDefaultProject.`,
      );
    } else if (!isDefaultProjectAllowedPath) {
      throw new Error(
        `${parseSettings.filePath} was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject.`,
      );
    }
  }

  log('Retrieving script info and then program for: %s', filePathAbsolute);

  const scriptInfo =
    cachedScriptInfo ?? service.getScriptInfo(filePathAbsolute);

  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  const program = service
    .getDefaultProjectForFile(scriptInfo!.fileName, true)!
    .getLanguageService(/*ensureSynchronized*/ true)
    .getProgram();
  /* eslint-enable @typescript-eslint/no-non-null-assertion */

  if (!program) {
    log('Could not find project service program for: %s', filePathAbsolute);
    return undefined;
  }

  if (!opened.configFileName) {
    defaultProjectMatchedFiles.add(filePathAbsolute);
  }
  if (defaultProjectMatchedFiles.size > maximumDefaultProjectFileMatchCount) {
    const filePrintLimit = 20;
    const filesToPrint = Array.from(defaultProjectMatchedFiles).slice(
      0,
      filePrintLimit,
    );
    const truncatedFileCount =
      defaultProjectMatchedFiles.size - filesToPrint.length;

    throw new Error(
      `Too many files (>${maximumDefaultProjectFileMatchCount}) have matched the default project.${DEFAULT_PROJECT_FILES_ERROR_EXPLANATION}
Matching files:
${filesToPrint.map(file => `- ${file}`).join('\n')}
${truncatedFileCount ? `...and ${truncatedFileCount} more files\n` : ''}
If you absolutely need more files included, set parserOptions.projectService.maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING to a larger value.
`,
    );
  }

  log('Found project service program for: %s', filePathAbsolute);

  return createProjectProgram(parseSettings, [program]);

  function absolutify(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.join(service.host.getCurrentDirectory(), filePath);
  }
}

function filePathMatchedBy(
  filePath: string,
  allowDefaultProject: string[] | undefined,
): boolean {
  return !!allowDefaultProject?.some(pattern => minimatch(filePath, pattern));
}
