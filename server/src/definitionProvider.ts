// server/src/definitionProvider.ts
import {
    Location,
    Position,
    Range
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, SymbolNode, ListNode } from './utilities/astTypes';
import { SymbolInfo } from './utilities/symbolTable';

export class DefinitionProvider {
    public provideDefinition(document: HQLDocument, position: Position): Location | null {
        // Get the AST node at the current position
        const node = document.getNodeAtPosition(position);
        if (!node) return null;
        
        // If it's a symbol node, find its definition
        if (node.type === 'symbol') {
            return this.findSymbolDefinition(node as SymbolNode, document);
        }
        
        return null;
    }

    private findSymbolDefinition(node: SymbolNode, document: HQLDocument): Location | null {
        const symbolName = node.name;
        
        // Skip known built-in symbols
        if (this.isBuiltInSymbol(symbolName)) {
            return null;
        }
        
        // Look up the symbol in the symbol table
        const symbolTable = document.getSymbolTable();
        const symbol = symbolTable.findSymbol(symbolName);
        
        if (symbol) {
            return this.getLocationFromSymbolInfo(symbol, document);
        }
        
        return null;
    }

    private isBuiltInSymbol(name: string): boolean {
        // Special symbols that don't have definitions in the document
        const builtInSymbols = [
            'def', 'defn', 'fn', 'if', 'cond', 'let', 'for', 'print', 'str',
            'vector', 'list', 'hash-map', 'keyword', 'new', 'get', 'set',
            'return', 'import', 'export', 'defenum', '->',
            '+', '-', '*', '/', '<', '>', '<=', '>=', '=', '!=',
            'true', 'false', 'null', 'nil', ':', '.'
        ];
        
        return builtInSymbols.includes(name);
    }

    private getLocationFromSymbolInfo(symbol: SymbolInfo, document: HQLDocument): Location | null {
        // If the node has position information, create a location
        const node = symbol.node;
        if (node && (node as any).position) {
            const position = (node as any).position;
            
            // For function or variable definitions, we want to point to the name
            if (symbol.kind === 'function' || symbol.kind === 'variable' || symbol.kind === 'enum') {
                const listNode = node as ListNode;
                
                // The name is the second element in def/defn/defenum forms
                if (listNode.elements.length >= 2) {
                    const nameNode = listNode.elements[1];
                    if ((nameNode as any).position) {
                        return {
                            uri: document.getUri(),
                            range: (nameNode as any).position
                        };
                    }
                }
            }
            
            // Fall back to the whole node position
            return {
                uri: document.getUri(),
                range: position
            };
        }
        
        return null;
    }
}