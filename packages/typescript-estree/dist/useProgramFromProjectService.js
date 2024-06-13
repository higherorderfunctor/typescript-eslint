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
exports.useProgramFromProjectService = void 0;
const debug_1 = __importDefault(require("debug"));
const diff_1 = require("diff");
const lru_cache_1 = require("lru-cache");
const minimatch_1 = require("minimatch");
const path_1 = __importDefault(require("path"));
const ts = __importStar(require("typescript"));
const createProjectProgram_1 = require("./create-program/createProjectProgram");
const getWatchesForProjectService_1 = require("./create-program/getWatchesForProjectService");
const validateDefaultProjectForFilesGlob_1 = require("./create-program/validateDefaultProjectForFilesGlob");
const log = (0, debug_1.default)('typescript-eslint:typescript-estree:useProgramFromProjectService');
const logEdits = (0, debug_1.default)('typescript-eslint:typescript-estree:useProgramFromProjectService:editContent');
const getOrCreateOpenedFilesCache = (service, options) => {
    if (!service.__opened_lru_cache) {
        service.__opened_lru_cache = new lru_cache_1.LRUCache({
            max: options.max,
            dispose: (_, key) => {
                log(`Closing project service file: ${key}`);
                service.closeClientFile(key);
            },
        });
    }
    return service.__opened_lru_cache;
};
const union = (self, other) => new Set([...self, ...other]);
const difference = (self, other) => new Set([...self].filter(elem => !other.has(elem)));
const symmetricDifference = (self, other) => union(difference(self, other), difference(other, self));
const updateExtraFileExtensions = (service, extraFileExtensions) => {
    if (!service.__extra_file_extensions) {
        service.__extra_file_extensions = new Set();
    }
    if (symmetricDifference(service.__extra_file_extensions, new Set(extraFileExtensions)).size > 0) {
        service.__extra_file_extensions = new Set(extraFileExtensions);
        log('Updating extra file extensions: %s', extraFileExtensions);
        service.setHostConfiguration({
            extraFileExtensions: extraFileExtensions.map(extension => ({
                extension,
                isMixedContent: false,
                scriptKind: ts.ScriptKind.Deferred,
            })),
        });
        log('Extra file extensions updated: %o', service.__extra_file_extensions);
    }
};
const filePathMatchedByConfiguredProject = (service, filePath) => {
    const configuredProjects = service.configuredProjects;
    for (const project of configuredProjects.values()) {
        if (project.containsFile(filePath)) {
            return true;
        }
    }
    return false;
};
const makeEdits = (oldContent, newContent) => {
    const changes = (0, diff_1.diffChars)(oldContent, newContent);
    const edits = [];
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
function useProgramFromProjectService({ allowDefaultProject, maximumDefaultProjectFileMatchCount, maximumOpenFiles, incremental, service, }, parseSettings, hasFullTypeInformation, defaultProjectMatchedFiles) {
    // NOTE: triggers a full project reload when changes are detected
    updateExtraFileExtensions(service, parseSettings.extraFileExtensions);
    const openedFilesCache = getOrCreateOpenedFilesCache(service, {
        max: maximumOpenFiles,
    });
    // We don't canonicalize the filename because it caused a performance regression.
    // See https://github.com/typescript-eslint/typescript-eslint/issues/8519
    const filePathAbsolute = absolutify(parseSettings.filePath);
    log('Opening project service file for: %s at absolute path %s', parseSettings.filePath, filePathAbsolute);
    const isOpened = openedFilesCache.has(filePathAbsolute);
    if (!isOpened) {
        if (!filePathMatchedByConfiguredProject(service, filePathAbsolute)) {
            log('Orphaned file: %s', filePathAbsolute);
            const watcher = getWatchesForProjectService_1.watches.get(filePathAbsolute);
            if (watcher?.value != null) {
                log('Triggering watcher: %s', watcher.path);
                watcher.value.callback();
            }
            else {
                log('No watcher found for: %s', filePathAbsolute);
            }
        }
    }
    const isFileInConfiguredProject = filePathMatchedByConfiguredProject(service, filePathAbsolute);
    // when reusing an openClientFile handler, we need to ensure that
    // the file is still open and manually update its contents
    const cachedScriptInfo = !isOpened
        ? undefined
        : service.getScriptInfo(filePathAbsolute);
    if (cachedScriptInfo) {
        log('File already opened, sending changes to tsserver: %s', filePathAbsolute);
        const snapshot = cachedScriptInfo.getSnapshot();
        const edits = incremental
            ? makeEdits(snapshot.getText(0, snapshot.getLength()), parseSettings.codeFullText)
            : [
                {
                    start: 0,
                    end: snapshot.getLength(),
                    content: parseSettings.codeFullText,
                },
            ];
        edits.forEach(({ start, end, content }) => {
            logEdits('Sending %s edit for: %s: %o', incremental ? 'incremental' : 'full', filePathAbsolute, {
                start,
                end,
                content,
            });
            cachedScriptInfo.editContent(start, end, content);
        });
    }
    const opened = isOpened
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            openedFilesCache.get(filePathAbsolute)
        : service.openClientFile(filePathAbsolute, parseSettings.codeFullText, 
        /* scriptKind */ undefined, parseSettings.tsconfigRootDir);
    if (!isOpened) {
        openedFilesCache.set(filePathAbsolute, opened);
    }
    log('%s (%s/%s): %o', isOpened
        ? 'Reusing project service file from cache'
        : 'Opened project service file', service.openFiles.size, maximumOpenFiles, opened);
    if (hasFullTypeInformation) {
        log('Project service type information enabled; checking for file path match on: %o', allowDefaultProject);
        const isDefaultProjectAllowedPath = filePathMatchedBy(parseSettings.filePath, allowDefaultProject);
        log('Default project allowed path: %s, based on config file: %s', isDefaultProjectAllowedPath, opened.configFileName);
        if (isFileInConfiguredProject && isDefaultProjectAllowedPath) {
            throw new Error(`${parseSettings.filePath} was included by allowDefaultProject but also was found in the project service. Consider removing it from allowDefaultProject.`);
        }
        else if (!isDefaultProjectAllowedPath) {
            throw new Error(`${parseSettings.filePath} was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject.`);
        }
    }
    log('Retrieving script info and then program for: %s', filePathAbsolute);
    const scriptInfo = cachedScriptInfo ?? service.getScriptInfo(filePathAbsolute);
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    const program = service
        .getDefaultProjectForFile(scriptInfo.fileName, true)
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
        const filesToPrint = Array.from(defaultProjectMatchedFiles).slice(0, filePrintLimit);
        const truncatedFileCount = defaultProjectMatchedFiles.size - filesToPrint.length;
        throw new Error(`Too many files (>${maximumDefaultProjectFileMatchCount}) have matched the default project.${validateDefaultProjectForFilesGlob_1.DEFAULT_PROJECT_FILES_ERROR_EXPLANATION}
Matching files:
${filesToPrint.map(file => `- ${file}`).join('\n')}
${truncatedFileCount ? `...and ${truncatedFileCount} more files\n` : ''}
If you absolutely need more files included, set parserOptions.projectService.maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING to a larger value.
`);
    }
    log('Found project service program for: %s', filePathAbsolute);
    return (0, createProjectProgram_1.createProjectProgram)(parseSettings, [program]);
    function absolutify(filePath) {
        return path_1.default.isAbsolute(filePath)
            ? filePath
            : path_1.default.join(service.host.getCurrentDirectory(), filePath);
    }
}
exports.useProgramFromProjectService = useProgramFromProjectService;
function filePathMatchedBy(filePath, allowDefaultProject) {
    return !!allowDefaultProject?.some(pattern => (0, minimatch_1.minimatch)(filePath, pattern));
}
//# sourceMappingURL=useProgramFromProjectService.js.map