// server/src/hqlDocument.ts
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range } from 'vscode-languageserver/node';
import { parse, ParseError } from './utilities/parser';
import { HQLNode, ListNode, SymbolNode, LiteralNode } from './utilities/astTypes';
import { SymbolTable, SymbolInfo } from './utilities/symbolTable';
import { Logger } from './utilities/logger';
import { ASTIndex } from './utilities/astIndex';

/**
 * Class that manages a HQL document: its content, AST, and metadata
 */
export class HQLDocument {
    private uri: string;
    private version: number;
    private content: string;
    private ast: HQLNode[] | null;
    private parseError: any | null;
    private symbolTable: SymbolTable;
    private lineOffsets: number[] | undefined;
    private logger: Logger;
    private astIndex: ASTIndex;
    private parsingTimestamp: number = 0;
    private dirty: boolean = false;
    
    // Performance tracking
    private parseTime: number = 0;
    private symbolTableTime: number = 0;
    
    constructor(document: TextDocument, logger: Logger) {
        this.uri = document.uri;
        this.version = document.version;
        this.content = document.getText();
        this.ast = null;
        this.parseError = null;
        this.symbolTable = new SymbolTable();
        this.lineOffsets = undefined;
        this.logger = logger;
        this.astIndex = new ASTIndex();
        
        this.parse();
    }

    /**
     * Update the document with a new version
     */
    public update(document: TextDocument): void {
        // If the document hasn't changed (version is the same or older), skip update
        if (document.version <= this.version) return;
        
        this.version = document.version;
        this.content = document.getText();
        this.lineOffsets = undefined;
        this.dirty = true;
        
        // Defer parsing until it's actually needed (lazy parsing)
        // This allows multiple rapid edits without parsing overhead
    }

    /**
     * Ensure the document is parsed and indexed
     */
    private ensureParsed(): void {
        if (this.dirty) {
            this.parse();
            this.dirty = false;
        }
    }

    /**
     * Get document content
     */
    public getContent(): string {
        return this.content;
    }

    /**
     * Get document URI
     */
    public getUri(): string {
        return this.uri;
    }

    /**
     * Get document version
     */
    public getVersion(): number {
        return this.version;
    }

    /**
     * Get the AST (parsing if needed)
     */
    public getAST(): HQLNode[] | null {
        this.ensureParsed();
        return this.ast;
    }

    /**
     * Get parse error if any
     */
    public getParseError(): any | null {
        this.ensureParsed();
        return this.parseError;
    }

    /**
     * Get the symbol table (parsing if needed)
     */
    public getSymbolTable(): SymbolTable {
        this.ensureParsed();
        return this.symbolTable;
    }

    /**
     * Get text from the document, optionally within a range
     */
    public getText(range?: Range): string {
        if (!range) {
            return this.content;
        }
        
        const start = this.offsetAt(range.start);
        const end = this.offsetAt(range.end);
        
        return this.content.substring(start, end);
    }

    /**
     * Convert a Position to an offset in the document
     */
    public offsetAt(position: Position): number {
        let lineOffsets = this.getLineOffsets();
        if (position.line >= lineOffsets.length) {
            return this.content.length;
        }
        
        if (position.line < 0) {
            return 0;
        }
        
        let lineOffset = lineOffsets[position.line];
        let nextLineOffset = (position.line + 1 < lineOffsets.length) ? lineOffsets[position.line + 1] : this.content.length;
        
        return Math.min(lineOffset + position.character, nextLineOffset);
    }

