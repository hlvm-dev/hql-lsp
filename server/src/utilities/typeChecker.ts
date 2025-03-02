// server/src/utilities/typeChecker.ts
import { HQLNode, ListNode, SymbolNode, LiteralNode } from './astTypes';
import { SymbolTable, SymbolInfo } from './symbolTable';

export interface TypeInfo {
    typeName: string;
    isOptional?: boolean;
    isArray?: boolean;
    elementType?: string;
}

export class TypeChecker {
    private symbolTable: SymbolTable;
    
    constructor(symbolTable: SymbolTable) {
        this.symbolTable = symbolTable;
    }
    
    /**
     * Infer the type of a node
     */
    public inferType(node: HQLNode): TypeInfo | null {
        switch (node.type) {
            case 'symbol':
                return this.inferSymbolType(node as SymbolNode);
            case 'literal':
                return this.inferLiteralType(node as LiteralNode);
            case 'list':
                return this.inferListType(node as ListNode);
            default:
                return null;
        }
    }
    
    /**
     * Infer the type of a symbol node
     */
    private inferSymbolType(node: SymbolNode): TypeInfo | null {
        const symbolName = node.name;
        
        // Check special constants
        if (symbolName === 'true' || symbolName === 'false') {
            return { typeName: 'Boolean' };
        }
        
        if (symbolName === 'nil' || symbolName === 'null') {
            return { typeName: 'Null', isOptional: true };
        }
        
        // Look up in symbol table
        const symbol = this.symbolTable.findSymbol(symbolName);
        if (symbol) {
            return this.getTypeInfoFromSymbol(symbol);
        }
        
        return { typeName: 'Any' };
    }
    
    /**
     * Infer the type of a literal node
     */
    private inferLiteralType(node: LiteralNode): TypeInfo {
        const value = node.value;
        
        if (typeof value === 'string') {
            return { typeName: 'String' };
        }
        
        if (typeof value === 'number') {
            // Check if it's an integer
            if (Number.isInteger(value)) {
                return { typeName: 'Int' };
            }
            return { typeName: 'Number' };
        }
        
        if (typeof value === 'boolean') {
            return { typeName: 'Boolean' };
        }
        
        if (value === null) {
            return { typeName: 'Null', isOptional: true };
        }
        
        return { typeName: 'Any' };
    }
    
    /**
     * Infer the type of a list node
     */
    private inferListType(node: ListNode): TypeInfo | null {
        // Check if it's an array literal
        if ((node as any).isArrayLiteral) {
            return this.inferArrayLiteralType(node);
        }
        
        // Check if it's a special form
        if (node.elements.length > 0 && node.elements[0].type === 'symbol') {
            const formName = (node.elements[0] as SymbolNode).name;
            
            switch (formName) {
                case 'vector':
                    return this.inferVectorType(node);
                case 'list':
                    return this.inferListLiteralType(node);
                case 'hash-map':
                    return { typeName: 'Object' };
                case 'def':
                    if (node.elements.length >= 3) {
                        return this.inferType(node.elements[2]);
                    }
                    break;
                case 'if':
                case 'cond':
                    // For conditionals, we try to find a common type among branches
                    return this.inferConditionalType(node, formName);
                case 'fn':
                    return { typeName: 'Function' };
                case 'str':
                    return { typeName: 'String' };
                case 'get':
                    return this.inferPropertyAccessType(node);
                case '+':
                    // + can be numeric addition or string concatenation
                    return this.inferAdditionType(node);
                case '-':
                case '*':
                case '/':
                    return { typeName: 'Number' };
                case '<':
                case '>':
                case '<=':
                case '>=':
                case '=':
                case '!=':
                    return { typeName: 'Boolean' };
                // other special forms...
            }
        }
        
        // If it's a function call, try to infer the return type
        if (node.elements.length > 0) {
            return this.inferFunctionCallType(node);
        }
        
        return { typeName: 'Any' };
    }
    
    /**
     * Infer the type of an array literal
     */
    private inferArrayLiteralType(node: ListNode): TypeInfo {
        // If the array is empty, return Array<Any>
        if (node.elements.length === 0) {
            return { typeName: 'Array', isArray: true, elementType: 'Any' };
        }
        
        // Try to infer a common type for all elements
        const elementTypes = new Set<string>();
        
        for (const element of node.elements) {
            const type = this.inferType(element);
            if (type) {
                elementTypes.add(type.typeName);
            }
        }
        
        // If all elements have the same type, return Array<Type>
        if (elementTypes.size === 1) {
            const elementType = elementTypes.values().next().value;
            return { typeName: 'Array', isArray: true, elementType };
        }
        
        // Otherwise, return Array<Any>
        return { typeName: 'Array', isArray: true, elementType: 'Any' };
    }
    
    /**
     * Infer the type of a vector form
     */
    private inferVectorType(node: ListNode): TypeInfo {
        // The type is inferred from the elements
        const elements = node.elements.slice(1);
        
        // If there are no elements, return Array<Any>
        if (elements.length === 0) {
            return { typeName: 'Array', isArray: true, elementType: 'Any' };
        }
        
        // Try to infer a common type for all elements
        const elementTypes = new Set<string>();
        
        for (const element of elements) {
            const type = this.inferType(element);
            if (type) {
                elementTypes.add(type.typeName);
            }
        }
        
        // If all elements have the same type, return Array<Type>
        if (elementTypes.size === 1) {
            const elementType = elementTypes.values().next().value;
            return { typeName: 'Array', isArray: true, elementType };
        }
        
        // Otherwise, return Array<Any>
        return { typeName: 'Array', isArray: true, elementType: 'Any' };
    }
    
