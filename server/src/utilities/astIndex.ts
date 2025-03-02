// server/src/utilities/astIndex.ts
import { Position, Range } from 'vscode-languageserver/node';
import { HQLNode, ListNode, SymbolNode, LiteralNode } from './astTypes';

/**
 * Class for efficient AST node lookup by position.
 * This creates an index of nodes by position for faster lookups.
 */
export class ASTIndex {
    // Main position index: map of nodes by position range
    private nodesByPosition: Map<string, HQLNode> = new Map();
    
    // Secondary indices for quick lookup
    private symbolNodes: Map<string, SymbolNode[]> = new Map();
    private listNodes: ListNode[] = [];
    private literalNodes: LiteralNode[] = [];
    
    /**
     * Clear the index
     */
    public clear(): void {
        this.nodesByPosition.clear();
        this.symbolNodes.clear();
        this.listNodes = [];
        this.literalNodes = [];
    }
    
    /**
     * Build the index for an AST
     */
    public build(ast: HQLNode[] | null, document: any): void {
        this.clear();
        
        if (!ast) return;
        
        // Walk the AST and index all nodes with positions
        this.walkAST(ast);
    }
    
    /**
     * Walk the AST and index all nodes
     */
    private walkAST(nodes: HQLNode[] | HQLNode): void {
        if (Array.isArray(nodes)) {
            for (const node of nodes) {
                this.walkAST(node);
            }
            return;
        }
        
        // Index this node
        this.indexNode(nodes);
        
        // Recursively index child nodes
        if (nodes.type === 'list') {
            const listNode = nodes as ListNode;
            this.listNodes.push(listNode);
            
            for (const element of listNode.elements) {
                this.walkAST(element);
            }
        }
    }
    
    /**
     * Index a single node
     */
    private indexNode(node: HQLNode): void {
        // Skip nodes without position information
        if (!node.position) return;
        
        const position = node.position as Range;
        
        // Index by position
        const positionKey = this.rangeToKey(position);
        this.nodesByPosition.set(positionKey, node);
        
        // Index by node type
        if (node.type === 'symbol') {
            const symbolNode = node as SymbolNode;
            const name = symbolNode.name;
            
            if (!this.symbolNodes.has(name)) {
                this.symbolNodes.set(name, []);
            }
            
            this.symbolNodes.get(name)!.push(symbolNode);
        } else if (node.type === 'literal') {
            this.literalNodes.push(node as LiteralNode);
        }
    }
    
    /**
     * Convert a range to a string key for the index
     */
    private rangeToKey(range: Range): string {
        return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
    }
    
    /**
     * Get a node at a position
     */
    public getNodeAtPosition(position: Position): HQLNode | null {
        // We need to find the smallest range that contains the position
        let bestMatch: { node: HQLNode, size: number } | null = null;
        
        for (const [key, node] of this.nodesByPosition.entries()) {
            if (!node.position) continue;
            
            const range = node.position as Range;
            
            // Check if this range contains the position
            if (this.isPositionInRange(position, range)) {
                const size = this.rangeSize(range);
                
                // Keep the smallest range that contains the position
                if (!bestMatch || size < bestMatch.size) {
                    bestMatch = { node, size };
                }
            }
        }
        
        return bestMatch ? bestMatch.node : null;
    }
    
    /**
     * Get all nodes of a specific type (symbol, list, literal)
     */
    public getNodesByType(type: 'symbol' | 'list' | 'literal'): HQLNode[] {
        switch (type) {
            case 'symbol':
                return Array.from(this.symbolNodes.values()).flat();
            case 'list':
                return this.listNodes;
            case 'literal':
                return this.literalNodes;
            default:
                return [];
        }
    }
    
    /**
     * Get all symbol nodes with a specific name
     */
    public getSymbolNodesByName(name: string): SymbolNode[] {
        return this.symbolNodes.get(name) || [];
    }
    
    /**
     * Find all nodes that match a predicate
     */
    public findNodes(predicate: (node: HQLNode) => boolean): HQLNode[] {
        const result: HQLNode[] = [];
        
        // Check all indexed nodes
        for (const node of this.nodesByPosition.values()) {
            if (predicate(node)) {
                result.push(node);
            }
        }
        
        return result;
    }
    
    /**
     * Check if a position is within a range
     */
    private isPositionInRange(position: Position, range: Range): boolean {
        // Position is before range
        if (position.line < range.start.line || 
            (position.line === range.start.line && position.character < range.start.character)) {
            return false;
        }
        
        // Position is after range
        if (position.line > range.end.line || 
            (position.line === range.end.line && position.character > range.end.character)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Calculate the size of a range (in characters)
     */
    private rangeSize(range: Range): number {
        if (range.start.line === range.end.line) {
            return range.end.character - range.start.character;
        }
        
        // Multi-line range - return a large number so single-line ranges are preferred
        return (range.end.line - range.start.line) * 1000 + range.end.character;
    }
}