// server/src/signatureHelpProvider.ts
import {
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    Position,
    MarkupKind
} from 'vscode-languageserver';

// Define the Range interface
interface Range {
    start: Position;
    end: Position;
}

import { HQLDocument } from './hqlDocument';
import { HQLNode, SymbolNode, ListNode } from './utilities/astTypes';
import { SymbolInfo } from './utilities/symbolTable';

export class SignatureHelpProvider {
    // Built-in function signatures
    private builtInSignatures: { [key: string]: { params: string[], documentation: string } } = {
        'def': {
            params: ['name', 'expr'],
            documentation: 'Define a variable with the given name and value.'
        },
        'defn': {
            params: ['name', 'params', '...body'],
            documentation: 'Define a function with the given name, parameters, and body expressions.'
        },
        'fn': {
            params: ['params', '...body'],
            documentation: 'Create an anonymous function with the given parameters and body expressions.'
        },
        'if': {
            params: ['condition', 'then-expr', 'else-expr'],
            documentation: 'Evaluate condition and return then-expr if truthy, else-expr if falsy.'
        },
        'cond': {
            params: ['test1', 'expr1', 'test2', 'expr2', '...', 'default-expr'],
            documentation: 'Evaluate each test in order, returning the expression for the first truthy test.'
        },
        'let': {
            params: ['[binding-pairs]', '...body'],
            documentation: 'Create local bindings and evaluate body expressions in that context.'
        },
        'for': {
            params: ['[var init condition update]', '...body'],
            documentation: 'Loop with init, condition, and update expressions, evaluating body each iteration.'
        },
        'print': {
            params: ['...expr'],
            documentation: 'Print expressions to the console.'
        },
        'str': {
            params: ['...expr'],
            documentation: 'Concatenate expressions as strings.'
        },
        'vector': {
            params: ['...elements'],
            documentation: 'Create a vector (JavaScript array) with the given elements.'
        },
        'list': {
            params: ['...elements'],
            documentation: 'Create a list with the given elements.'
        },
        'hash-map': {
            params: ['key', 'value', '...'],
            documentation: 'Create a hash map (JavaScript object) with the given key-value pairs.'
        },
        'keyword': {
            params: ['name'],
            documentation: 'Create a keyword with the given name.'
        },
        'new': {
            params: ['constructor', '...args'],
            documentation: 'Create a new JavaScript object with the given constructor and arguments.'
        },
        'get': {
            params: ['object', 'key'],
            documentation: 'Get the value for the given key from the object.'
        },
        'set': {
            params: ['object', 'key', 'value'],
            documentation: 'Set the value for the given key in the object or create a Set.'
        },
        '+': {
            params: ['x', 'y', '...more'],
            documentation: 'Add numbers or concatenate strings.'
        },
        '-': {
            params: ['x', 'y', '...more'],
            documentation: 'Subtract y from x, or negate x if only one argument.'
        },
        '*': {
            params: ['x', 'y', '...more'],
            documentation: 'Multiply numbers.'
        },
        '/': {
            params: ['x', 'y', '...more'],
            documentation: 'Divide x by y.'
        },
        '<': {
            params: ['x', 'y'],
            documentation: 'Check if x is less than y.'
        },
        '>': {
            params: ['x', 'y'],
            documentation: 'Check if x is greater than y.'
        },
        '<=': {
            params: ['x', 'y'],
            documentation: 'Check if x is less than or equal to y.'
        },
        '>=': {
            params: ['x', 'y'],
            documentation: 'Check if x is greater than or equal to y.'
        },
        '=': {
            params: ['x', 'y'],
            documentation: 'Check if x is equal to y.'
        },
        '!=': {
            params: ['x', 'y'],
            documentation: 'Check if x is not equal to y.'
        }
    };

    public provideSignatureHelp(document: HQLDocument, position: Position): SignatureHelp | null {
        // Find the function call that contains the current position
        const functionCall = this.findEnclosingFunctionCall(document, position);
        if (!functionCall) return null;
        
        // Get the function name
        const functionNameNode = functionCall.elements[0];
        if (functionNameNode.type !== 'symbol') return null;
        
        const functionName = (functionNameNode as SymbolNode).name;
        
        // Find the active parameter index
        const activeParameter = this.findActiveParameterIndex(functionCall, position, document);
        
        // Look up function information
        let signatures: SignatureInformation[] = [];
        
        // Check built-in functions first
        if (this.builtInSignatures[functionName]) {
            signatures.push(this.createBuiltInSignature(functionName));
        } else {
            // Check user-defined functions in the symbol table
            const symbolTable = document.getSymbolTable();
            const functionSymbol = symbolTable.findSymbol(functionName);
            
            if (functionSymbol && functionSymbol.kind === 'function') {
                signatures.push(this.createFunctionSignature(functionSymbol));
            }
        }
        
        if (signatures.length === 0) return null;
        
        return {
            signatures,
            activeSignature: 0,
            activeParameter: activeParameter
        };
    }