    /**
     * Infer the type of a list literal form
     */
    private inferListLiteralType(node: ListNode): TypeInfo {
        // Similar to vector
        return this.inferVectorType(node);
    }
    
    /**
     * Infer the type of a conditional (if/cond) form
     */
    private inferConditionalType(node: ListNode, formName: string): TypeInfo {
        if (formName === 'if') {
            // For if, we need at least the then-branch
            if (node.elements.length < 3) {
                return { typeName: 'Any' };
            }
            
            const thenType = this.inferType(node.elements[2]);
            
            // If there's no else-branch, the type is Optional<ThenType>
            if (node.elements.length < 4) {
                return { typeName: thenType?.typeName || 'Any', isOptional: true };
            }
            
            const elseType = this.inferType(node.elements[3]);
            
            // If both branches have the same type, return that type
            if (thenType && elseType && thenType.typeName === elseType.typeName) {
                return thenType;
            }
            
            // Otherwise, return Any
            return { typeName: 'Any' };
            
        } else if (formName === 'cond') {
            // For cond, we need to check all branches
            if (node.elements.length < 3) {
                return { typeName: 'Any' };
            }
            
            const branches = [];
            
            for (let i = 1; i < node.elements.length; i += 2) {
                // If we have an odd number of elements, the last test might not have a value
                if (i + 1 >= node.elements.length) break;
                
                const value = node.elements[i + 1];
                const type = this.inferType(value);
                
                if (type) {
                    branches.push(type);
                }
            }
            
            // If there are no branches, return Any
            if (branches.length === 0) {
                return { typeName: 'Any' };
            }
            
            // If all branches have the same type, return that type
            const firstType = branches[0].typeName;
            if (branches.every(b => b.typeName === firstType)) {
                return branches[0];
            }
            
            // Otherwise, return Any
            return { typeName: 'Any' };
        }
        
        return { typeName: 'Any' };
    }
    
    /**
     * Infer the type of a property access (get) form
     */
    private inferPropertyAccessType(node: ListNode): TypeInfo {
        // For get, we need the object and property
        if (node.elements.length < 3) {
            return { typeName: 'Any' };
        }
        
        // If the property is a literal string, we can try to be more specific
        if (node.elements[2].type === 'literal' && typeof (node.elements[2] as LiteralNode).value === 'string') {
            // In a real implementation, we would use the object's type information to determine the property type
            // For now, return Any
            return { typeName: 'Any' };
        }
        
        return { typeName: 'Any' };
    }
    
    /**
     * Infer the type of an addition (+) form
     */
    private inferAdditionType(node: ListNode): TypeInfo {
        // For +, we need at least two operands
        if (node.elements.length < 3) {
            return { typeName: 'Number' };
        }
        
        // Check if any operand is a string
        for (let i = 1; i < node.elements.length; i++) {
            const type = this.inferType(node.elements[i]);
            if (type && type.typeName === 'String') {
                return { typeName: 'String' };
            }
        }
        
        // Otherwise, assume numeric addition
        return { typeName: 'Number' };
    }
    
    /**
     * Infer the type of a function call
     */
    private inferFunctionCallType(node: ListNode): TypeInfo | null {
        const callee = node.elements[0];
        
        if (callee.type === 'symbol') {
            const symbolName = (callee as SymbolNode).name;
            const symbol = this.symbolTable.findSymbol(symbolName);
            
            if (symbol && symbol.kind === 'function') {
                // Return the function's return type if known
                if (symbol.type) {
                    return { typeName: symbol.type };
                }
            }
        }
        
        // If we can't determine the return type, return Any
        return { typeName: 'Any' };
    }
    
    /**
     * Get type information from a symbol
     */
    private getTypeInfoFromSymbol(symbol: SymbolInfo): TypeInfo | null {
        if (symbol.type) {
            return { typeName: symbol.type };
        }
        
        switch (symbol.kind) {
            case 'function':
                return { typeName: 'Function' };
            case 'enum':
                return { typeName: symbol.name };
            case 'enum-value':
                return { typeName: symbol.parentScope || 'String' };
            default:
                return { typeName: 'Any' };
        }
    }
    
    /**
     * Check if a type is compatible with an expected type
     */
    public isTypeCompatible(actualType: TypeInfo, expectedType: TypeInfo): boolean {
        // Handle Any type (anything is compatible with Any)
        if (expectedType.typeName === 'Any') {
            return true;
        }
        
        // Handle optional types
        if (expectedType.isOptional && actualType.typeName === 'Null') {
            return true;
        }
        
        // Handle array types
        if (expectedType.isArray && actualType.isArray) {
            if (!expectedType.elementType || expectedType.elementType === 'Any') {
                return true;
            }
            
            return !!actualType.elementType && actualType.elementType === expectedType.elementType;
        }
        
        // Handle numeric types (Int is compatible with Number)
        if (expectedType.typeName === 'Number' && actualType.typeName === 'Int') {
            return true;
        }
        
        // Basic type equality
        return actualType.typeName === expectedType.typeName;
    }
}