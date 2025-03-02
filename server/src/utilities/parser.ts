// server/src/utilities/parser.ts
import { HQLNode, LiteralNode, SymbolNode, ListNode } from './astTypes';
import { Logger } from './logger';

// Import original parser from the transpiler
import { parse as transpilerParse } from '../../../src/transpiler/parser';

// Cache recently parsed content for better performance
const parseCache = new Map<string, { ast: HQLNode[], timestamp: number }>();
const MAX_CACHE_SIZE = 100;
const MAX_CACHE_AGE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Parse HQL source code into an AST, with position information added.
 * Uses caching for better performance.
 */
export function parse(source: string, logger?: Logger): HQLNode[] {
    // Create a cache key from the source content
    const cacheKey = hashSource(source);
    
    // Check cache
    const cached = parseCache.get(cacheKey);
    if (cached) {
        // Only use cache if it's not too old
        if (Date.now() - cached.timestamp < MAX_CACHE_AGE_MS) {
            logger?.debug(`Using cached AST for source (${source.length} bytes)`);
            return cached.ast;
        }
        
        // Cache is too old, remove it
        parseCache.delete(cacheKey);
    }
    
    // Parse the source
    const startTime = Date.now();
    const ast = transpilerParse(source);
    
    // Add position information to the AST
    enhanceASTWithPositions(ast, source);
    
    // Cache the result
    cacheResult(cacheKey, ast);
    
    const elapsed = Date.now() - startTime;
    logger?.debug(`Parsed source (${source.length} bytes) in ${elapsed}ms`);
    
    return ast;
}

/**
 * Create a hash of the source code for caching
 */
function hashSource(source: string): string {
    // Simple hash function (djb2)
    let hash = 5381;
    for (let i = 0; i < source.length; i++) {
        hash = ((hash << 5) + hash) + source.charCodeAt(i);
    }
    return String(hash);
}

/**
 * Cache a parse result
 */
function cacheResult(key: string, ast: HQLNode[]): void {
    // Limit cache size
    if (parseCache.size >= MAX_CACHE_SIZE) {
        // Remove oldest entry
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        
        for (const [k, v] of parseCache.entries()) {
            if (v.timestamp < oldestTime) {
                oldestTime = v.timestamp;
                oldestKey = k;
            }
        }
        
        if (oldestKey) {
            parseCache.delete(oldestKey);
        }
    }
    
    // Add to cache
    parseCache.set(key, {
        ast,
        timestamp: Date.now()
    });
}

/**
 * Clear the parse cache
 */
export function clearParseCache(): void {
    parseCache.clear();
}

/**
 * Add position information to the AST for LSP features like hover, go-to-definition, etc.
 * This modifies the AST in-place.
 */
function enhanceASTWithPositions(ast: HQLNode[], source: string): void {
    // Create a line offset map for efficient position lookups
    const lineOffsets = getLineOffsets(source);
    
    // Build a token map for each node
    const tokenMap = generateTokenMap(source);
    
    // Add position information to each node
    addPositionToNodes(ast, tokenMap, lineOffsets);
}

/**
 * Generate a mapping of tokens to their positions in the source
 */
function generateTokenMap(source: string): Map<string, { start: number, end: number }[]> {
    const tokenMap = new Map<string, { start: number, end: number }[]>();
    
    // Regular expressions for different token types
    const tokenPatterns = [
        // Symbols
        /[\w\-\+\*\/\<\>\=\!\?\.]+/g,
        // Strings
        /"(?:[^"\\]|\\.)*"/g,
        // Numbers
        /\b\d+(?:\.\d+)?\b/g,
        // Parentheses and brackets
        /[\(\)\[\]\{\}]/g,
        // Keywords
        /\b(?:true|false|nil|null)\b/g
    ];
    
    // Find all tokens in the source
    for (const pattern of tokenPatterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const token = match[0];
            const start = match.index;
            const end = start + token.length;
            
            if (!tokenMap.has(token)) {
                tokenMap.set(token, []);
            }
            
            tokenMap.get(token)!.push({ start, end });
        }
    }
    
    return tokenMap;
}

