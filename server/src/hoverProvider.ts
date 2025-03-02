// server/src/hoverProvider.ts
import {
    Hover,
    MarkupContent,
    MarkupKind,
    Position
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, SymbolNode, ListNode, LiteralNode } from './utilities/astTypes';
import { SymbolInfo } from './utilities/symbolTable';

export class HoverProvider {
    // Built-in HQL functions and special forms documentation
    private builtInFunctionDocs: { [key: string]: string } = {
        'def': 'Define a variable with the given name and value.\n\n```hql\n(def name expr)\n```',
        'defn': 'Define a function with the given name, parameters, and body expressions.\n\n```hql\n(defn name [params] body...)\n(defn name [params] -> ReturnType body...)\n```',
        'fn': 'Create an anonymous function with the given parameters and body expressions.\n\n```hql\n(fn [params] body...)\n(fn [params] -> ReturnType body...)\n```',
        'import': 'Import a module from the given path.\n\n```hql\n(import "path/to/module")\n```',
        'export': 'Export a value with the given name.\n\n```hql\n(export "exportName" symbol)\n```',
        'defenum': 'Define an enumeration with the given name and values.\n\n```hql\n(defenum Name value1 value2 ...)\n```',
        'if': 'Evaluate condition and return then-expr if truthy, else-expr if falsy.\n\n```hql\n(if condition then-expr else-expr)\n```',
        'cond': 'Evaluate each test in order, returning the expression for the first truthy test.\n\n```hql\n(cond test1 expr1 test2 expr2 ... default-expr)\n```',
        'let': 'Create local bindings and evaluate body expressions in that context.\n\n```hql\n(let [name1 value1 name2 value2 ...] body...)\n```',
        'for': 'Loop with init, condition, and update expressions, evaluating body each iteration.\n\n```hql\n(for [var init condition update] body...)\n```',
        'print': 'Print expressions to the console.\n\n```hql\n(print expr...)\n```',
        'str': 'Concatenate expressions as strings.\n\n```hql\n(str expr...)\n```',
        'vector': 'Create a vector (JavaScript array) with the given elements.\n\n```hql\n(vector elements...)\n``` \n\nAlternative syntax: `[elements...]`',
        'list': 'Create a list with the given elements.\n\n```hql\n(list elements...)\n```',
        'hash-map': 'Create a hash map (JavaScript object) with the given key-value pairs.\n\n```hql\n(hash-map key value...)\n``` \n\nAlternative syntax: `{"key": value, ...}`',
        'keyword': 'Create a keyword with the given name.\n\n```hql\n(keyword "name")\n```',
        'new': 'Create a new JavaScript object with the given constructor and arguments.\n\n```hql\n(new Constructor arg1 arg2...)\n```',
        'get': 'Get the value for the given key from the object.\n\n```hql\n(get object key)\n```',
        'set': 'Set the value for the given key in the object or create a Set.\n\n```hql\n(set object key value)\n(set collection)\n```',
        'return': 'Return the given expression from a function.\n\n```hql\n(return expr)\n```',
        '+': 'Add numbers or concatenate strings.\n\n```hql\n(+ x y)\n```',
        '-': 'Subtract y from x.\n\n```hql\n(- x y)\n```',
        '*': 'Multiply numbers.\n\n```hql\n(* x y)\n```',
        '/': 'Divide x by y.\n\n```hql\n(/ x y)\n```',
        '<': 'Check if x is less than y.\n\n```hql\n(< x y)\n```',
        '>': 'Check if x is greater than y.\n\n```hql\n(> x y)\n```',
        '<=': 'Check if x is less than or equal to y.\n\n```hql\n(<= x y)\n```',
        '>=': 'Check if x is greater than or equal to y.\n\n```hql\n(>= x y)\n```',
        '=': 'Check if x is equal to y.\n\n```hql\n(= x y)\n```',
        '!=': 'Check if x is not equal to y.\n\n```hql\n(!= x y)\n```',
        '->': 'Annotate a function\'s return type.\n\n```hql\n(defn name [params] -> ReturnType body...)\n```'
    };

    // Built-in JavaScript types documentation
    private builtInTypeDocs: { [key: string]: string } = {
        'String': 'JavaScript String type',
        'Number': 'JavaScript Number type',
        'Boolean': 'JavaScript Boolean type',
        'Object': 'JavaScript Object type',
        'Array': 'JavaScript Array type',
        'Function': 'JavaScript Function type',
        'Date': 'JavaScript Date object',
        'RegExp': 'JavaScript Regular Expression',
        'Map': 'JavaScript Map collection',
        'Set': 'JavaScript Set collection',
        'Promise': 'JavaScript Promise',
        'Int': 'Integer numeric type',
        'Float': 'Floating-point numeric type',
        'Void': 'Return type for functions with no return value'
    };