    /**
     * Convert an offset to a Position in the document
     */
    public positionAt(offset: number): Position {
        offset = Math.max(Math.min(offset, this.content.length), 0);
        
        let lineOffsets = this.getLineOffsets();
        let low = 0, high = lineOffsets.length;
        if (high === 0) {
            return { line: 0, character: offset };
        }
        
        while (low < high) {
            let mid = Math.floor((low + high) / 2);
            if (lineOffsets[mid] > offset) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        
        // low is the line number now
        let line = low - 1;
        return { line, character: offset - lineOffsets[line] };
    }

    /**
     * Get the line offsets (cached)
     */
    private getLineOffsets(): number[] {
        if (this.lineOffsets === undefined) {
            // This is a performance critical operation, so we optimize it
            const text = this.content;
            const result: number[] = [];
            let isLineStart = true;
            
            for (let i = 0; i < text.length; i++) {
                if (isLineStart) {
                    result.push(i);
                    isLineStart = false;
                }
                
                const ch = text.charAt(i);
                isLineStart = ch === '\r' || ch === '\n';
                if (ch === '\r' && i + 1 < text.length && text.charAt(i + 1) === '\n') {
                    i++;
                }
            }
            
            if (isLineStart && text.length > 0) {
                result.push(text.length);
            }
            
            this.lineOffsets = result;
        }
        
        return this.lineOffsets;
    }

    /**
     * Parse the document and build AST and symbol table
     */
    private parse(): void {
        const startTime = Date.now();
        this.parsingTimestamp = startTime;
        
        try {
            // Parse the document
            const parseStartTime = Date.now();
            this.ast = parse(this.content);
            this.parseError = null;
            this.parseTime = Date.now() - parseStartTime;
            
            // Reset and build the AST index
            const indexStartTime = Date.now();
            this.astIndex.build(this.ast, this);
            const indexTime = Date.now() - indexStartTime;
            
            // Reset and rebuild symbol table
            const symbolTableStartTime = Date.now();
            this.symbolTable.clear();
            this.buildSymbolTable();
            this.symbolTableTime = Date.now() - symbolTableStartTime;
            
            const totalTime = Date.now() - startTime;
            this.logger.log(`Parsed ${this.uri} (v${this.version}) in ${totalTime}ms: ` +
                      `parsing=${this.parseTime}ms, indexing=${indexTime}ms, symbols=${this.symbolTableTime}ms`);
            
        } catch (error) {
            this.ast = null;
            this.parseError = error;
            this.symbolTable.clear();
            this.astIndex.clear();
            
            this.logger.error(`Failed to parse ${this.uri}: ${error}`);
        }
    }

    /**
     * Build the symbol table from the AST
     */
    private buildSymbolTable(): void {
        if (!this.ast) return;
        
        // First pass: collect definitions
        for (const node of this.ast) {
            if (this.isDefOrDefnNode(node)) {
                this.processDefinition(node as ListNode);
            }
        }
        
        // Second pass: resolve references and detect scopes
        for (const node of this.ast) {
            this.processReferences(node);
        }
    }

    /**
     * Check if a node is a definition node (def, defn, defenum)
     */
    private isDefOrDefnNode(node: HQLNode): boolean {
        if (node.type !== 'list') return false;
        
        const listNode = node as ListNode;
        if (listNode.elements.length < 2) return false;
        
        const firstElement = listNode.elements[0];
        if (firstElement.type !== 'symbol') return false;
        
        const symbolNode = firstElement as SymbolNode;
        return symbolNode.name === 'def' || symbolNode.name === 'defn' || symbolNode.name === 'defenum';
    }

    /**
     * Process a definition node and add it to the symbol table
     */
    private processDefinition(node: ListNode): void {
        const firstElement = node.elements[0] as SymbolNode;
        
        if (firstElement.name === 'def' && node.elements.length >= 3) {
            // Process def
            const varNameNode = node.elements[1];
            if (varNameNode.type === 'symbol') {
                const symbolNode = varNameNode as SymbolNode;
                this.symbolTable.addVariable(symbolNode.name, node);
            }
        } else if (firstElement.name === 'defn' && node.elements.length >= 4) {
            // Process defn
            const fnNameNode = node.elements[1];
            if (fnNameNode.type === 'symbol') {
                const symbolNode = fnNameNode as SymbolNode;
                // Extract parameter info
                const paramsNode = node.elements[2] as ListNode;
                const params = this.extractFunctionParams(paramsNode);
                
                // Check for return type annotation
                let returnType = null;
                let bodyIndex = 3;
                
                // Look for "-> ReturnType" annotation
                if (node.elements.length > 4 &&
                    node.elements[3].type === 'symbol' && 
                    (node.elements[3] as SymbolNode).name === '->') {
                    if (node.elements[4].type === 'symbol') {
                        returnType = (node.elements[4] as SymbolNode).name;
                    }
                    bodyIndex = 5; // Body starts after return type
                }
                
                this.symbolTable.addFunction(symbolNode.name, params, returnType, node);
            }
        } else if (firstElement.name === 'defenum' && node.elements.length >= 3) {
            // Process defenum
            const enumNameNode = node.elements[1];
            if (enumNameNode.type === 'symbol') {
                const symbolNode = enumNameNode as SymbolNode;
                const enumValues = node.elements.slice(2)
                    .filter((node: HQLNode) => node.type === 'symbol')
                    .map((node: HQLNode) => (node as SymbolNode).name);
                
                this.symbolTable.addEnum(symbolNode.name, enumValues, node);
            }
        }
    }

    /**
     * Extract parameter information from a function parameter list
     */
    private extractFunctionParams(paramsNode: ListNode): any[] {
        if (!paramsNode.elements) return [];
        
        const params = [];
        
        for (let i = 0; i < paramsNode.elements.length; i++) {
            const param = paramsNode.elements[i];
            
            if (param.type === 'symbol') {
                const symbolNode = param as SymbolNode;
                let paramName = symbolNode.name;
                let paramType = null;
                let defaultValue = null;
                
                // Check if it's a named parameter (ends with ':')
                const isNamed = paramName.endsWith(':');
                if (isNamed) {
                    paramName = paramName.slice(0, -1);
                }
                
                // Check for type annotation
                if (i + 2 < paramsNode.elements.length && 
                    paramsNode.elements[i + 1].type === 'symbol' &&
                    (paramsNode.elements[i + 1] as SymbolNode).name === ':') {
                    
                    if (paramsNode.elements[i + 2].type === 'symbol') {
                        paramType = (paramsNode.elements[i + 2] as SymbolNode).name;
                    }
                    
                    i += 2; // Skip type annotation elements
                    
                    // Check for default value
                    if (i + 2 < paramsNode.elements.length && 
                        paramsNode.elements[i + 1].type === 'symbol' &&
                        (paramsNode.elements[i + 1] as SymbolNode).name === '=') {
                        
                        defaultValue = paramsNode.elements[i + 2];
                        i += 2; // Skip default value elements
                    }
                } else if (i + 2 < paramsNode.elements.length && 
                    paramsNode.elements[i + 1].type === 'symbol' &&
                    (paramsNode.elements[i + 1] as SymbolNode).name === '=') {
                    
                    defaultValue = paramsNode.elements[i + 2];
                    i += 2; // Skip default value elements
                }
                
                params.push({
                    name: paramName,
                    type: paramType,
                    defaultValue: defaultValue,
                    isNamed: isNamed
                });
            }
        }
        
        return params;
    }

    /**
     * Process references to symbols in the AST
     */
    private processReferences(node: HQLNode, parentScope?: string): void {
        if (node.type === 'symbol') {
            const symbolNode = node as SymbolNode;
            const symbolName = symbolNode.name;
            
            // Skip certain special symbols
            if (!this.isSpecialSymbol(symbolName)) {
                // Try to find this symbol in the symbol table
                const symbol = this.symbolTable.findSymbol(symbolName);
                if (symbol) {
                    this.symbolTable.addReference(symbol, symbolNode);
                }
            }
        } else if (node.type === 'list') {
            const listNode = node as ListNode;
            
            // If this is a function, we need to track its scope
            let scope = parentScope;
            if (listNode.elements.length > 0 && 
                listNode.elements[0].type === 'symbol') {
                const firstElem = listNode.elements[0] as SymbolNode;
                
                if (firstElem.name === 'defn' && listNode.elements.length >= 2 && 
                    listNode.elements[1].type === 'symbol') {
                    // Set scope for defn
                    scope = (listNode.elements[1] as SymbolNode).name;
                    
                    // Enter scope in the symbol table
                    this.symbolTable.enterScope(scope);
                    
                    // Add parameters to scope
                    if (listNode.elements.length >= 3 && listNode.elements[2].type === 'list') {
                        const paramList = listNode.elements[2] as ListNode;
                        const params = this.extractFunctionParams(paramList);
                        
                        for (const param of params) {
                            this.symbolTable.addParameter(param.name, param.type, scope);
                        }
                    }
                }
                
                // Handle let forms to create local scopes
                if (firstElem.name === 'let' && listNode.elements.length >= 2 && 
                    listNode.elements[1].type === 'list') {
                    // Create a unique scope name for this let form
                    const letScope = `let_${this.generateScopeId()}`;
                    this.symbolTable.enterScope(letScope);
                    
                    // Process let bindings
                    const bindingList = listNode.elements[1] as ListNode;
                    for (let i = 0; i < bindingList.elements.length; i += 2) {
                        if (i + 1 >= bindingList.elements.length) break;
                        
                        const nameNode = bindingList.elements[i];
                        if (nameNode.type === 'symbol') {
                            const symbolName = (nameNode as SymbolNode).name;
                            // Add binding to let scope
                            this.symbolTable.addVariable(symbolName, nameNode);
                            
                            // Process the value for references
                            this.processReferences(bindingList.elements[i + 1], scope);
                        }
                    }
                    
                    // Process the body with the new scope
                    for (let i = 2; i < listNode.elements.length; i++) {
                        this.processReferences(listNode.elements[i], letScope);
                    }
                    
                    // Exit let scope
                    this.symbolTable.exitScope();
                    
                    // Skip processing the elements again below
                    return;
                }
            }
            
            // Process all elements in the list
            for (const element of listNode.elements) {
                this.processReferences(element, scope);
            }
            
            // Exit any scope we entered
            if (scope && scope !== parentScope) {
                this.symbolTable.exitScope();
            }
        }
    }

    /**
     * Check if a symbol is a special built-in symbol
     */
    private isSpecialSymbol(name: string): boolean {
        // Special symbols that don't need to be defined
        const specialSymbols = [
            'def', 'defn', 'fn', 'if', 'cond', 'let', 'for', 'print', 'str',
            'vector', 'list', 'hash-map', 'keyword', 'new', 'get', 'set',
            'return', 'import', 'export', 'defenum', '->',
            '+', '-', '*', '/', '<', '>', '<=', '>=', '=', '!=',
            'true', 'false', 'null', 'nil', ':', '.'
        ];
        
        return specialSymbols.includes(name);
    }

    /**
     * Generate a unique scope ID
     */
    private generateScopeId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get the AST node at a position (using the AST index)
     */
    public getNodeAtPosition(position: Position): HQLNode | null {
        this.ensureParsed();
        return this.astIndex.getNodeAtPosition(position);
    }

    /**
     * Find all nodes that match a predicate
     */
    public findNodes(predicate: (node: HQLNode) => boolean): HQLNode[] {
        this.ensureParsed();
        return this.astIndex.findNodes(predicate);
    }

    /**
     * Get timing information for diagnostics
     */
    public getTimingInfo(): { parseTime: number, symbolTableTime: number, timestamp: number } {
        return {
            parseTime: this.parseTime,
            symbolTableTime: this.symbolTableTime,
            timestamp: this.parsingTimestamp
        };
    }
}