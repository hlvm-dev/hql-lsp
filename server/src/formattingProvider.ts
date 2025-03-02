// server/src/formattingProvider.ts
import {
    TextEdit,
    Range
} from 'vscode-languageserver';
import { HQLDocument } from './hqlDocument';
import { HQLNode, ListNode, SymbolNode, LiteralNode } from './utilities/astTypes';

interface FormatOptions {
    indentSize: number;
    insertSpaces: boolean;
}

export class FormattingProvider {
    /**
     * Provide formatting for an entire document
     */
    public provideDocumentFormatting(document: HQLDocument, options: FormatOptions): TextEdit[] {
        // Get the document content and AST
        const content = document.getContent();
        const ast = document.getAST();
        
        if (!ast) {
            // If there's no valid AST, we can't do proper formatting
            return [];
        }
        
        // For now, perform a basic S-expression formatter
        const formattedContent = this.formatDocument(content, ast, options);
        
        // Return a single text edit that replaces the entire document
        return [
            TextEdit.replace(
                {
                    start: { line: 0, character: 0 },
                    end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE }
                },
                formattedContent
            )
        ];
    }
    
    /**
     * Format the entire document by re-generating it from the AST
     */
    private formatDocument(content: string, ast: HQLNode[], options: FormatOptions): string {
        const result: string[] = [];
        let lastLine = 0;
        
        // Preserve any initial comment lines
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith(';;')) {
                result.push(line);
                lastLine = i + 1;
            } else if (line === '' && i < lines.length - 1 && lines[i + 1].trim().startsWith(';;')) {
                // Preserve blank lines before comments
                result.push('');
                lastLine = i + 1;
            } else if (line !== '') {
                // Stop at the first non-comment, non-empty line
                break;
            }
        }
        
        // If we added any comment lines, add a separator
        if (lastLine > 0) {
            result.push('');
        }
        
        // Format each top-level form
        for (const node of ast) {
            result.push(this.formatNode(node, 0, options));
            
            // Add a blank line between top-level forms
            result.push('');
        }
        
        return result.join('\n');
    }
    
    /**
     * Format a single AST node with proper indentation
     */
    private formatNode(node: HQLNode, indentLevel: number, options: FormatOptions): string {
        const indent = this.getIndent(indentLevel, options);
        
        switch (node.type) {
            case 'symbol':
                return this.formatSymbol(node as SymbolNode);
            case 'literal':
                return this.formatLiteral(node as LiteralNode);
            case 'list':
                return this.formatList(node as ListNode, indentLevel, options);
            default:
                return '';
        }
    }
    
    /**
     * Format a symbol node
     */
    private formatSymbol(node: SymbolNode): string {
        return node.name;
    }
    
    /**
     * Format a literal node
     */
    private formatLiteral(node: LiteralNode): string {
        const value = node.value;
        
        if (typeof value === 'string') {
            return `"${value.replace(/"/g, '\\"')}"`;
        } else if (value === null) {
            return 'nil';
        } else {
            return String(value);
        }
    }
    
    /**
     * Format a list node with proper indentation
     */
    private formatList(node: ListNode, indentLevel: number, options: FormatOptions): string {
        // Handle empty lists
        if (node.elements.length === 0) {
            return '()';
        }
        
        // Handle array literals (marked with isArrayLiteral)
        if ((node as any).isArrayLiteral) {
            return this.formatArrayLiteral(node, indentLevel, options);
        }
        
        // Check if we can format this as a JSON-style object literal
        if (this.isObjectLiteral(node)) {
            return this.formatObjectLiteral(node, indentLevel, options);
        }
        
        // Handle special forms differently
        if (node.elements[0].type === 'symbol') {
            const form = (node.elements[0] as SymbolNode).name;
            
            // Format special forms
            switch (form) {
                case 'def':
                    return this.formatDefForm(node, indentLevel, options);
                case 'defn':
                    return this.formatDefnForm(node, indentLevel, options);
                case 'let':
                    return this.formatLetForm(node, indentLevel, options);
                case 'if':
                    return this.formatIfForm(node, indentLevel, options);
                case 'cond':
                    return this.formatCondForm(node, indentLevel, options);
                case 'for':
                    return this.formatForForm(node, indentLevel, options);
                case 'fn':
                    return this.formatFnForm(node, indentLevel, options);
                case 'defenum':
                    return this.formatDefenumForm(node, indentLevel, options);
                case 'hash-map':
                    return this.formatHashMapForm(node, indentLevel, options);
                // Other special forms...
            }
        }
        
        // Default list formatting
        const firstElement = this.formatNode(node.elements[0], indentLevel, options);
        const restIndent = indentLevel + 1;
        
        // Check if this is a short form that can fit on one line
        const isShortForm = node.elements.length <= 3 && 
            !this.containsMultilineNodes(node.elements.slice(1)) &&
            this.estimateLineLength(node, indentLevel, options) <= 80;
        
        if (isShortForm) {
            const restElements = node.elements.slice(1)
                .map(el => this.formatNode(el, restIndent, options))
                .join(' ');
            
            return `(${firstElement} ${restElements})`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const innerIndent = this.getIndent(restIndent, options);
        
        const restElements = node.elements.slice(1)
            .map(el => `${innerIndent}${this.formatNode(el, restIndent, options)}`)
            .join('\n');
        
        return `(${firstElement}\n${restElements}\n${indent})`;
    }
    
    /**
     * Format a node as an array literal [a b c]
     */
    private formatArrayLiteral(node: ListNode, indentLevel: number, options: FormatOptions): string {
        // Handle empty arrays
        if (node.elements.length === 0) {
            return '[]';
        }
        
        // Check if this is a short array that can fit on one line
        const isShortArray = node.elements.length <= 5 && 
            !this.containsMultilineNodes(node.elements) &&
            this.estimateLineLength(node, indentLevel, options) <= 80;
        
        if (isShortArray) {
            const elements = node.elements
                .map(el => this.formatNode(el, indentLevel, options))
                .join(', ');
            
            return `[${elements}]`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const innerIndent = this.getIndent(indentLevel + 1, options);
        
        const elements = node.elements
            .map(el => `${innerIndent}${this.formatNode(el, indentLevel + 1, options)}`)
            .join(',\n');
        
        return `[\n${elements}\n${indent}]`;
    }
    
    /**
     * Check if a list represents a JSON-style object literal
     */
    private isObjectLiteral(node: ListNode): boolean {
        // If it's not a hash-map form and has a double-element pattern with string keys, 
        // it's likely a JSON-style object
        if (node.elements[0].type === 'symbol' && 
            (node.elements[0] as SymbolNode).name === 'hash-map') {
            return false;
        }
        
        if (node.elements.length < 3 || node.elements.length % 2 !== 1) {
            return false;
        }
        
        // Check if all keys are string literals
        for (let i = 1; i < node.elements.length; i += 2) {
            const key = node.elements[i];
            if (key.type !== 'literal' || typeof (key as LiteralNode).value !== 'string') {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Format a node as a JSON-style object literal {a: 1, b: 2}
     */
    private formatObjectLiteral(node: ListNode, indentLevel: number, options: FormatOptions): string {
        // Handle empty objects
        if (node.elements.length <= 1) {
            return '{}';
        }
        
        // Collect key-value pairs
        const pairs = [];
        for (let i = 1; i < node.elements.length; i += 2) {
            const key = node.elements[i] as LiteralNode;
            const value = i + 1 < node.elements.length ? node.elements[i + 1] : null;
            
            if (value) {
                pairs.push({ key, value });
            }
        }
        
        // Check if this is a short object that can fit on one line
        const isShortObject = pairs.length <= 3 && 
            !this.containsMultilineValues(pairs) &&
            this.estimateObjectLength(pairs, indentLevel, options) <= 80;
        
        if (isShortObject) {
            const elements = pairs
                .map(pair => {
                    const keyStr = `"${String(pair.key.value)}"`;
                    const valueStr = this.formatNode(pair.value, indentLevel, options);
                    return `${keyStr}: ${valueStr}`;
                })
                .join(', ');
            
            return `{${elements}}`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const innerIndent = this.getIndent(indentLevel + 1, options);
        
        const elements = pairs
            .map(pair => {
                const keyStr = `"${String(pair.key.value)}"`;
                const valueStr = this.formatNode(pair.value, indentLevel + 1, options);
                return `${innerIndent}${keyStr}: ${valueStr}`;
            })
            .join(',\n');
        
        return `{\n${elements}\n${indent}}`;
    }
    
    /**
     * Format a def form
     */
    private formatDefForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 3) {
            // Incomplete def form
            return this.formatList(node, indentLevel, options);
        }
        
        const name = this.formatNode(node.elements[1], indentLevel, options);
        const value = this.formatNode(node.elements[2], indentLevel + 1, options);
        
        // Check if the value is multiline
        if (value.includes('\n')) {
            const indent = this.getIndent(indentLevel, options);
            const innerIndent = this.getIndent(indentLevel + 1, options);
            return `(def ${name}\n${innerIndent}${value}\n${indent})`;
        } else {
            return `(def ${name} ${value})`;
        }
    }
    
    /**
     * Format a defn form
     */
    private formatDefnForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 4) {
            // Incomplete defn form
            return this.formatList(node, indentLevel, options);
        }
        
        const name = this.formatNode(node.elements[1], indentLevel, options);
        const params = this.formatNode(node.elements[2], indentLevel, options);
        
        // Check for return type annotation (->)
        let returnType = '';
        let bodyStartIndex = 3;
        
        if (node.elements.length > 4 && 
            node.elements[3].type === 'symbol' && 
            (node.elements[3] as SymbolNode).name === '->') {
            
            returnType = ` -> ${this.formatNode(node.elements[4], indentLevel, options)}`;
            bodyStartIndex = 5;
        }
        
        // Format the body
        const indent = this.getIndent(indentLevel, options);
        const bodyIndent = this.getIndent(indentLevel + 1, options);
        
        const body = node.elements.slice(bodyStartIndex)
            .map(el => `${bodyIndent}${this.formatNode(el, indentLevel + 1, options)}`)
            .join('\n');
        
        return `(defn ${name} ${params}${returnType}\n${body}\n${indent})`;
    }
    
    /**
     * Format a fn form
     */
    private formatFnForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 3) {
            // Incomplete fn form
            return this.formatList(node, indentLevel, options);
        }
        
        const params = this.formatNode(node.elements[1], indentLevel, options);
        
        // Check for return type annotation (->)
        let returnType = '';
        let bodyStartIndex = 2;
        
        if (node.elements.length > 3 && 
            node.elements[2].type === 'symbol' && 
            (node.elements[2] as SymbolNode).name === '->') {
            
            returnType = ` -> ${this.formatNode(node.elements[3], indentLevel, options)}`;
            bodyStartIndex = 4;
        }
        
        // Format the body
        const indent = this.getIndent(indentLevel, options);
        const bodyIndent = this.getIndent(indentLevel + 1, options);
        
        const body = node.elements.slice(bodyStartIndex)
            .map(el => `${bodyIndent}${this.formatNode(el, indentLevel + 1, options)}`)
            .join('\n');
        
        return `(fn ${params}${returnType}\n${body}\n${indent})`;
    }
    
    /**
     * Format a let form
     */
    private formatLetForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 3) {
            // Incomplete let form
            return this.formatList(node, indentLevel, options);
        }
        
        const bindingVector = this.formatBindingVector(node.elements[1] as ListNode, indentLevel + 1, options);
        
        // Format the body
        const indent = this.getIndent(indentLevel, options);
        const bodyIndent = this.getIndent(indentLevel + 1, options);
        
        const body = node.elements.slice(2)
            .map(el => `${bodyIndent}${this.formatNode(el, indentLevel + 1, options)}`)
            .join('\n');
        
        return `(let ${bindingVector}\n${body}\n${indent})`;
    }
    
    /**
     * Format a binding vector for let forms
     */
    private formatBindingVector(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length === 0) {
            return '[]';
        }
        
        // Check if the binding vector can fit on one line
        const isShort = node.elements.length <= 6 && 
            !this.containsMultilineNodes(node.elements) &&
            this.estimateLineLength(node, indentLevel, options) <= 60;
        
        if (isShort) {
            const bindings = [];
            for (let i = 0; i < node.elements.length; i += 2) {
                const name = this.formatNode(node.elements[i], indentLevel, options);
                const value = i + 1 < node.elements.length 
                    ? this.formatNode(node.elements[i + 1], indentLevel, options) 
                    : '';
                
                bindings.push(`${name} ${value}`);
            }
            
            return `[${bindings.join(' ')}]`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const innerIndent = this.getIndent(indentLevel + 1, options);
        
        const bindings = [];
        for (let i = 0; i < node.elements.length; i += 2) {
            const name = this.formatNode(node.elements[i], indentLevel + 1, options);
            const value = i + 1 < node.elements.length 
                ? this.formatNode(node.elements[i + 1], indentLevel + 1, options) 
                : '';
            
            bindings.push(`${innerIndent}${name} ${value}`);
        }
        
        return `[\n${bindings.join('\n')}\n${indent}]`;
    }
    
    /**
     * Format an if form
     */
    private formatIfForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 3) {
            // Incomplete if form
            return this.formatList(node, indentLevel, options);
        }
        
        const condition = this.formatNode(node.elements[1], indentLevel + 1, options);
        const thenBranch = this.formatNode(node.elements[2], indentLevel + 1, options);
        
        // If this is a simple if with no else branch
        if (node.elements.length < 4) {
            return `(if ${condition}\n${this.getIndent(indentLevel + 1, options)}${thenBranch}\n${this.getIndent(indentLevel, options)})`;
        }
        
        const elseBranch = this.formatNode(node.elements[3], indentLevel + 1, options);
        
        // Check if the if form can fit on one line
        const isShort = !condition.includes('\n') && !thenBranch.includes('\n') && !elseBranch.includes('\n') &&
            condition.length + thenBranch.length + elseBranch.length < 60;
        
        if (isShort) {
            return `(if ${condition} ${thenBranch} ${elseBranch})`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const bodyIndent = this.getIndent(indentLevel + 1, options);
        
        return `(if ${condition}\n${bodyIndent}${thenBranch}\n${bodyIndent}${elseBranch}\n${indent})`;
    }
    
    /**
     * Format a cond form
     */
    private formatCondForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 3) {
            // Incomplete cond form
            return this.formatList(node, indentLevel, options);
        }
        
        const indent = this.getIndent(indentLevel, options);
        const clauseIndent = this.getIndent(indentLevel + 1, options);
        
        const clauses = [];
        for (let i = 1; i < node.elements.length; i += 2) {
            const test = this.formatNode(node.elements[i], indentLevel + 1, options);
            const expr = i + 1 < node.elements.length 
                ? this.formatNode(node.elements[i + 1], indentLevel + 1, options) 
                : '';
            
            clauses.push(`${clauseIndent}${test} ${expr}`);
        }
        
        return `(cond\n${clauses.join('\n')}\n${indent})`;
    }
    
    /**
     * Format a for form
     */
    private formatForForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 3) {
            // Incomplete for form
            return this.formatList(node, indentLevel, options);
        }
        
        const bindingVector = this.formatNode(node.elements[1], indentLevel, options);
        
        // Format the body
        const indent = this.getIndent(indentLevel, options);
        const bodyIndent = this.getIndent(indentLevel + 1, options);
        
        const body = node.elements.slice(2)
            .map(el => `${bodyIndent}${this.formatNode(el, indentLevel + 1, options)}`)
            .join('\n');
        
        return `(for ${bindingVector}\n${body}\n${indent})`;
    }
    
    /**
     * Format a defenum form
     */
    private formatDefenumForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 2) {
            // Incomplete defenum form
            return this.formatList(node, indentLevel, options);
        }
        
        const name = this.formatNode(node.elements[1], indentLevel, options);
        
        // Check if the enum values can fit on one line
        const values = node.elements.slice(2)
            .map(el => this.formatNode(el, indentLevel, options));
        
        const isShort = values.length <= 5 && 
            values.join(' ').length < 60;
        
        if (isShort) {
            return `(defenum ${name} ${values.join(' ')})`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const valueIndent = this.getIndent(indentLevel + 1, options);
        
        return `(defenum ${name}\n${valueIndent}${values.join(`\n${valueIndent}`)}\n${indent})`;
    }
    
    /**
     * Format a hash-map form
     */
    private formatHashMapForm(node: ListNode, indentLevel: number, options: FormatOptions): string {
        if (node.elements.length < 2) {
            // Empty hash-map
            return '(hash-map)';
        }
        
        // Collect key-value pairs
        const pairs = [];
        for (let i = 1; i < node.elements.length; i += 2) {
            const key = node.elements[i];
            const value = i + 1 < node.elements.length ? node.elements[i + 1] : null;
            
            if (value) {
                pairs.push({ key, value });
            }
        }
        
        // Check if this is a short hash-map that can fit on one line
        const isShortMap = pairs.length <= 3 && 
            !this.containsMultilinePairs(pairs, indentLevel, options) &&
            this.estimatePairsLength(pairs, indentLevel, options) <= 80;
        
        if (isShortMap) {
            const elements = pairs
                .map(pair => {
                    const keyStr = this.formatNode(pair.key, indentLevel, options);
                    const valueStr = this.formatNode(pair.value, indentLevel, options);
                    return `${keyStr} ${valueStr}`;
                })
                .join(' ');
            
            return `(hash-map ${elements})`;
        }
        
        // Multi-line formatting
        const indent = this.getIndent(indentLevel, options);
        const innerIndent = this.getIndent(indentLevel + 1, options);
        
        const elements = pairs
            .map(pair => {
                const keyStr = this.formatNode(pair.key, indentLevel + 1, options);
                const valueStr = this.formatNode(pair.value, indentLevel + 1, options);
                return `${innerIndent}${keyStr} ${valueStr}`;
            })
            .join('\n');
        
        return `(hash-map\n${elements}\n${indent})`;
    }
    
    /**
     * Generate an indent string
     */
    private getIndent(level: number, options: FormatOptions): string {
        const indentChar = options.insertSpaces ? ' ' : '\t';
        const indentSize = options.insertSpaces ? options.indentSize : 1;
        
        return indentChar.repeat(level * indentSize);
    }
    
    /**
     * Check if a list of nodes contains any multiline nodes
     */
    private containsMultilineNodes(nodes: HQLNode[]): boolean {
        for (const node of nodes) {
            if (node.type === 'list') {
                const listNode = node as ListNode;
                if (listNode.elements.length > 3) {
                    return true;
                }
                
                if (this.containsMultilineNodes(listNode.elements)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Check if a list of key-value pairs contains any multiline values
     */
    private containsMultilineValues(pairs: { key: LiteralNode, value: HQLNode }[]): boolean {
        for (const pair of pairs) {
            if (pair.value.type === 'list') {
                const listNode = pair.value as ListNode;
                if (listNode.elements.length > 3) {
                    return true;
                }
                
                if (this.containsMultilineNodes(listNode.elements)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Check if a list of key-value pairs contains any multiline nodes
     */
    private containsMultilinePairs(pairs: { key: HQLNode, value: HQLNode }[], indentLevel: number, options: FormatOptions): boolean {
        for (const pair of pairs) {
            const keyStr = this.formatNode(pair.key, indentLevel, options);
            const valueStr = this.formatNode(pair.value, indentLevel, options);
            
            if (keyStr.includes('\n') || valueStr.includes('\n')) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Estimate the length of a formatted line for a node
     */
    private estimateLineLength(node: ListNode, indentLevel: number, options: FormatOptions): number {
        const indent = this.getIndent(indentLevel, options);
        let length = indent.length + 2; // Account for parentheses or brackets
        
        for (const element of node.elements) {
            // Simplified estimate
            if (element.type === 'symbol') {
                length += (element as SymbolNode).name.length + 1;
            } else if (element.type === 'literal') {
                const value = (element as LiteralNode).value;
                if (typeof value === 'string') {
                    length += value.length + 3; // Account for quotes and space
                } else {
                    length += String(value).length + 1; // Account for space
                }
            } else if (element.type === 'list') {
                // Assume lists push to multiple lines if not a simple list
                if ((element as ListNode).elements.length > 2) {
                    return 1000; // Force multiline
                }
                length += 10; // Rough estimate
            }
        }
        
        return length;
    }
    
    /**
     * Estimate the length of a formatted object
     */
    private estimateObjectLength(pairs: { key: LiteralNode, value: HQLNode }[], indentLevel: number, options: FormatOptions): number {
        const indent = this.getIndent(indentLevel, options);
        let length = indent.length + 2; // Account for braces
        
        for (const pair of pairs) {
            const keyLength = String(pair.key.value).length + 4; // Account for quotes, colon and space
            
            if (pair.value.type === 'symbol') {
                length += keyLength + (pair.value as SymbolNode).name.length + 2;
            } else if (pair.value.type === 'literal') {
                const value = (pair.value as LiteralNode).value;
                if (typeof value === 'string') {
                    length += keyLength + value.length + 4; // Account for quotes and comma
                } else {
                    length += keyLength + String(value).length + 2; // Account for comma
                }
            } else if (pair.value.type === 'list') {
                // Assume lists push to multiple lines if not a simple list
                if ((pair.value as ListNode).elements.length > 2) {
                    return 1000; // Force multiline
                }
                length += keyLength + 10; // Rough estimate
            }
        }
        
        return length;
    }
    
    /**
     * Estimate the length of formatted key-value pairs
     */
    private estimatePairsLength(pairs: { key: HQLNode, value: HQLNode }[], indentLevel: number, options: FormatOptions): number {
        const indent = this.getIndent(indentLevel, options);
        let length = indent.length + 10; // Account for hash-map and parentheses
        
        for (const pair of pairs) {
            if (pair.key.type === 'symbol') {
                length += (pair.key as SymbolNode).name.length + 1;
            } else if (pair.key.type === 'literal') {
                const value = (pair.key as LiteralNode).value;
                if (typeof value === 'string') {
                    length += value.length + 3; // Account for quotes and space
                } else {
                    length += String(value).length + 1; // Account for space
                }
            }
            
            if (pair.value.type === 'symbol') {
                length += (pair.value as SymbolNode).name.length + 1;
            } else if (pair.value.type === 'literal') {
                const value = (pair.value as LiteralNode).value;
                if (typeof value === 'string') {
                    length += value.length + 3; // Account for quotes and space
                } else {
                    length += String(value).length + 1; // Account for space
                }
            } else if (pair.value.type === 'list') {
                // Assume lists push to multiple lines if not a simple list
                if ((pair.value as ListNode).elements.length > 2) {
                    return 1000; // Force multiline
                }
                length += 10; // Rough estimate
            }
        }
        
        return length;
    }
}