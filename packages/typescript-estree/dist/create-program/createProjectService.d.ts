import type * as ts from 'typescript/lib/tsserverlibrary';
import type { ProjectServiceOptions } from '../parser-options';
export type TypeScriptProjectService = ts.server.ProjectService;
export interface ProjectServiceSettings {
    allowDefaultProject: string[] | undefined;
    maximumDefaultProjectFileMatchCount: number;
    service: TypeScriptProjectService;
    maximumOpenFiles: number;
    incremental: boolean;
}
export declare function createProjectService(options: Required<ProjectServiceOptions>, jsDocParsingMode: ts.JSDocParsingMode | undefined): ProjectServiceSettings;
//# sourceMappingURL=createProjectService.d.ts.map