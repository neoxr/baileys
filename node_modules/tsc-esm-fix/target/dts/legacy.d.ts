import { IFixOptionsNormalized } from './interface';
export declare const fixModuleReferences: (contents: string, filename: string, filenames: string[], cwd: string, ignore: string[]) => string;
export declare const fixDirnameVar: (contents: string, isSource?: boolean) => string;
export declare const fixFilenameVar: (contents: string, isSource?: boolean) => string;
export declare const fixDefaultExport: (contents: string) => string;
export declare const fixBlankFiles: (contents: string) => string;
export declare const fixSourceMapRef: (contents: string, originName: string, filename: string) => string;
export declare const fixContents: (contents: string, filename: string, filenames: string[], options: IFixOptionsNormalized, originName?: string, isSource?: boolean, ignore?: string[]) => string;
