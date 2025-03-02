// server/src/symbolProvider.ts
import {
    SymbolInformation,
    SymbolKind,
    Location,
    DocumentSymbol,
    Range
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, ListNode, SymbolNode } from './utilities/astTypes';
import { SymbolInfo } from './utilities/symbolTable';

export class SymbolProvider {
    /**
     * Provide document symbols for Outline View and Go to Symbol navigation
     */
    public provideDocumentSymbols(document: HQLDocument): SymbolInformation[] {
        const result: SymbolInformation[] = [];
        const uri = document.getUri();
        
        // Get symbols from the symbol table
        const symbolTable = document.getSymbolTable();
        const symbols = symbolTable.getAllSymbols();
        
        for (const symbol of symbols) {
            // Skip symbols without position information
            if (!symbol.node || !(symbol.node as any).position) continue;
            
            // Skip symbols from other documents
            if (symbol.kind === 'enum-value' || symbol.kind === 'parameter') continue;
            
            const position = (symbol.node as any).position;
            const location: Location = {
                uri,
                range: position
            };
            
            let kind = this.getSymbolKind(symbol.kind);
            let containerName = symbol.parentScope || '';
            
            result.push({
                name: symbol.name,
                kind,
                location,
                containerName
            });
            
            // Add enum values
            if (symbol.kind === 'enum' && symbol.enumValues) {
                for (const value of symbol.enumValues) {
                    result.push({
                        name: value,
                        kind: SymbolKind.EnumMember,
                        location,
                        containerName: symbol.name
                    });
                }
            }
            
            // Add function parameters
            if (symbol.kind === 'function' && symbol.params) {
                for (const param of symbol.params) {
                    result.push({
                        name: param.name,
                        kind: SymbolKind.Variable,
                        location,
                        containerName: symbol.name
                    });
                }
            }
        }
        
        return result;
    }
    
    /**
     * Provide workspace symbols for Go to Symbol in Workspace navigation
     */
    public provideWorkspaceSymbols(document: HQLDocument, query: string): SymbolInformation[] {
        const documentSymbols = this.provideDocumentSymbols(document);
        
        // Filter symbols based on the query
        if (!query) return documentSymbols;
        
        const lowerQuery = query.toLowerCase();
        return documentSymbols.filter(symbol => 
            symbol.name.toLowerCase().includes(lowerQuery)
        );
    }
    
    /**
     * Get the appropriate SymbolKind for a symbol type
     */
    private getSymbolKind(symbolKind: string): SymbolKind {
        switch (symbolKind) {
            case 'variable':
                return SymbolKind.Variable;
            case 'function':
                return SymbolKind.Function;
            case 'enum':
                return SymbolKind.Enum;
            case 'enum-value':
                return SymbolKind.EnumMember;
            case 'parameter':
                return SymbolKind.Variable;
            default:
                return SymbolKind.Variable;
        }
    }
    
    /**
     * Create nested document symbols hierarchy (for newer LSP clients)
     * This is a more structured representation than SymbolInformation
     */
    public provideDocumentSymbolsHierarchy(document: HQLDocument): DocumentSymbol[] {
        const result: DocumentSymbol[] = [];
        
        // Get the AST
        const ast = document.getAST();
        if (!ast) return result;
        
        // Process top-level forms
        for (const node of ast) {
            if (node.type === 'list') {
                const listNode = node as ListNode;
                
                if (listNode.elements.length > 0 && listNode.elements[0].type === 'symbol') {
                    const formName = (listNode.elements[0] as SymbolNode).name;
                    
                    // Process def, defn, and defenum forms
                    if (formName === 'def' || formName === 'defn' || formName === 'defenum') {
                        const symbol = this.processTopLevelForm(listNode, formName);
                        if (symbol) {
                            result.push(symbol);
                        }
                    }
                }
            }
        }
        
        return result;
    }
    
    /**
     * Process a top-level form (def, defn, defenum) into a DocumentSymbol
     */
    private processTopLevelForm(node: ListNode, formName: string): DocumentSymbol | null {
        // Need position information
        if (!(node as any).position) return null;
        
        if (node.elements.length < 2) return null;
        
        const nameNode = node.elements[1];
        if (nameNode.type !== 'symbol') return null;
        
        const symbolName = (nameNode as SymbolNode).name;
        const range = (node as any).position as Range;
        const selectionRange = (nameNode as any).position as Range || range;
        
        let kind: SymbolKind;
        let detail: string;
        let children: DocumentSymbol[] = [];
        
        switch (formName) {
            case 'def':
                kind = SymbolKind.Variable;
                detail = 'Variable';
                break;
            case 'defn':
                kind = SymbolKind.Function;
                detail = 'Function';
                
                // Add parameters as children
                if (node.elements.length >= 3 && node.elements[2].type === 'list') {
                    const paramList = node.elements[2] as ListNode;
                    for (const param of paramList.elements) {
                        if (param.type === 'symbol') {
                            const paramName = (param as SymbolNode).name;
                            const paramRange = (param as any).position as Range || selectionRange;
                            
                            children.push({
                                name: paramName,
                                kind: SymbolKind.Variable,
                                range: paramRange,
                                selectionRange: paramRange,
                                detail: 'Parameter'
                            });
                        }
                    }
                }
                break;
            case 'defenum':
                kind = SymbolKind.Enum;
                detail = 'Enum';
                
                // Add enum values as children
                for (let i = 2; i < node.elements.length; i++) {
                    const valueNode = node.elements[i];
                    if (valueNode.type === 'symbol') {
                        const valueName = (valueNode as SymbolNode).name;
                        const valueRange = (valueNode as any).position as Range || selectionRange;
                        
                        children.push({
                            name: valueName,
                            kind: SymbolKind.EnumMember,
                            range: valueRange,
                            selectionRange: valueRange,
                            detail: 'Enum Value'
                        });
                    }
                }
                break;
            default:
                return null;
        }
        
        return {
            name: symbolName,
            kind,
            range,
            selectionRange,
            detail,
            children
        };
    }
}