/**
 * Add position information to nodes in the AST
 */
function addPositionToNodes(
    nodes: HQLNode[] | HQLNode,
    tokenMap: Map<string, { start: number, end: number }[]>,
    lineOffsets: number[]
): void {
    if (Array.isArray(nodes)) {
        for (const node of nodes) {
            addPositionToNodes(node, tokenMap, lineOffsets);
        }
        return;
    }
    
    // Add position to this node
    addPositionToNode(nodes, tokenMap, lineOffsets);
    
    // Recursively add positions to child nodes
    if (nodes.type === 'list') {
        const listNode = nodes as ListNode;
        for (const element of listNode.elements) {
            addPositionToNodes(element, tokenMap, lineOffsets);
        }
    }
}

/**
 * Add position information to a specific node
 */
function addPositionToNode(
    node: HQLNode,
    tokenMap: Map<string, { start: number, end: number }[]>,
    lineOffsets: number[]
): void {
    let value: string;
    
    switch (node.type) {
        case 'symbol':
            value = (node as SymbolNode).name;
            break;
        case 'literal':
            const literal = node as LiteralNode;
            if (typeof literal.value === 'string') {
                value = `"${literal.value}"`;
            } else if (literal.value === null) {
                value = 'nil';
            } else {
                value = String(literal.value);
            }
            break;
        case 'list':
            // Lists need special handling - don't try to find them by value
            addPositionToListNode(node as ListNode, tokenMap, lineOffsets);
            return;
        default:
            return;
    }
    
    // Find all occurrences of this value
    const positions = tokenMap.get(value);
    if (!positions || positions.length === 0) return;
    
    // Find the first occurrence that hasn't been used yet
    let position = positions.shift();
    if (!position) return;
    
    // Convert character positions to line/column
    const startPos = offsetToPosition(position.start, lineOffsets);
    const endPos = offsetToPosition(position.end, lineOffsets);
    
    // Attach position to the node
    (node as any).position = {
        start: startPos,
        end: endPos
    };
}

/**
 * Add position information to a list node
 */
function addPositionToListNode(
    node: ListNode,
    tokenMap: Map<string, { start: number, end: number }[]>,
    lineOffsets: number[]
): void {
    // For list nodes, we try to infer the position from the elements
    if (node.elements.length === 0) return;
    
    // Find the positions of opening and closing delimiters
    let openingPos = findDelimiterPosition('(', tokenMap);
    let closingPos = findDelimiterPosition(')', tokenMap);
    
    if (!openingPos || !closingPos) return;
    
    // Convert character positions to line/column
    const startPos = offsetToPosition(openingPos.start, lineOffsets);
    const endPos = offsetToPosition(closingPos.end, lineOffsets);
    
    // Attach position to the node
    (node as any).position = {
        start: startPos,
        end: endPos
    };
}

/**
 * Find the position of the next delimiter
 */
function findDelimiterPosition(
    delimiter: string,
    tokenMap: Map<string, { start: number, end: number }[]>
): { start: number, end: number } | null {
    const positions = tokenMap.get(delimiter);
    if (!positions || positions.length === 0) return null;
    
    // Find the first occurrence that hasn't been used yet
    return positions.shift() || null;
}

/**
 * Convert a character offset to a line/column position
 */
function offsetToPosition(
    offset: number,
    lineOffsets: number[]
): { line: number, character: number } {
    let low = 0;
    let high = lineOffsets.length;
    
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (lineOffsets[mid] > offset) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    
    // low is the line number now
    const line = low - 1;
    return {
        line,
        character: offset - lineOffsets[line]
    };
}

/**
 * Get the offsets of each line in the source
 */
function getLineOffsets(text: string): number[] {
    const result: number[] = [0]; // First line starts at offset 0
    
    for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        if (ch === '\r') {
            if (i + 1 < text.length && text.charAt(i + 1) === '\n') {
                i++; // Skip \n in \r\n
            }
            result.push(i + 1);
        } else if (ch === '\n') {
            result.push(i + 1);
        }
    }
    
    return result;
}