    public provideHover(document: HQLDocument, position: Position): Hover | null {
        // Get the AST node at the current position
        const node = document.getNodeAtPosition(position);
        if (!node) return null;
        
        // Get hover content based on the node type
        const contents = this.getHoverContents(node, document);
        if (!contents) return null;
        
        return {
            contents,
            range: (node as any).position
        };
    }

    private getHoverContents(node: HQLNode, document: HQLDocument): MarkupContent | null {
        switch (node.type) {
            case 'symbol':
                return this.getSymbolHoverContents(node as SymbolNode, document);
            case 'list':
                return this.getListHoverContents(node as ListNode, document);
            case 'literal':
                return this.getLiteralHoverContents(node as LiteralNode);
            default:
                return null;
        }
    }

    private getSymbolHoverContents(node: SymbolNode, document: HQLDocument): MarkupContent | null {
        const symbolName = node.name;
        
        // Check for built-in special forms and functions
        if (this.builtInFunctionDocs[symbolName]) {
            return {
                kind: MarkupKind.Markdown,
                value: `# ${symbolName}\n\n${this.builtInFunctionDocs[symbolName]}`
            };
        }
        
        // Check for built-in types
        if (this.builtInTypeDocs[symbolName]) {
            return {
                kind: MarkupKind.Markdown,
                value: `# ${symbolName}\n\n${this.builtInTypeDocs[symbolName]}`
            };
        }
        
        // Check in the symbol table
        const symbolTable = document.getSymbolTable();
        const symbol = symbolTable.findSymbol(symbolName);
        
        if (symbol) {
            return this.getSymbolInfoHoverContents(symbol);
        }
        
        return null;
    }

    private getSymbolInfoHoverContents(symbol: SymbolInfo): MarkupContent {
        let value = `# ${symbol.name}\n\n`;
        
        switch (symbol.kind) {
            case 'variable':
                value += `**Variable**`;
                if (symbol.type) {
                    value += `: ${symbol.type}`;
                }
                break;
            case 'function':
                value += `**Function**\n\n`;
                
                if (symbol.params) {
                    const paramList = symbol.params.map(p => {
                        let paramStr = p.name;
                        if (p.type) {
                            paramStr += `: ${p.type}`;
                        }
                        if (p.defaultValue) {
                            paramStr += ' = ...';
                        }
                        return paramStr;
                    }).join(' ');
                    
                    value += `\`\`\`hql\n(${symbol.name} [${paramList}]`;
                    
                    if (symbol.type) {
                        value += ` -> ${symbol.type}`;
                    }
                    
                    value += ')\n```';
                }
                break;
            case 'enum':
                value += `**Enum**\n\n`;
                
                if (symbol.enumValues) {
                    value += 'Values:\n';
                    for (const val of symbol.enumValues) {
                        value += `- \`${val}\`\n`;
                    }
                }
                break;
            case 'enum-value':
                value += `**Enum Value**\n\n`;
                
                if (symbol.parentScope) {
                    value += `From enum: \`${symbol.parentScope}\``;
                }
                break;
            case 'parameter':
                value += `**Function Parameter**`;
                
                if (symbol.type) {
                    value += `: ${symbol.type}`;
                }
                
                if (symbol.parentScope) {
                    value += `\n\nFrom function: \`${symbol.parentScope}\``;
                }
                break;
        }
        
        return {
            kind: MarkupKind.Markdown,
            value
        };
    }

    private getListHoverContents(node: ListNode, document: HQLDocument): MarkupContent | null {
        // Provide hover for special list forms
        if (node.elements.length > 0 && node.elements[0].type === 'symbol') {
            const formName = (node.elements[0] as SymbolNode).name;
            
            // Check if it's a built-in special form
            if (this.builtInFunctionDocs[formName]) {
                return {
                    kind: MarkupKind.Markdown,
                    value: `# ${formName}\n\n${this.builtInFunctionDocs[formName]}`
                };
            }
            
            // Check if it's a function call
            const symbolTable = document.getSymbolTable();
            const symbol = symbolTable.findSymbol(formName);
            
            if (symbol && symbol.kind === 'function') {
                return this.getSymbolInfoHoverContents(symbol);
            }
        }
        
        return null;
    }

    private getLiteralHoverContents(node: LiteralNode): MarkupContent | null {
        const value = node.value;
        
        // Different hover info based on the type of literal
        if (typeof value === 'string') {
            return {
                kind: MarkupKind.Markdown,
                value: `**String** (length: ${value.length})\n\n\`\`\`\n${value}\n\`\`\``
            };
        } else if (typeof value === 'number') {
            return {
                kind: MarkupKind.Markdown,
                value: `**Number**\n\n\`${value}\``
            };
        } else if (typeof value === 'boolean') {
            return {
                kind: MarkupKind.Markdown,
                value: `**Boolean**\n\n\`${value}\``
            };
        } else if (value === null) {
            return {
                kind: MarkupKind.Markdown,
                value: `**Null**\n\nRepresents no value.`
            };
        }
        
        return null;
    }
}