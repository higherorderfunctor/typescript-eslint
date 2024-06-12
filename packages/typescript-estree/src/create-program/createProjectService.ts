/* eslint-disable @typescript-eslint/no-empty-function -- for TypeScript APIs*/
import path from 'node:path';

import debug from 'debug';
import type * as ts from 'typescript/lib/tsserverlibrary';

import type { ProjectServiceOptions } from '../parser-options';
import { getParsedConfigFile } from './getParsedConfigFile';
import { validateDefaultProjectForFilesGlob } from './validateDefaultProjectForFilesGlob';

const log = debug('typescript-eslint:typescript-estree:createProjectService');
const logTsserverErr = debug(
  'typescript-eslint:typescript-estree:tsserver:err',
);
const logTsserverInfo = debug(
  'typescript-eslint:typescript-estree:tsserver:info',
);
const logTsserverPerf = debug(
  'typescript-eslint:typescript-estree:tsserver:perf',
);
const logTsserverEvent = debug(
  'typescript-eslint:typescript-estree:tsserver:event',
);

const doNothing = (): void => {};

const createStubFileWatcher = (): ts.FileWatcher => ({
  close: doNothing,
});

export type TypeScriptProjectService = ts.server.ProjectService;

export interface ProjectServiceSettings {
  allowDefaultProject: string[];
  maximumDefaultProjectFileMatchCount: number;
  service: TypeScriptProjectService;
  maximumOpenFiles: number;
  editWithDiffs: boolean;
}

export interface ProjectServiceParseSettings {
  extraFileExtensions?: string[];
}

export function createProjectService(
  options: Required<ProjectServiceOptions>,
  jsDocParsingMode: ts.JSDocParsingMode | undefined,
  parseSettings?: ProjectServiceParseSettings,
): ProjectServiceSettings {
  validateDefaultProjectForFilesGlob(options);

  // We import this lazily to avoid its cost for users who don't use the service
  // TODO: Once we drop support for TS<5.3 we can import from "typescript" directly
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tsserver = require('typescript/lib/tsserverlibrary') as typeof ts;

  // TODO: see getWatchProgramsForProjects
  // We don't watch the disk, we just refer to these when ESLint calls us
  // there's a whole separate update pass in maybeInvalidateProgram at the bottom of getWatchProgramsForProjects
  // (this "goes nuclear on TypeScript")
  const system: ts.server.ServerHost = {
    ...tsserver.sys,
    clearImmediate,
    clearTimeout,
    setImmediate,
    setTimeout,
    watchDirectory: createStubFileWatcher,
    watchFile: createStubFileWatcher,
  };

  const logger: ts.server.Logger = {
    close: doNothing,
    endGroup: doNothing,
    getLogFileName: (): undefined => undefined,
    // The debug library doesn't use levels without creating a namespace for each.
    // Log levels are not passed to the writer so we wouldn't be able to forward
    // to a respective namespace.  Supporting would require an additional flag for
    // granular control.  Defaulting to all levels for now.
    hasLevel: (): boolean => true,
    info(s) {
      this.msg(s, tsserver.server.Msg.Info);
    },
    loggingEnabled: (): boolean =>
      // if none of the debug namespaces are enabled, then don't enable logging in tsserver
      logTsserverInfo.enabled ||
      logTsserverErr.enabled ||
      logTsserverPerf.enabled,
    msg: (s, type) => {
      switch (type) {
        case tsserver.server.Msg.Err:
          logTsserverErr(s);
          break;
        case tsserver.server.Msg.Perf:
          logTsserverPerf(s);
          break;
        default:
          logTsserverInfo(s);
      }
    },
    perftrc(s) {
      this.msg(s, tsserver.server.Msg.Perf);
    },
    startGroup: doNothing,
  };

  log('Creating Project Service');

  const service = new tsserver.server.ProjectService({
    host: system,
    cancellationToken: { isCancellationRequested: (): boolean => false },
    useSingleInferredProject: false,
    useInferredProjectPerProjectRoot: false,
    logger,
    eventHandler: (e): void => {
      logTsserverEvent(e);
    },
    session: undefined,
    jsDocParsingMode,
  });

  if (parseSettings?.extraFileExtensions?.length) {
    log(
      'Enabling extra file extensions: %s',
      parseSettings.extraFileExtensions,
    );
    service.setHostConfiguration({
      extraFileExtensions: parseSettings.extraFileExtensions.map(extension => ({
        extension,
        isMixedContent: false,
        scriptKind: tsserver.ScriptKind.Deferred,
      })),
    });
  }

  if (options.defaultProject) {
    log('Enabling default project: %s', options.defaultProject);
    try {
      const configFile = getParsedConfigFile(
        options.defaultProject,
        path.dirname(options.defaultProject),
      );
      service.setCompilerOptionsForInferredProjects(
        // NOTE: The inferred projects API is not intended for source files when a tsconfig
        // exists.  There is no API that generates an InferredProjectCompilerOptions suggesting
        // it is meant for hard coded options passed in.  Hard casting as a work around.
        // See https://github.com/microsoft/TypeScript/blob/27bcd4cb5a98bce46c9cdd749752703ead021a4b/src/server/protocol.ts#L1904
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        configFile.options as ts.server.protocol.InferredProjectCompilerOptions,
      );
    } catch (error) {
      throw new Error(
        `Could not parse default project '${options.defaultProject}': ${(error as Error).message}`,
      );
    }
  }

  return {
    allowDefaultProject: options.allowDefaultProject,
    maximumOpenFiles: options.maximumOpenFiles,
    editWithDiffs: options.EXPERIMENTAL_editWithDiffs,
    maximumDefaultProjectFileMatchCount:
      options.maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING,
    service,
  };
}
