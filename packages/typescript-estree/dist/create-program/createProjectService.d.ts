import type * as ts from 'typescript/lib/tsserverlibrary';
import type { ProjectServiceOptions } from '../parser-options';
export type TypeScriptProjectService = ts.server.ProjectService;
export interface ProjectServiceSettings {
    allowDefaultProject: string[] | undefined;
    maximumDefaultProjectFileMatchCount: number;
    service: TypeScriptProjectService;
}
export interface ProjectServiceParseSettings {
    extraFileExtensions?: string[];
}
export declare function createProjectService(optionsRaw: boolean | ProjectServiceOptions | undefined, jsDocParsingMode: ts.JSDocParsingMode | undefined, parseSettings?: ProjectServiceParseSettings): ProjectServiceSettings;
//# sourceMappingURL=createProjectService.d.ts.map