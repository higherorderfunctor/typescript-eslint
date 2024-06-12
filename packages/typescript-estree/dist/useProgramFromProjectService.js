"use strict";
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
const createProjectProgram_1 = require("./create-program/createProjectProgram");
const validateDefaultProjectForFilesGlob_1 = require("./create-program/validateDefaultProjectForFilesGlob");
const log = (0, debug_1.default)('typescript-eslint:typescript-estree:useProgramFromProjectService');
const logEdits = (0, debug_1.default)('typescript-eslint:typescript-estree:useProgramFromProjectService:editContent');
const makeOpenedFilesCache = (service, parseSettings) => {
    if (!service.__opened_lru_cache) {
        if (!parseSettings.projectService?.maximumOpenFiles) {
            throw new Error('maximumOpenFiles must be set in parserOptions.projectService');
        }
        service.__opened_lru_cache = new lru_cache_1.LRUCache({
            max: parseSettings.projectService.maximumOpenFiles,
            dispose: (_, key) => {
                log(`Closing project service file: ${key}`);
                service.closeClientFile(key);
            },
        });
    }
    return service.__opened_lru_cache;
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
    // const edits: ContentEdit[] = [];
    let offset = 0;
    return changes.map(change => {
        const edit = {
            start: offset,
            end: change.added ? offset : offset + (change.count ?? 0),
            content: change.value,
        };
        if (!(change.added || change.removed)) {
            offset += change.count ?? 0;
        }
        return edit;
    });
    // delete
    // if (change.removed && change.count !== undefined) {
    //   edits.push({
    //     start: offset,
    //     end: offset + change.count,
    //     content: change.value, //'',
    //   });
    //   return;
    // }
    // // insert
    // if (change.added) {
    //   edits.push({
    //     start: offset,
    //     end: offset,
    //     content: change.value,
    //   });
    // }
    // if (change.count !== undefined) {
    //   edits.push({
    //     start: offset,
    //     end: offset + change.count,
    //     content: change.value,
    //   });
    //   offset += change.count;
    // }
    // return edits;
};
function useProgramFromProjectService({ allowDefaultProject, maximumDefaultProjectFileMatchCount, service, }, parseSettings, hasFullTypeInformation, defaultProjectMatchedFiles) {
    const openedFilesCache = makeOpenedFilesCache(service, parseSettings);
    // We don't canonicalize the filename because it caused a performance regression.
    // See https://github.com/typescript-eslint/typescript-eslint/issues/8519
    const filePathAbsolute = absolutify(parseSettings.filePath);
    const isFileInConfiguredProject = filePathMatchedByConfiguredProject(service, filePathAbsolute);
    log('Opening project service file for: %s at absolute path %s', parseSettings.filePath, filePathAbsolute);
    const isOpened = openedFilesCache.has(filePathAbsolute);
    // if (!isOpened) {
    //   if (
    //     !isFileInConfiguredProject(
    //       service,
    //       ts.server.toNormalizedPath(filePathAbsolute),
    //     )
    //   ) {
    //     log('Orphaned file: %s', filePathAbsolute);
    //     const watcher = watches.get(filePathAbsolute);
    //     if (watcher?.value != null) {
    //       log('Triggering watcher: %s', watcher.path);
    //       watcher.value.callback();
    //     } else {
    //       log('No watcher found for: %s', filePathAbsolute);
    //     }
    //   }
    // }
    // when reusing an openClientFile handler, we need to ensure that
    // the file is still open and manually update its contents
    const cachedScriptInfo = !isOpened ? undefined : service.getScriptInfo(filePathAbsolute);
    if (cachedScriptInfo) {
        log('File already opened, sending changes to tsserver: %s', filePathAbsolute);
        if (parseSettings.projectService?.incremental) {
            const start = 0;
            const end = cachedScriptInfo.getSnapshot().getLength();
            logEdits("Sending full content replacement for: %s: %o", filePathAbsolute, {
                start,
                end,
                content: parseSettings.codeFullText
            });
            cachedScriptInfo.editContent(start, end, parseSettings.codeFullText);
        }
        else {
            const snapshot = cachedScriptInfo.getSnapshot();
            const edits = makeEdits(snapshot.getText(0, snapshot.getLength()), parseSettings.codeFullText);
            edits.forEach(({ start, end, content }) => {
                logEdits("Sending edit for: %s: %o", { start, end, content });
                cachedScriptInfo.editContent(start, end, content);
            });
        }
    }
    const opened = isOpened
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            openedFilesCache.get(filePathAbsolute)
        : service.openClientFile(filePathAbsolute, parseSettings.codeFullText, 
        /* scriptKind */ undefined, parseSettings.tsconfigRootDir);
    if (isOpened) {
        log('Retrieved project service file from cache: %o', opened);
    }
    else {
        openedFilesCache.set(filePathAbsolute, opened);
        log('Opened project service file: %o', opened);
    }
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