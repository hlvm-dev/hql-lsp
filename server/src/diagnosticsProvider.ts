// server/src/diagnosticsProvider.ts
import {
    Connection,
    Diagnostic,
    DiagnosticSeverity,
    Range
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, ListNode, SymbolNode } from './utilities/astTypes';

export class DiagnosticsProvider {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public provideDiagnostics(document: HQLDocument, maxProblems: number): Diagnostic[] {
        // Check for parse errors first
        const parseError = document.getParseError();
        const diagnostics: Diagnostic[] = [];

        if (parseError) {
            // Handle parse errors
            this.handleParseError(parseError, diagnostics, document);
        } else {
            // Analyze the AST for other issues
            const ast = document.getAST();
            if (ast) {
                this.analyzeAST(ast, diagnostics, document, maxProblems);
            }
        }

        // Send the diagnostics to the client
        this.connection.sendDiagnostics({ uri: document.getUri(), diagnostics });
        
        // Important: Return the diagnostics array
        return diagnostics;
    }

    private handleParseError(error: any, diagnostics: Diagnostic[], document: HQLDocument): void {
        let message = 'Parse error';
        let range: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

        // Extract error information if available
        if (error.position) {
            // If the error has position information, use it
            const line = Math.max(0, error.position.line - 1); // Convert to 0-based
            const column = Math.max(0, error.position.column - 1); // Convert to 0-based
            
            range = {
                start: { line, character: column },
                end: { line, character: column + 1 }
            };
            
            message = error.message || 'Parse error';
        } else if (error.message) {
            // Try to extract line/column information from the error message
            const match = error.message.match(/line (\d+), column (\d+)/);
            if (match) {
                const line = parseInt(match[1], 10) - 1; // Convert to 0-based
                const column = parseInt(match[2], 10) - 1; // Convert to 0-based
                
                range = {
                    start: { line, character: column },
                    end: { line, character: column + 1 }
                };
            }
            
            message = error.message;
        }

        // Add the diagnostic
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message,
            source: 'hql'
        });
    }

    private analyzeAST(ast: HQLNode[], diagnostics: Diagnostic[], document: HQLDocument, maxProblems: number): void {
        // Check symbol resolution
        this.checkSymbolResolution(ast, diagnostics, document);
        
        // Check function calls
        this.checkFunctionCalls(ast, diagnostics, document);
        
        // Check for other semantic issues
        this.checkSemanticIssues(ast, diagnostics, document);
        
        // Limit the number of diagnostics
        if (diagnostics.length > maxProblems) {
            diagnostics.length = maxProblems;
        }
    }

    private checkSymbolResolution(nodes: HQLNode[], diagnostics: Diagnostic[], document: HQLDocument): void {
        const symbolTable = document.getSymbolTable();
        
        for (const node of nodes) {
            if (node.type === 'symbol') {
                const symbolNode = node as SymbolNode;
                const symbolName = symbolNode.name;
                
                // Skip some special symbols
                if (this.isSpecialSymbol(symbolName)) {
                    continue;
                }
                
                // Check if the symbol is defined
                const symbol = symbolTable.findSymbol(symbolName);
                if (!symbol) {
                    // Report undefined symbol
                    if ((node as any).position) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: (node as any).position,
                            message: `Undefined symbol: ${symbolName}`,
                            source: 'hql'
                        });
                    }
                }
            } else if (node.type === 'list') {
                const listNode = node as ListNode;
                this.checkSymbolResolution(listNode.elements, diagnostics, document);
            }
        }
    }

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

    private checkFunctionCalls(nodes: HQLNode[], diagnostics: Diagnostic[], document: HQLDocument): void {
        for (const node of nodes) {
            if (node.type === 'list') {
                const listNode = node as ListNode;
                
                // Check if this is a function call
                if (listNode.elements.length > 0 && listNode.elements[0].type === 'symbol') {
                    const fnNameNode = listNode.elements[0] as SymbolNode;
                    const fnName = fnNameNode.name;
                    
                    // Skip special forms
                    if (this.isSpecialSymbol(fnName)) {
                        // Check specific requirements for special forms
                        this.checkSpecialFormRequirements(listNode, fnName, diagnostics);
                    } else {
                        // Check function call
                        this.checkFunctionCall(listNode, fnName, diagnostics, document);
                    }
                }
                
                // Recursively check nested lists
                this.checkFunctionCalls(listNode.elements, diagnostics, document);
            }
        }
    }

    private checkSpecialFormRequirements(node: ListNode, formName: string, diagnostics: Diagnostic[]): void {
        // Check specific requirements for special forms
        switch (formName) {
            case 'def':
                if (node.elements.length < 3) {
                    this.addDiagnostic(node, 'def requires a name and a value', DiagnosticSeverity.Error, diagnostics);
                }
                break;
            case 'defn':
                if (node.elements.length < 4) {
                    this.addDiagnostic(node, 'defn requires a name, parameter list, and body', DiagnosticSeverity.Error, diagnostics);
                } else if (node.elements[2].type !== 'list') {
                    this.addDiagnostic(node, 'defn requires a parameter list (second argument)', DiagnosticSeverity.Error, diagnostics);
                }
                break;
            case 'fn':
                if (node.elements.length < 3) {
                    this.addDiagnostic(node, 'fn requires a parameter list and body', DiagnosticSeverity.Error, diagnostics);
                } else if (node.elements[1].type !== 'list') {
                    this.addDiagnostic(node, 'fn requires a parameter list (first argument)', DiagnosticSeverity.Error, diagnostics);
                }
                break;
            case 'if':
                if (node.elements.length < 3) {
                    this.addDiagnostic(node, 'if requires a condition and then-branch', DiagnosticSeverity.Error, diagnostics);
                } else if (node.elements.length < 4) {
                    this.addDiagnostic(node, 'if should have an else-branch', DiagnosticSeverity.Warning, diagnostics);
                }
                break;
            case 'let':
                if (node.elements.length < 2) {
                    this.addDiagnostic(node, 'let requires a binding vector', DiagnosticSeverity.Error, diagnostics);
                } else if (node.elements[1].type !== 'list') {
                    this.addDiagnostic(node, 'let requires a binding vector (first argument)', DiagnosticSeverity.Error, diagnostics);
                } else {
                    const bindingVector = node.elements[1] as ListNode;
                    if (bindingVector.elements.length % 2 !== 0) {
                        this.addDiagnostic(bindingVector, 'let bindings must be pairs of name and value', DiagnosticSeverity.Error, diagnostics);
                    }
                }
                break;
            // Add more special form checks as needed
        }
    }

    private checkFunctionCall(node: ListNode, fnName: string, diagnostics: Diagnostic[], document: HQLDocument): void {
        const symbolTable = document.getSymbolTable();
        const symbol = symbolTable.findSymbol(fnName);
        
        if (symbol && symbol.kind === 'function' && symbol.params) {
            // Check if the number of arguments matches the function definition
            const requiredParams = symbol.params.filter(p => !p.defaultValue);
            const optionalParams = symbol.params.filter(p => p.defaultValue);
            const providedArgs = node.elements.length - 1; // Subtract the function name
            
            if (providedArgs < requiredParams.length) {
                this.addDiagnostic(
                    node,
                    `Function '${fnName}' called with too few arguments. Expected at least ${requiredParams.length}, got ${providedArgs}`,
                    DiagnosticSeverity.Error,
                    diagnostics
                );
            } else if (providedArgs > requiredParams.length + optionalParams.length) {
                this.addDiagnostic(
                    node,
                    `Function '${fnName}' called with too many arguments. Expected at most ${requiredParams.length + optionalParams.length}, got ${providedArgs}`,
                    DiagnosticSeverity.Warning,
                    diagnostics
                );
            }
            
            // Check for named parameters
            const namedParams = symbol.params.filter(p => p.isNamed);
            if (namedParams.length > 0) {
                // Check for named parameter syntax: param: value
                for (let i = 1; i < node.elements.length; i++) {
                    const arg = node.elements[i];
                    if (arg.type === 'symbol') {
                        const argName = (arg as SymbolNode).name;
                        if (argName.endsWith(':')) {
                            const paramName = argName.slice(0, -1);
                            const param = symbol.params.find(p => p.name === paramName);
                            if (!param) {
                                this.addDiagnostic(
                                    arg,
                                    `Unknown named parameter: ${paramName}`,
                                    DiagnosticSeverity.Warning,
                                    diagnostics
                                );
                            }
                            
                            // Skip the value
                            i++;
                        }
                    }
                }
            }
        }
    }

    private checkSemanticIssues(nodes: HQLNode[], diagnostics: Diagnostic[], document: HQLDocument): void {
        // Check for other semantic issues
        for (const node of nodes) {
            if (node.type === 'list') {
                const listNode = node as ListNode;
                
                // Check for empty lists
                if (listNode.elements.length === 0) {
                    this.addDiagnostic(listNode, 'Empty list is not a valid expression', DiagnosticSeverity.Warning, diagnostics);
                }
                
                // Recursively check nested nodes
                this.checkSemanticIssues(listNode.elements, diagnostics, document);
            }
        }
    }

    private addDiagnostic(node: HQLNode, message: string, severity: DiagnosticSeverity, diagnostics: Diagnostic[]): void {
        if ((node as any).position) {
            diagnostics.push({
                severity,
                range: (node as any).position,
                message,
                source: 'hql'
            });
        }
    }
}