// server/src/completionProvider.ts
import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    Position,
    Range
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, SymbolNode, ListNode } from './utilities/astTypes';
import { SymbolInfo } from './utilities/symbolTable';

interface CompletionContext {
    isInsideList: boolean;
    isFirstInList: boolean;
    parentList: ListNode | null;
    currentToken: string;
    previousToken: string;
}

export class CompletionProvider {
    // Built-in HQL functions and special forms
    private builtInFunctions: { [key: string]: { params: string, description: string } } = {
        'def': {
            params: 'name expr',
            description: 'Define a variable with the given name and value.'
        },
        'defn': {
            params: 'name [params] body...',
            description: 'Define a function with the given name, parameters, and body expressions.'
        },
        'fn': {
            params: '[params] body...',
            description: 'Create an anonymous function with the given parameters and body expressions.'
        },
        'import': {
            params: 'path',
            description: 'Import a module from the given path.'
        },
        'export': {
            params: 'name value',
            description: 'Export a value with the given name.'
        },
        'defenum': {
            params: 'name value...',
            description: 'Define an enumeration with the given name and values.'
        },
        'if': {
            params: 'condition then-expr else-expr',
            description: 'Evaluate condition and return then-expr if truthy, else-expr if falsy.'
        },
        'cond': {
            params: 'test1 expr1 test2 expr2 ... default-expr',
            description: 'Evaluate each test in order, returning the expression for the first truthy test.'
        },
        'let': {
            params: '[binding-pairs] body...',
            description: 'Create local bindings and evaluate body expressions in that context.'
        },
        'for': {
            params: '[var init condition update] body...',
            description: 'Loop with init, condition, and update expressions, evaluating body each iteration.'
        },
        'print': {
            params: 'expr...',
            description: 'Print expressions to the console.'
        },
        'str': {
            params: 'expr...',
            description: 'Concatenate expressions as strings.'
        },
        'vector': {
            params: 'elements...',
            description: 'Create a vector (JavaScript array) with the given elements.'
        },
        'list': {
            params: 'elements...',
            description: 'Create a list with the given elements.'
        },
        'hash-map': {
            params: 'key value...',
            description: 'Create a hash map (JavaScript object) with the given key-value pairs.'
        },
        'keyword': {
            params: 'name',
            description: 'Create a keyword with the given name.'
        },
        'new': {
            params: 'constructor args...',
            description: 'Create a new JavaScript object with the given constructor and arguments.'
        },
        'get': {
            params: 'object key',
            description: 'Get the value for the given key from the object.'
        },
        'set': {
            params: 'object key value',
            description: 'Set the value for the given key in the object.'
        },
        'return': {
            params: 'expr',
            description: 'Return the given expression from a function.'
        },
        '+': {
            params: 'x y',
            description: 'Add x and y.'
        },
        '-': {
            params: 'x y',
            description: 'Subtract y from x.'
        },
        '*': {
            params: 'x y',
            description: 'Multiply x and y.'
        },
        '/': {
            params: 'x y',
            description: 'Divide x by y.'
        },
        '<': {
            params: 'x y',
            description: 'Check if x is less than y.'
        },
        '>': {
            params: 'x y',
            description: 'Check if x is greater than y.'
        },
        '<=': {
            params: 'x y',
            description: 'Check if x is less than or equal to y.'
        },
        '>=': {
            params: 'x y',
            description: 'Check if x is greater than or equal to y.'
        },
        '=': {
            params: 'x y',
            description: 'Check if x is equal to y.'
        },
        '!=': {
            params: 'x y',
            description: 'Check if x is not equal to y.'
        },
        '->': {
            params: 'type',
            description: 'Annotate a function\'s return type.'
        }
    };

    // Built-in JavaScript types
    private builtInTypes: string[] = [
        'String', 'Number', 'Boolean', 'Object', 'Array', 'Function',
        'Date', 'RegExp', 'Map', 'Set', 'Promise', 'Int', 'Float', 'Void'
    ];

    public provideCompletionItems(document: HQLDocument, position: Position): CompletionItem[] {
        const offset = document.offsetAt(position);
        const content = document.getContent();
        
        // Get context around the current position
        const context = this.getCompletionContext(content, offset);
        
        // Get the AST node at the current position
        const currentNode = document.getNodeAtPosition(position);
        
        // Get completion items based on context
        const items: CompletionItem[] = [];
        
        // Add built-in functions/special forms
        this.addBuiltInCompletions(items, context);
        
        // Add symbol completions from the document's symbol table
        this.addSymbolCompletions(items, document, context);
        
        // Add specific completions based on the current context
        if (context.isInsideList) {
            if (context.isFirstInList) {
                // First element in a list: suggest special forms and functions
                this.addSpecialFormCompletions(items, context);
            } else if (context.parentList) {
                // Inside a list: suggest context-specific completions
                this.addContextSpecificCompletions(items, context, document);
            }
        }
        
        return items;
    }

    public resolveCompletionItem(item: CompletionItem): CompletionItem {
        // This method can be used to add more detailed information
        // to a completion item when it's selected by the user
        return item;
    }