    private findEnclosingFunctionCall(document: HQLDocument, position: Position): ListNode | null {
        // This would normally use the AST to find the function call that contains the position
        // For now, we'll use a simplified approach
        
        const ast = document.getAST();
        if (!ast) return null;
        
        return this.findEnclosingListNode(ast, position, document);
    }

    private findEnclosingListNode(nodes: HQLNode[] | HQLNode, position: Position, document: HQLDocument): ListNode | null {
        if (Array.isArray(nodes)) {
            for (const node of nodes) {
                const result = this.findEnclosingListNode(node, position, document);
                if (result) return result;
            }
            return null;
        }
        
        if (nodes.type === 'list') {
            const listNode = nodes as ListNode;
            
            // Check if this list contains the position
            if ((listNode as any).position && this.isPositionInRange(position, (listNode as any).position)) {
                // Check nested lists first (innermost list has priority)
                for (const element of listNode.elements) {
                    if (element.type === 'list') {
                        const nestedResult = this.findEnclosingListNode(element, position, document);
                        if (nestedResult) return nestedResult;
                    }
                }
                
                // If no nested list contains the position, return this list
                if (listNode.elements.length > 0 && listNode.elements[0].type === 'symbol') {
                    return listNode;
                }
            }
        }
        
        return null;
    }

    private isPositionInRange(position: Position, range: Range): boolean {
        // Check if the position is within the range
        if (position.line < range.start.line || position.line > range.end.line) {
            return false;
        }
        
        if (position.line === range.start.line && position.character < range.start.character) {
            return false;
        }
        
        if (position.line === range.end.line && position.character > range.end.character) {
            return false;
        }
        
        return true;
    }

    private findActiveParameterIndex(functionCall: ListNode, position: Position, document: HQLDocument): number {
        // The first element is the function name, so start counting from the second element
        const elements = functionCall.elements.slice(1);
        
        // If there are no arguments, the active parameter is 0
        if (elements.length === 0) return 0;
        
        // Find which parameter contains the position
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if ((element as any).position && this.isPositionInRange(position, (element as any).position)) {
                return i;
            }
            
            // Check if the position is after this element but before the next one
            if (i < elements.length - 1) {
                const nextElement = elements[i + 1];
                if ((element as any).position && (nextElement as any).position) {
                    const afterElement = position.line > (element as any).position.end.line || 
                        (position.line === (element as any).position.end.line && 
                         position.character >= (element as any).position.end.character);
                    
                    const beforeNextElement = position.line < (nextElement as any).position.start.line || 
                        (position.line === (nextElement as any).position.start.line && 
                         position.character <= (nextElement as any).position.start.character);
                    
                    if (afterElement && beforeNextElement) {
                        return i + 1;
                    }
                }
            }
        }
        
        // If the position is after all elements, it's the last parameter
        return elements.length;
    }

    private createBuiltInSignature(functionName: string): SignatureInformation {
        const info = this.builtInSignatures[functionName];
        
        // Create parameter information
        const parameters: ParameterInformation[] = info.params.map(param => {
            return {
                label: param,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `Parameter: ${param}`
                }
            };
        });
        
        // Create signature information
        return {
            label: `(${functionName} ${info.params.join(' ')})`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: info.documentation
            },
            parameters
        };
    }

    private createFunctionSignature(functionSymbol: SymbolInfo): SignatureInformation {
        if (!functionSymbol.params) {
            return {
                label: `(${functionSymbol.name})`,
                documentation: 'No parameter information available',
                parameters: []
            };
        }
        
        // Create parameter information
        const parameters: ParameterInformation[] = functionSymbol.params.map(param => {
            let label = param.name;
            if (param.type) {
                label += `: ${param.type}`;
            }
            if (param.defaultValue) {
                label += ' = ...';
            }
            
            return {
                label,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `Parameter: ${label}`
                }
            };
        });
        
        // Create parameter string for the signature label
        const paramStr = functionSymbol.params.map(param => {
            let str = param.name;
            if (param.type) {
                str += `: ${param.type}`;
            }
            if (param.defaultValue) {
                str += ' = ...';
            }
            return str;
        }).join(' ');
        
        // Create signature information
        return {
            label: `(${functionSymbol.name} [${paramStr}])${functionSymbol.type ? ` -> ${functionSymbol.type}` : ''}`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `Function defined in the current document.`
            },
            parameters
        };
    }
}