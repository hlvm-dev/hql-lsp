// server/src/utilities/astTypes.ts
// Re-export the AST types from the transpiler
export { HQLNode, LiteralNode, SymbolNode, ListNode } from '../../../src/transpiler/hql_ast';

// Define additional types needed for LSP functionality
export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

// Extend the base HQL node types with position information
declare module '../../../src/transpiler/hql_ast' {
    interface HQLNode {
        position?: Range;
    }
}