"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProjectService = void 0;
/* eslint-disable @typescript-eslint/no-empty-function -- for TypeScript APIs*/
const node_path_1 = __importDefault(require("node:path"));
const debug_1 = __importDefault(require("debug"));
const getParsedConfigFile_1 = require("./getParsedConfigFile");
const getWatchesForProjectService_1 = require("./getWatchesForProjectService");
const validateDefaultProjectForFilesGlob_1 = require("./validateDefaultProjectForFilesGlob");
const log = (0, debug_1.default)('typescript-eslint:typescript-estree:createProjectService');
const logTsserverErr = (0, debug_1.default)('typescript-eslint:typescript-estree:tsserver:err');
const logTsserverInfo = (0, debug_1.default)('typescript-eslint:typescript-estree:tsserver:info');
const logTsserverPerf = (0, debug_1.default)('typescript-eslint:typescript-estree:tsserver:perf');
const logTsserverEvent = (0, debug_1.default)('typescript-eslint:typescript-estree:tsserver:event');
const doNothing = () => { };
function createProjectService(options, jsDocParsingMode, parseSettings) {
    (0, validateDefaultProjectForFilesGlob_1.validateDefaultProjectForFilesGlob)(options);
    // We import this lazily to avoid its cost for users who don't use the service
    // TODO: Once we drop support for TS<5.3 we can import from "typescript" directly
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tsserver = require('typescript/lib/tsserverlibrary');
    // TODO: see getWatchProgramsForProjects
    // We don't watch the disk, we just refer to these when ESLint calls us
    // there's a whole separate update pass in maybeInvalidateProgram at the bottom of getWatchProgramsForProjects
    // (this "goes nuclear on TypeScript")
    const system = {
        ...tsserver.sys,
        clearImmediate,
        clearTimeout,
        setImmediate,
        setTimeout,
        watchDirectory: getWatchesForProjectService_1.saveDirectoryWatchCallback,
        watchFile: getWatchesForProjectService_1.saveFileWatchCallback,
    };
    const logger = {
        close: doNothing,
        endGroup: doNothing,
        getLogFileName: () => undefined,
        // The debug library doesn't use levels without creating a namespace for each.
        // Log levels are not passed to the writer so we wouldn't be able to forward
        // to a respective namespace.  Supporting would require an additional flag for
        // granular control.  Defaulting to all levels for now.
        hasLevel: () => true,
        info(s) {
            this.msg(s, tsserver.server.Msg.Info);
        },
        loggingEnabled: () => 
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
        cancellationToken: { isCancellationRequested: () => false },
        useSingleInferredProject: false,
        useInferredProjectPerProjectRoot: false,
        logger,
        eventHandler: logTsserverEvent.enabled
            ? (e) => {
                logTsserverEvent(e);
            }
            : undefined,
        session: undefined,
        canUseWatchEvents: true,
        jsDocParsingMode,
    });
    log('Parse Settings: %o', parseSettings);
    if (parseSettings?.extraFileExtensions?.length) {
        log('Enabling extra file extensions: %s', parseSettings.extraFileExtensions);
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
            const configFile = (0, getParsedConfigFile_1.getParsedConfigFile)(options.defaultProject, node_path_1.default.dirname(options.defaultProject));
            service.setCompilerOptionsForInferredProjects(
            // NOTE: The inferred projects API is not intended for source files when a tsconfig
            // exists.  There is no API that generates an InferredProjectCompilerOptions suggesting
            // it is meant for hard coded options passed in.  Hard casting as a work around.
            // See https://github.com/microsoft/TypeScript/blob/27bcd4cb5a98bce46c9cdd749752703ead021a4b/src/server/protocol.ts#L1904
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            configFile.options);
        }
        catch (error) {
            throw new Error(`Could not parse default project '${options.defaultProject}': ${error.message}`);
        }
    }
    return {
        allowDefaultProject: options.allowDefaultProject,
        maximumOpenFiles: options.maximumOpenFiles,
        incremental: options.incremental,
        maximumDefaultProjectFileMatchCount: options.maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING,
        service,
    };
}
exports.createProjectService = createProjectService;
//# sourceMappingURL=createProjectService.js.map