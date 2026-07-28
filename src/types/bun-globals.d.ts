interface ImportMeta {
  dir: string;
}

declare const Bun: any;
type ServerWebSocket<_T = any> = any;

declare module 'bun:sqlite' {
  export class Database {
    constructor(filename?: string, options?: any);
    exec(query: string): void;
    run(query: string, ...params: any[]): any;
    prepare(query: string): any;
    close(): void;
  }
}
