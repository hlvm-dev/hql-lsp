// server/src/utilities/symbolTable.ts
import { HQLNode, ListNode, SymbolNode } from './astTypes';

export interface SymbolInfo {
    name: string;
    kind: 'variable' | 'function' | 'enum' | 'enum-value' | 'parameter';
    node: HQLNode;
    parentScope?: string;
    type?: string;
    params?: any[];
    enumValues?: string[];
    references?: HQLNode[];
}

export class SymbolTable {
    private symbols: Map<string, SymbolInfo>;
    private scopes: Map<string, Set<string>>;
    private currentScope: string | undefined;

    constructor() {
        this.symbols = new Map();
        this.scopes = new Map();
        this.currentScope = undefined;
    }

    public clear(): void {
        this.symbols.clear();
        this.scopes.clear();
        this.currentScope = undefined;
    }

    public enterScope(scopeName: string | undefined): void {
        if (!scopeName) return;
        
        this.currentScope = scopeName;
        if (!this.scopes.has(scopeName)) {
            this.scopes.set(scopeName, new Set());
        }
    }

    public exitScope(): void {
        this.currentScope = undefined;
    }

    public addVariable(name: string, node: HQLNode, type?: string): void {
        const symbolInfo: SymbolInfo = {
            name,
            kind: 'variable',
            node,
            type,
            parentScope: this.currentScope,
            references: []
        };
        
        this.symbols.set(name, symbolInfo);
        
        if (this.currentScope) {
            const scopeSymbols = this.scopes.get(this.currentScope);
            if (scopeSymbols) {
                scopeSymbols.add(name);
            }
        }
    }

    public addFunction(name: string, params: any[], returnType: string | null, node: HQLNode): void {
        const symbolInfo: SymbolInfo = {
            name,
            kind: 'function',
            node,
            type: returnType || undefined,
            params,
            parentScope: this.currentScope,
            references: []
        };
        
        this.symbols.set(name, symbolInfo);
        
        // Enter function scope
        this.enterScope(name);
        
        // Add parameters to the function scope
        for (const param of params) {
            this.addParameter(param.name, param.type, name);
        }
        
        // Exit function scope
        this.exitScope();
        
        if (this.currentScope) {
            const scopeSymbols = this.scopes.get(this.currentScope);
            if (scopeSymbols) {
                scopeSymbols.add(name);
            }
        }
    }

    public addParameter(name: string, type: string | undefined, scopeName: string | undefined): void {
        if (!scopeName) return;
        
        const symbolInfo: SymbolInfo = {
            name,
            kind: 'parameter',
            node: { type: 'symbol', name } as SymbolNode, // Simplified node since we don't have a real one
            type,
            parentScope: scopeName,
            references: []
        };
        
        // Create a unique name for the parameter in this scope
        const scopedName = `${scopeName}.${name}`;
        this.symbols.set(scopedName, symbolInfo);
        
        const scopeSymbols = this.scopes.get(scopeName);
        if (scopeSymbols) {
            scopeSymbols.add(scopedName);
        }
    }

    public addEnum(name: string, values: string[], node: HQLNode): void {
        const symbolInfo: SymbolInfo = {
            name,
            kind: 'enum',
            node,
            enumValues: values,
            parentScope: this.currentScope,
            references: []
        };
        
        this.symbols.set(name, symbolInfo);
        
        // Add enum values
        for (const value of values) {
            this.addEnumValue(name, value, node);
        }
        
        if (this.currentScope) {
            const scopeSymbols = this.scopes.get(this.currentScope);
            if (scopeSymbols) {
                scopeSymbols.add(name);
            }
        }
    }

    private addEnumValue(enumName: string, valueName: string, node: HQLNode): void {
        const symbolInfo: SymbolInfo = {
            name: valueName,
            kind: 'enum-value',
            node,
            parentScope: enumName,
            references: []
        };
        
        // Create a unique name for the enum value
        const scopedName = `${enumName}.${valueName}`;
        this.symbols.set(scopedName, symbolInfo);
    }

    public addReference(symbol: SymbolInfo, node: HQLNode): void {
        if (symbol && symbol.references) {
            symbol.references.push(node);
        }
    }

    public findSymbol(name: string): SymbolInfo | undefined {
        // Check for direct match
        if (this.symbols.has(name)) {
            return this.symbols.get(name);
        }
        
        // Check for scoped match if in a scope
        if (this.currentScope) {
            const scopedName = `${this.currentScope}.${name}`;
            if (this.symbols.has(scopedName)) {
                return this.symbols.get(scopedName);
            }
        }
        
        // Check for enum value match
        for (const [key, info] of this.symbols.entries()) {
            if (info.kind === 'enum' && info.enumValues && info.enumValues.includes(name)) {
                return this.symbols.get(`${info.name}.${name}`);
            }
        }
        
        return undefined;
    }

    public getAllSymbols(): SymbolInfo[] {
        return Array.from(this.symbols.values());
    }

    public getSymbolsInScope(scopeName: string): SymbolInfo[] {
        const result: SymbolInfo[] = [];
        const scopeSymbols = this.scopes.get(scopeName);
        
        if (scopeSymbols) {
            for (const name of scopeSymbols) {
                const symbol = this.symbols.get(name);
                if (symbol) {
                    result.push(symbol);
                }
            }
        }
        
        return result;
    }

    public getGlobalSymbols(): SymbolInfo[] {
        const result: SymbolInfo[] = [];
        
        for (const [_, info] of this.symbols.entries()) {
            if (!info.parentScope) {
                result.push(info);
            }
        }
        
        return result;
    }
}