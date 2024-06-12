import type { Program } from 'typescript';
import type { Lib } from './lib';
type DebugLevel = ('eslint' | 'typescript-eslint' | 'typescript')[] | boolean;
type CacheDurationSeconds = number | 'Infinity';
type EcmaVersion = 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 'latest' | undefined;
type SourceTypeClassic = 'module' | 'script';
type SourceType = SourceTypeClassic | 'commonjs';
type JSDocParsingMode = 'all' | 'none' | 'type-info';
/**
 * Granular options to configure the project service.
 */
interface ProjectServiceOptions {
    /**
     * Globs of files to allow running with the default project compiler options
     * despite not being matched by the project service.
     */
    allowDefaultProject?: string[] | undefined;
    /**
     * Path to a TSConfig to use instead of TypeScript's default project configuration.
     */
    defaultProject?: string | undefined | null;
    /**
     * Maximum number of files to keep open with the project service.
     */
    maximumOpenFiles?: number;
    /**
     * Send changes to files as diffs instead of replacing the entire files.
     */
    EXPERIMENTAL_editWithDiffs?: boolean;
    /**
     * The maximum number of files {@link allowDefaultProject} may match.
     * Each file match slows down linting, so if you do need to use this, please
     * file an informative issue on typescript-eslint explaining why - so we can
     * help you avoid using it!
     * @default 8
     */
    maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING?: number;
}
interface ParserOptions {
    ecmaFeatures?: {
        globalReturn?: boolean | undefined;
        jsx?: boolean | undefined;
        [key: string]: unknown;
    } | undefined;
    ecmaVersion?: EcmaVersion;
    jsxPragma?: string | null;
    jsxFragmentName?: string | null;
    lib?: Lib[];
    emitDecoratorMetadata?: boolean;
    experimentalDecorators?: boolean;
    debugLevel?: DebugLevel;
    errorOnTypeScriptSyntacticAndSemanticIssues?: boolean;
    errorOnUnknownASTType?: boolean;
    extraFileExtensions?: string[];
    filePath?: string;
    jsDocParsingMode?: JSDocParsingMode;
    programs?: Program[] | null;
    project?: string[] | string | boolean | null;
    projectFolderIgnoreList?: string[];
    projectService?: boolean | ProjectServiceOptions;
    range?: boolean;
    sourceType?: SourceType | undefined;
    tokens?: boolean;
    tsconfigRootDir?: string;
    warnOnUnsupportedTypeScriptVersion?: boolean;
    cacheLifetime?: {
        glob?: CacheDurationSeconds;
    };
    [additionalProperties: string]: unknown;
}
export { CacheDurationSeconds, DebugLevel, EcmaVersion, JSDocParsingMode, ParserOptions, ProjectServiceOptions, SourceType, };
//# sourceMappingURL=parser-options.d.ts.map