// server/src/utilities/astUtils.ts
import { HQLNode, ListNode } from './astTypes';

/**
 * Utility functions for working with HQL AST
 */
export class ASTUtils {
  /**
   * Find all nodes in the AST that match a given predicate
   */
  public static findNodes(ast: HQLNode[] | null, predicate: (node: HQLNode) => boolean): HQLNode[] {
    if (!ast) return [];
    
    const result: HQLNode[] = [];
    
    const walk = (node: HQLNode) => {
      if (predicate(node)) {
        result.push(node);
      }
      
      if (node.type === 'list') {
        const listNode = node as ListNode;
        for (const element of listNode.elements) {
          walk(element);
        }
      }
    };
    
    for (const node of ast) {
      walk(node);
    }
    
    return result;
  }
  
  /**
   * Check if a node is a specific type of form (e.g., defn, def, let)
   */
  public static isForm(node: HQLNode, formName: string): boolean {
    if (node.type !== 'list') return false;
    
    const listNode = node as ListNode;
    if (listNode.elements.length === 0) return false;
    
    const first = listNode.elements[0];
    if (first.type !== 'symbol') return false;
    
    return (first as any).name === formName;
  }
  
  /**
   * Extract the name from a definition form like (def name expr) or (defn name params body)
   * Returns the name node if found, or null if not a valid definition
   */
  public static getDefinitionName(node: HQLNode): HQLNode | null {
    if (node.type !== 'list') return null;
    
    const listNode = node as ListNode;
    if (listNode.elements.length < 2) return null;
    
    const first = listNode.elements[0];
    if (first.type !== 'symbol') return null;
    
    const formName = (first as any).name;
    if (formName === 'def' || formName === 'defn' || formName === 'defenum') {
      return listNode.elements[1];
    }
    
    return null;
  }
  
  /**
   * Extract the parameter list from a function definition like (defn name params body)
   * Returns the parameter list node if found, or null if not a valid function definition
   */
  public static getFunctionParams(node: HQLNode): HQLNode | null {
    if (!this.isForm(node, 'defn') && !this.isForm(node, 'fn')) return null;
    
    const listNode = node as ListNode;
    const paramsIndex = this.isForm(node, 'defn') ? 2 : 1;
    
    if (listNode.elements.length <= paramsIndex) return null;
    
    const paramsNode = listNode.elements[paramsIndex];
    if (paramsNode.type !== 'list') return null;
    
    return paramsNode;
  }
  
  /**
   * Get the scope type of a node (global, function, block, etc.)
   */
  public static getScopeType(node: HQLNode): 'global' | 'function' | 'block' | 'other' | null {
    if (node.type !== 'list') return null;
    
    const listNode = node as ListNode;
    if (listNode.elements.length === 0) return null;
    
    const first = listNode.elements[0];
    if (first.type !== 'symbol') return null;
    
    const formName = (first as any).name;
    
    switch (formName) {
      case 'def':
      case 'defenum':
        return 'global';
      case 'defn':
      case 'fn':
        return 'function';
      case 'let':
      case 'for':
      case 'if':
      case 'cond':
        return 'block';
      default:
        return 'other';
    }
  }
  
  /**
   * Parse named parameters in a function call.
   * Returns an object mapping parameter names to their nodes.
   */
  public static parseNamedParams(node: HQLNode): Record<string, HQLNode> | null {
    if (node.type !== 'list') return null;
    
    const listNode = node as ListNode;
    if (listNode.elements.length < 3) return null;
    
    const result: Record<string, HQLNode> = {};
    let i = 1;
    
    while (i < listNode.elements.length - 1) {
      const param = listNode.elements[i];
      
      // Check if this is a named parameter (symbol ending with ':')
      if (param.type === 'symbol' && (param as any).name.endsWith(':')) {
        const paramName = (param as any).name.slice(0, -1);
        const paramValue = listNode.elements[i + 1];
        
        result[paramName] = paramValue;
        i += 2;
      } else {
        // Not a named parameter, skip to next
        i++;
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
  }
}