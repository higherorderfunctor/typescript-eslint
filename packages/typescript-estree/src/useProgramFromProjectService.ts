import debug from 'debug';
import { Path } from 'glob';
import { minimatch } from 'minimatch';
import path from 'path';
import * as ts from 'typescript';
import { inspect } from 'util';

import { createProjectProgram } from './create-program/createProjectProgram';
import type { ProjectServiceSettings } from './create-program/createProjectService';
import { watches } from './create-program/getWatchesForProjectService';
import type { ASTAndDefiniteProgram } from './create-program/shared';
import { getAstFromProgram } from './create-program/shared';
import { DEFAULT_PROJECT_FILES_ERROR_EXPLANATION } from './create-program/validateDefaultProjectForFilesGlob';
import type { MutableParseSettings } from './parseSettings';

const log = debug(
  'typescript-eslint:typescript-estree:useProgramFromProjectService',
);

const openedFilesCache = new Map<
  string,
  ts.server.OpenConfiguredProjectResult
>();
const programCache = new Map<string, ts.Program>();
const hostExtraFileExtensionsCache = new Set<string>();

const isFileInConfiguredProject = (
  service: ts.server.ProjectService,
  filePath: ts.server.NormalizedPath,
): boolean => {
  const configuredProjects = service.configuredProjects;
  for (const project of configuredProjects.values()) {
    if (project.containsFile(filePath)) {
      return true;
    }
  }
  return false;
};

export function useProgramFromProjectService(
  {
    allowDefaultProject,
    maximumDefaultProjectFileMatchCount,
    service,
  }: ProjectServiceSettings,
  parseSettings: Readonly<MutableParseSettings>,
  hasFullTypeInformation: boolean,
  defaultProjectMatchedFiles: Set<string>,
): ASTAndDefiniteProgram | undefined {
  // We don't canonicalize the filename because it caused a performance regression.
  // See https://github.com/typescript-eslint/typescript-eslint/issues/8519
  const filePathAbsolute = absolutify(parseSettings.filePath);

  log(
    'Opening project service file for: %s at absolute path %s',
    parseSettings.filePath,
    filePathAbsolute,
  );

  if (parseSettings.extraFileExtensions.length) {
    log('Adjusting extensions');
    const extensions = parseSettings.extraFileExtensions.filter(extension => {
      if (!hostExtraFileExtensionsCache.has(extension)) {
        log('Adding extension: %s', extension);
        hostExtraFileExtensionsCache.add(extension);
        return true;
      }
      return false;
    });
    if (extensions.length) {
      service.setHostConfiguration({
        extraFileExtensions: extensions.map(extension => ({
          extension,
          isMixedContent: false,
          scriptKind: ts.ScriptKind.Deferred,
        })),
      });
    }
  }

  log('Getting script info for: %s', filePathAbsolute);
  const cachedScriptInfo = service.getScriptInfo(filePathAbsolute);

  if (cachedScriptInfo) {
    log(
      'File already opened, sending changes to tsserver: %s',
      filePathAbsolute,
    );

    cachedScriptInfo.editContent(
      0,
      cachedScriptInfo.getSnapshot().getLength(),
      parseSettings.codeFullText,
    );

    // const program = programCache.get(filePathAbsolute);
    // if (program) {
    //   log('Using cached program to get AST: %s', filePathAbsolute);
    //   const ast = getAstFromProgram(program, filePathAbsolute);
    //   if (ast) {
    //     log('Using AST from cached program: %s', filePathAbsolute);
    //     log("AST: %s", inspect(ast, { depth: 10 }));
    //     return ast;
    //   }
    //   log('Failed to get AST from cached program: %s', filePathAbsolute);
    // } else {
    //   log('Cached program not found: %s', filePathAbsolute);
    // }
  }

  const isOpened = openedFilesCache.has(filePathAbsolute);
  if (!isOpened) {
    if (
      !isFileInConfiguredProject(
        service,
        ts.server.toNormalizedPath(filePathAbsolute),
      )
    ) {
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

  const opened = isOpened
    ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      openedFilesCache.get(filePathAbsolute)!
    : service.openClientFile(
        filePathAbsolute,
        parseSettings.codeFullText,
        /* scriptKind */ undefined,
        parseSettings.tsconfigRootDir,
      );

  // if (!isOpened) {
  log('Opened project service file: %o', opened);
  openedFilesCache.set(filePathAbsolute, opened);
  // } else {
  //   log('Retrieved project service file from cache: %o', opened);
  // }

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

    if (opened.configFileName) {
      if (isDefaultProjectAllowedPath) {
        throw new Error(
          `${parseSettings.filePath} was included by allowDefaultProject but also was found in the project service. Consider removing it from allowDefaultProject.`,
        );
      }
    } else if (!isDefaultProjectAllowedPath) {
      throw new Error(
        `${parseSettings.filePath} was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject.`,
      );
    }
  }

  log('Retrieving script info and then program for: %s', filePathAbsolute);

  const scriptInfo = service.getScriptInfo(filePathAbsolute);

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

  log('Setting program cache for: %s', filePathAbsolute);
  programCache.set(filePathAbsolute, program);

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
