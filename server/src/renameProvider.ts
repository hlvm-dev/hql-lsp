// server/src/renameProvider.ts
import {
    WorkspaceEdit,
    TextEdit,
    Position,
    Range
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, SymbolNode, ListNode } from './utilities/astTypes';
import { SymbolInfo } from './utilities/symbolTable';

export class RenameProvider {
    /**
     * Provide rename edits for symbols
     */
    public provideRenameEdits(document: HQLDocument, position: Position, newName: string): WorkspaceEdit | null {
        // Get the node at the position
        const node = document.getNodeAtPosition(position);
        if (!node || node.type !== 'symbol') return null;
        
        const symbolNode = node as SymbolNode;
        const symbolName = symbolNode.name;
        
        // Skip known built-in symbols
        if (this.isBuiltInSymbol(symbolName)) {
            return null;
        }
        
        // Look up the symbol in the symbol table
        const symbolTable = document.getSymbolTable();
        const symbol = symbolTable.findSymbol(symbolName);
        
        if (!symbol) return null;
        
        // Collect all locations where the symbol is used
        const locations = this.collectSymbolLocations(symbol, document);
        if (locations.length === 0) return null;
        
        // Create text edits for each location
        const changes: { [uri: string]: TextEdit[] } = {};
        const uri = document.getUri();
        
        changes[uri] = locations.map(range => TextEdit.replace(range, newName));
        
        return { changes };
    }
    
    /**
     * Check if a symbol is a built-in symbol
     */
    private isBuiltInSymbol(name: string): boolean {
        // Special symbols that shouldn't be renamed
        const builtInSymbols = [
            'def', 'defn', 'fn', 'if', 'cond', 'let', 'for', 'print', 'str',
            'vector', 'list', 'hash-map', 'keyword', 'new', 'get', 'set',
            'return', 'import', 'export', 'defenum', '->',
            '+', '-', '*', '/', '<', '>', '<=', '>=', '=', '!=',
            'true', 'false', 'null', 'nil', ':', '.'
        ];
        
        return builtInSymbols.includes(name);
    }
    
    /**
     * Collect all locations where a symbol is used
     */
    private collectSymbolLocations(symbol: SymbolInfo, document: HQLDocument): Range[] {
        const locations: Range[] = [];
        
        // Add the definition location
        const node = symbol.node;
        if (node && (node as any).position) {
            // For def/defn/defenum forms, we want to focus on the name rather than the whole form
            if (symbol.kind === 'function' || symbol.kind === 'variable' || symbol.kind === 'enum') {
                const listNode = node as ListNode;
                
                // The name is the second element in def/defn/defenum forms
                if (listNode.elements.length >= 2 && listNode.elements[1].type === 'symbol') {
                    const nameNode = listNode.elements[1] as SymbolNode;
                    if ((nameNode as any).position) {
                        locations.push((nameNode as any).position);
                    }
                }
            } else {
                // For other kinds of symbols, use the node's position
                locations.push((node as any).position);
            }
        }
        
        // Add reference locations
        if (symbol.references) {
            for (const ref of symbol.references) {
                if ((ref as any).position) {
                    locations.push((ref as any).position);
                }
            }
        }
        
        return locations;
    }
}