// server/src/utilities/astTypes.ts
import { Position, Range } from 'vscode-languageserver';

// Define HQL AST node types directly rather than importing
export interface HQLNode {
    type: string;
    position?: Range;
}

export interface LiteralNode extends HQLNode {
    type: "literal";
    value: string | number | boolean | null;
}

export interface SymbolNode extends HQLNode {
    type: "symbol";
    name: string;
}

export interface ListNode extends HQLNode {
    type: "list";
    elements: HQLNode[];
    isArrayLiteral?: boolean;
}