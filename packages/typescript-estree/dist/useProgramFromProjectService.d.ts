import type { ProjectServiceSettings } from './create-program/createProjectService';
import type { ASTAndDefiniteProgram } from './create-program/shared';
import type { MutableParseSettings } from './parseSettings';
export declare function useProgramFromProjectService({ allowDefaultProject, maximumDefaultProjectFileMatchCount, maximumOpenFiles, incremental, service, }: ProjectServiceSettings, parseSettings: Readonly<MutableParseSettings>, hasFullTypeInformation: boolean, defaultProjectMatchedFiles: Set<string>): ASTAndDefiniteProgram | undefined;
//# sourceMappingURL=useProgramFromProjectService.d.ts.map