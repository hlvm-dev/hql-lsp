// server/src/utilities/parser.ts
import { HQLNode, LiteralNode, SymbolNode, ListNode } from './astTypes';
import { Position, Range } from 'vscode-languageserver';

// Basic parsing error class
export class ParseError extends Error {
    constructor(message: string, public position: Position) {
        super(message);
        this.name = "ParseError";
    }
}

/**
 * A simple parser for HQL
 * This is a placeholder implementation - in a real environment,
 * you would use a proper parser from your HQL implementation
 */
export function parse(source: string): HQLNode[] {
    try {
        // Tokenize the source
        const tokens = tokenize(source);
        
        // Parse tokens into an AST
        const ast = parseTokens(tokens, source);
        
        return ast;
    } catch (error) {
        if (error instanceof ParseError) {
            throw error;
        }
        
        // Convert generic errors to ParseError
        throw new ParseError(
            error instanceof Error ? error.message : String(error),
            Position.create(0, 0)
        );
    }
}

// Simple tokenization function
function tokenize(source: string): { token: string, line: number, column: number }[] {
    const tokens: { token: string, line: number, column: number }[] = [];
    const lines = source.split('\n');
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let inComment = false;
        let inString = false;
        let currentToken = '';
        let tokenStartColumn = 0;
        
        for (let colIndex = 0; colIndex < line.length; colIndex++) {
            const char = line[colIndex];
            
            // Skip comments
            if (char === ';' && !inString) {
                inComment = true;
                if (currentToken) {
                    tokens.push({ 
                        token: currentToken, 
                        line: lineIndex, 
                        column: tokenStartColumn 
                    });
                    currentToken = '';
                }
                continue;
            }
            
            if (inComment) continue;
            
            // Handle strings
            if (char === '"') {
                if (inString) {
                    // End of string
                    currentToken += char;
                    tokens.push({ 
                        token: currentToken, 
                        line: lineIndex, 
                        column: tokenStartColumn 
                    });
                    currentToken = '';
                    inString = false;
                } else {
                    // Start of string
                    if (currentToken) {
                        tokens.push({ 
                            token: currentToken, 
                            line: lineIndex, 
                            column: tokenStartColumn 
                        });
                    }
                    currentToken = char;
                    tokenStartColumn = colIndex;
                    inString = true;
                }
                continue;
            }
            
            if (inString) {
                currentToken += char;
                continue;
            }
            
            // Handle brackets
            if (char === '(' || char === ')' || char === '[' || char === ']' || char === '{' || char === '}') {
                if (currentToken) {
                    tokens.push({ 
                        token: currentToken, 
                        line: lineIndex, 
                        column: tokenStartColumn 
                    });
                }
                tokens.push({ 
                    token: char, 
                    line: lineIndex, 
                    column: colIndex 
                });
                currentToken = '';
                continue;
            }
            
            // Handle whitespace
            if (/\\s/.test(char)) {
                if (currentToken) {
                    tokens.push({ 
                        token: currentToken, 
                        line: lineIndex, 
                        column: tokenStartColumn 
                    });
                    currentToken = '';
                }
                continue;
            }
            
            // Accumulate token
            if (!currentToken) {
                tokenStartColumn = colIndex;
            }
            currentToken += char;
        }
        
        // Don't forget any remaining token
        if (currentToken && !inComment) {
            tokens.push({ 
                token: currentToken, 
                line: lineIndex, 
                column: tokenStartColumn 
            });
        }
    }
    
    return tokens;
}

// Basic parsing function
function parseTokens(tokens: { token: string, line: number, column: number }[], source: string): HQLNode[] {
    const ast: HQLNode[] = [];
    let position = 0;
    
    function parseExpression(): HQLNode | null {
        if (position >= tokens.length) return null;
        
        const token = tokens[position];
        position++;
        
        // Create Position/Range information
        const range = Range.create(
            Position.create(token.line, token.column),
            Position.create(token.line, token.column + token.token.length)
        );
        
        // Handle lists
        if (token.token === '(') {
            return parseList(')', range);
        } else if (token.token === '[') {
            return parseList(']', range, true);
        } else if (token.token === '{') {
            return parseList('}', range);
        } else if (token.token === ')' || token.token === ']' || token.token === '}') {
            // Unexpected closing bracket
            throw new ParseError(`Unexpected '${token.token}'`, Position.create(token.line, token.column));
        }
        
        // Handle literals
        if (token.token.startsWith('"')) {
            // String literal
            const value = token.token.substring(1, token.token.length - 1);
            return {
                type: 'literal',
                value,
                position: range
            } as LiteralNode;
        } else if (token.token === 'true') {
            return {
                type: 'literal',
                value: true,
                position: range
            } as LiteralNode;
        } else if (token.token === 'false') {
            return {
                type: 'literal',
                value: false,
                position: range
            } as LiteralNode;
        } else if (token.token === 'nil' || token.token === 'null') {
            return {
                type: 'literal',
                value: null,
                position: range
            } as LiteralNode;
        } else if (!isNaN(Number(token.token))) {
            // Number literal
            return {
                type: 'literal',
                value: Number(token.token),
                position: range
            } as LiteralNode;
        }
        
        // Default: symbol
        return {
            type: 'symbol',
            name: token.token,
            position: range
        } as SymbolNode;
    }
    
    function parseList(closingDelimiter: string, openRange: Range, isArrayLiteral: boolean = false): ListNode {
        const elements: HQLNode[] = [];
        const startPosition = openRange.start;
        
        while (position < tokens.length && tokens[position].token !== closingDelimiter) {
            const element = parseExpression();
            if (element) elements.push(element);
        }
        
        if (position >= tokens.length) {
            throw new ParseError(
                `Unclosed delimiter starting at line ${startPosition.line + 1}, column ${startPosition.character + 1}`,
                startPosition
            );
        }
        
        // Get the closing delimiter position
        const endRange = Range.create(
            Position.create(tokens[position].line, tokens[position].column),
            Position.create(tokens[position].line, tokens[position].column + 1)
        );
        position++; // Skip the closing delimiter
        
        // Create range for the whole list
        const listRange = Range.create(
            openRange.start,
            endRange.end
        );
        
        return {
            type: 'list',
            elements,
            isArrayLiteral,
            position: listRange
        } as ListNode;
    }
    
    // Parse the tokens
    while (position < tokens.length) {
        const expr = parseExpression();
        if (expr) ast.push(expr);
    }
    
    return ast;
}