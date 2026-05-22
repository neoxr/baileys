import { IFixOptions } from './interface';
export declare const fixFilenameExtensions: (names: string[], ext: string) => string[];
export declare const fix: (opts?: IFixOptions) => Promise<void>;
