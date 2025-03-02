// server/src/documentManager.ts
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HQLDocument } from './hqlDocument';
import { Logger } from './utilities/logger';

/**
 * Manages documents being edited in the client.
 * This provides a centralized cache to avoid redundant parsing.
 */
export class DocumentManager {
    private documents: Map<string, HQLDocument> = new Map();
    private logger: Logger;
    
    constructor(logger: Logger) {
        this.logger = logger;
    }
    
    /**
     * Get an HQL document from the cache, or create a new one if it doesn't exist
     */
    public getDocument(document: TextDocument): HQLDocument {
        const uri = document.uri;
        
        // Check cache first
        let hqlDocument = this.documents.get(uri);
        
        if (hqlDocument) {
            // Update the document if it's outdated
            if (hqlDocument.getVersion() < document.version) {
                this.logger.log(`Updating document ${uri} (version ${hqlDocument.getVersion()} -> ${document.version})`);
                hqlDocument.update(document);
            }
        } else {
            // Create a new document
            this.logger.log(`Creating new document ${uri} (version ${document.version})`);
            hqlDocument = new HQLDocument(document, this.logger);
            this.documents.set(uri, hqlDocument);
        }
        
        return hqlDocument!;
    }
    
    /**
     * Remove a document from the cache
     */
    public removeDocument(uri: string): void {
        this.logger.log(`Removing document ${uri}`);
        this.documents.delete(uri);
    }
    
    /**
     * Get all documents
     */
    public getAllDocuments(): HQLDocument[] {
        return Array.from(this.documents.values());
    }
    
    /**
     * Clear all documents
     */
    public clear(): void {
        this.logger.log('Clearing all documents');
        this.documents.clear();
    }
}