    private getCompletionContext(content: string, offset: number): CompletionContext {
        // Extract context information from the content around the offset
        const text = content.slice(0, offset);
        
        // Very simplified context extraction
        // A real implementation would parse the content and maintain proper state
        const isInsideList = text.lastIndexOf('(') > text.lastIndexOf(')');
        const isFirstInList = isInsideList && text.substring(text.lastIndexOf('(') + 1).trim() === '';
        
        // Get current token
        const tokenRegex = /[\w\-\+\*\/\<\>\=\!\?\.]+$/;
        const currentTokenMatch = text.match(tokenRegex);
        const currentToken = currentTokenMatch ? currentTokenMatch[0] : '';
        
        // Get previous token
        const prevText = text.slice(0, text.length - (currentTokenMatch ? currentTokenMatch[0].length : 0)).trim();
        const prevTokenMatch = prevText.match(/[\w\-\+\*\/\<\>\=\!\?\.]+$/);
        const previousToken = prevTokenMatch ? prevTokenMatch[0] : '';
        
        return {
            isInsideList,
            isFirstInList,
            parentList: null, // This would be populated from the AST in a real implementation
            currentToken,
            previousToken
        };
    }

    private addBuiltInCompletions(items: CompletionItem[], context: CompletionContext): void {
        // Add built-in function/special form completions
        for (const [name, info] of Object.entries(this.builtInFunctions)) {
            if (!context.currentToken || name.startsWith(context.currentToken)) {
                items.push({
                    label: name,
                    kind: CompletionItemKind.Function,
                    detail: `(${name} ${info.params})`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**${name}**\n\n${info.description}`
                    }
                });
            }
        }
    }

    private addSymbolCompletions(items: CompletionItem[], document: HQLDocument, context: CompletionContext): void {
        // Add completion items from the document's symbol table
        const symbolTable = document.getSymbolTable();
        const symbols = symbolTable.getAllSymbols();
        
        for (const symbol of symbols) {
            if (!context.currentToken || symbol.name.startsWith(context.currentToken)) {
                let kind: CompletionItemKind;
                let detail = symbol.name;
                let insertText = symbol.name;
                
                switch (symbol.kind) {
                    case 'variable':
                        kind = CompletionItemKind.Variable;
                        if (symbol.type) {
                            detail = `${symbol.name}: ${symbol.type}`;
                        }
                        break;
                    case 'function':
                        kind = CompletionItemKind.Function;
                        if (symbol.params) {
                            const paramText = symbol.params.map(p => p.name).join(' ');
                            detail = `(${symbol.name} ${paramText})`;
                            insertText = symbol.name;
                        }
                        break;
                    case 'enum':
                        kind = CompletionItemKind.Enum;
                        break;
                    case 'enum-value':
                        kind = CompletionItemKind.EnumMember;
                        break;
                    case 'parameter':
                        kind = CompletionItemKind.Variable;
                        if (symbol.type) {
                            detail = `${symbol.name}: ${symbol.type}`;
                        }
                        break;
                    default:
                        kind = CompletionItemKind.Text;
                }
                
                items.push({
                    label: symbol.name,
                    kind,
                    detail,
                    insertText
                });
            }
        }
    }

    private addSpecialFormCompletions(items: CompletionItem[], context: CompletionContext): void {
        // Add special completions for the first element in a list
        const specialForms = [
            {
                label: 'defn',
                insertText: 'defn ${1:name} [${2:params}]\n  ${0}',
                documentation: 'Define a new function'
            },
            {
                label: 'def',
                insertText: 'def ${1:name} ${0}',
                documentation: 'Define a new variable'
            },
            {
                label: 'if',
                insertText: 'if ${1:condition}\n  ${2:then-expr}\n  ${3:else-expr}',
                documentation: 'Conditional expression'
            },
            {
                label: 'let',
                insertText: 'let [${1:bindings}]\n  ${0}',
                documentation: 'Create local bindings'
            },
            {
                label: 'fn',
                insertText: 'fn [${1:params}]\n  ${0}',
                documentation: 'Anonymous function'
            }
        ];
        
        for (const form of specialForms) {
            if (!context.currentToken || form.label.startsWith(context.currentToken)) {
                items.push({
                    label: form.label,
                    kind: CompletionItemKind.Keyword,
                    insertText: form.insertText,
                    insertTextFormat: InsertTextFormat.Snippet,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: form.documentation
                    }
                });
            }
        }
    }

    private addContextSpecificCompletions(items: CompletionItem[], context: CompletionContext, document: HQLDocument): void {
        // Add completions specific to the current context
        
        // If we're after a type annotation marker (->), suggest types
        if (context.previousToken === '->') {
            this.addTypeCompletions(items, context.currentToken);
            return;
        }
        
        // If we're after a colon, suggest types for type annotations
        if (context.previousToken === ':') {
            this.addTypeCompletions(items, context.currentToken);
            return;
        }
        
        // More context-specific completions would be added here
    }

    private addTypeCompletions(items: CompletionItem[], currentToken: string): void {
        // Add built-in type completions
        for (const type of this.builtInTypes) {
            if (!currentToken || type.toLowerCase().startsWith(currentToken.toLowerCase())) {
                items.push({
                    label: type,
                    kind: CompletionItemKind.Class,
                    detail: `Type: ${type}`
                });
            }
        }
    }
}