// server/src/server.ts
import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    InitializeResult,
    CompletionParams,
    HoverParams,
    DefinitionParams,
    SignatureHelpParams,
    DocumentSymbolParams,
    WorkspaceSymbolParams,
    RenameParams,
    DocumentFormattingParams,
    TextDocumentPositionParams,
    SemanticTokensParams,
    SemanticTokensRangeParams,
    SemanticTokensDeltaParams,
    CompletionItem,
    Hover,
    Location,
    SignatureHelp,
    DocumentSymbol,
    SymbolInformation,
    WorkspaceEdit,
    TextEdit,
    SemanticTokens,
    SemanticTokensDelta,
    Diagnostic
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import { DocumentManager } from './documentManager';
import { HQLDocument } from './hqlDocument';
import { CompletionProvider } from './providers/completionProvider';
import { DiagnosticsProvider } from './providers/diagnosticsProvider';
import { HoverProvider } from './providers/hoverProvider';
import { DefinitionProvider } from './providers/definitionProvider';
import { SignatureHelpProvider } from './providers/signatureHelpProvider';
import { SymbolProvider } from './providers/symbolProvider';
import { FormattingProvider } from './providers/formattingProvider';
import { RenameProvider } from './providers/renameProvider';
import { SemanticTokensProvider } from './providers/semanticTokensProvider';
import { Logger } from './utilities/logger';

/**
 * Main server class for the HQL Language Server
 */
export class HQLServer {
    private connection = createConnection(ProposedFeatures.all);
    private documents = new TextDocuments(TextDocument);
    private logger: Logger;
    private documentManager: DocumentManager;
    
    // Providers
    private completionProvider: CompletionProvider;
    private diagnosticsProvider: DiagnosticsProvider;
    private hoverProvider: HoverProvider;
    private definitionProvider: DefinitionProvider;
    private signatureHelpProvider: SignatureHelpProvider;
    private symbolProvider: SymbolProvider;
    private formattingProvider: FormattingProvider;
    private renameProvider: RenameProvider;
    private semanticTokensProvider: SemanticTokensProvider;
    
    // Settings
    private hasConfigurationCapability = false;
    private hasWorkspaceFolderCapability = false;
    private hasDiagnosticRelatedInformationCapability = false;
    
    // Default settings
    private defaultSettings = {
        maxNumberOfProblems: 1000,
        formatOptions: {
            indentSize: 2,
            insertSpaces: true
        },
        logging: {
            enabled: false,
            level: 'info'
        }
    };
    
    // Document settings cache
    private documentSettings: Map<string, Thenable<any>> = new Map();
    
    /**
     * Initialize the server
     */
    constructor() {
        // Create logger
        this.logger = new Logger(this.connection);
        
        // Create document manager
        this.documentManager = new DocumentManager(this.logger);
        
        // Create providers
        this.completionProvider = new CompletionProvider(this.logger);
        this.diagnosticsProvider = new DiagnosticsProvider(this.connection, this.logger);
        this.hoverProvider = new HoverProvider(this.logger);
        this.definitionProvider = new DefinitionProvider(this.logger);
        this.signatureHelpProvider = new SignatureHelpProvider(this.logger);
        this.symbolProvider = new SymbolProvider(this.logger);
        this.formattingProvider = new FormattingProvider(this.logger);
        this.renameProvider = new RenameProvider(this.logger);
        this.semanticTokensProvider = new SemanticTokensProvider(this.logger);
        
        // Set up event handlers
        this.setupInitialization();
        this.setupDocumentHandlers();
        this.setupRequestHandlers();
    }
    
    /**
     * Set up initialization event handlers
     */
    private setupInitialization(): void {
        // Handle initialization from the client
        this.connection.onInitialize((params: InitializeParams) => {
            const capabilities = params.capabilities;
            
            // Check client capabilities
            this.hasConfigurationCapability = !!(
                capabilities.workspace && !!capabilities.workspace.configuration
            );
            this.hasWorkspaceFolderCapability = !!(
                capabilities.workspace && !!capabilities.workspace.workspaceFolders
            );
            this.hasDiagnosticRelatedInformationCapability = !!(
                capabilities.textDocument &&
                capabilities.textDocument.publishDiagnostics &&
                capabilities.textDocument.publishDiagnostics.relatedInformation
            );
            
            // Define server capabilities
            const result: InitializeResult = {
                capabilities: {
                    textDocumentSync: TextDocumentSyncKind.Incremental,
                    completionProvider: {
                        resolveProvider: true,
                        triggerCharacters: ['(', ' ', ':', '.']
                    },
                    hoverProvider: true,
                    definitionProvider: true,
                    signatureHelpProvider: {
                        triggerCharacters: ['(', ' ', ',', ':']
                    },
                    documentSymbolProvider: true,
                    workspaceSymbolProvider: true,
                    documentFormattingProvider: true,
                    renameProvider: true,
                    semanticTokensProvider: {
                        full: true,
                        range: true,
                        legend: this.semanticTokensProvider.getLegend()
                    }
                }
            };
            
            if (this.hasWorkspaceFolderCapability) {
                result.capabilities.workspace = {
                    workspaceFolders: {
                        supported: true
                    }
                };
            }
            
            return result;
        });
        
        // Handle initialized notification
        this.connection.onInitialized(() => {
            if (this.hasConfigurationCapability) {
                // Register for all configuration changes
                this.connection.client.register(
                    DidChangeConfigurationNotification.type,
                    undefined
                );
            }
            
            if (this.hasWorkspaceFolderCapability) {
                this.connection.workspace.onDidChangeWorkspaceFolders(_event => {
                    this.logger.log('Workspace folder change event received');
                });
            }
        });
        
        // Handle configuration changes
        this.connection.onDidChangeConfiguration(change => {
            if (this.hasConfigurationCapability) {
                // Reset all document settings
                this.documentSettings.clear();
            } else {
                // If client doesn't support configuration, update all documents
                this.documents.all().forEach(document => {
                    this.validateTextDocument(document);
                });
            }
            
            // Update logger settings
            const settings = this.hasConfigurationCapability 
                ? this.getDocumentSettings('') 
                : Promise.resolve(this.defaultSettings);
                
            settings.then(config => {
                this.logger.setLevel(config.logging.level);
                this.logger.setEnabled(config.logging.enabled);
            });
        });
    }
    
    /**
     * Set up document event handlers
     */
    private setupDocumentHandlers(): void {
        // Handle document open
        this.documents.onDidOpen(event => {
            this.logger.log(`Document opened: ${event.document.uri}`);
            this.validateTextDocument(event.document);
        });
        
        // Handle document change
        this.documents.onDidChangeContent(change => {
            this.validateTextDocument(change.document);
        });
        
        // Handle document save
        this.documents.onDidSave(event => {
            this.logger.log(`Document saved: ${event.document.uri}`);
            this.validateTextDocument(event.document);
        });
        
        // Handle document close
        this.documents.onDidClose(event => {
            this.logger.log(`Document closed: ${event.document.uri}`);
            this.documentManager.removeDocument(event.document.uri);
            this.documentSettings.delete(event.document.uri);
            this.connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
        });
    }
    
    /**
     * Set up request handlers for language features
     */
    private setupRequestHandlers(): void {
        // Completions
        this.connection.onCompletion(
            (params: CompletionParams): CompletionItem[] => {
                return this.handleRequest(
                    'completion',
                    params.textDocument.uri,
                    (document) => this.completionProvider.provideCompletionItems(document, params.position, params.context)
                );
            }
        );
        
        this.connection.onCompletionResolve(
            (item: CompletionItem): CompletionItem => {
                return this.completionProvider.resolveCompletionItem(item);
            }
        );
        
        // Hover
        this.connection.onHover(
            (params: HoverParams): Hover | null => {
                return this.handleRequest(
                    'hover',
                    params.textDocument.uri,
                    (document) => this.hoverProvider.provideHover(document, params.position)
                );
            }
        );
        
        // Definition
        this.connection.onDefinition(
            (params: DefinitionParams): Location | Location[] | null => {
                return this.handleRequest(
                    'definition',
                    params.textDocument.uri,
                    (document) => this.definitionProvider.provideDefinition(document, params.position)
                );
            }
        );
        
        // Signature help
        this.connection.onSignatureHelp(
            (params: SignatureHelpParams): SignatureHelp | null => {
                return this.handleRequest(
                    'signature help',
                    params.textDocument.uri,
                    (document) => this.signatureHelpProvider.provideSignatureHelp(document, params.position)
                );
            }
        );
        
        // Document symbols
        this.connection.onDocumentSymbol(
            (params: DocumentSymbolParams): DocumentSymbol[] | SymbolInformation[] => {
                return this.handleRequest(
                    'document symbols',
                    params.textDocument.uri,
                    (document) => this.symbolProvider.provideDocumentSymbols(document)
                );
            }
        );
        
        // Workspace symbols
        this.connection.onWorkspaceSymbol(
            (params: WorkspaceSymbolParams): SymbolInformation[] => {
                const results: SymbolInformation[] = [];
                
                for (const document of this.documentManager.getAllDocuments()) {
                    results.push(...this.symbolProvider.provideWorkspaceSymbols(document, params.query));
                }
                
                return results;
            }
        );
        
        // Formatting
        this.connection.onDocumentFormatting(
            async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
                return this.handleRequest(
                    'document formatting',
                    params.textDocument.uri,
                    async (document) => {
                        const settings = await this.getDocumentSettings(params.textDocument.uri);
                        return this.formattingProvider.provideDocumentFormatting(
                            document, 
                            settings.formatOptions
                        );
                    }
                );
            }
        );
        
        // Rename
        this.connection.onRenameRequest(
            (params: RenameParams): WorkspaceEdit | null => {
                return this.handleRequest(
                    'rename',
                    params.textDocument.uri,
                    (document) => this.renameProvider.provideRenameEdits(document, params.position, params.newName)
                );
            }
        );
        
        // Semantic tokens - full
        this.connection.languages.semanticTokens.on(
            (params: SemanticTokensParams): SemanticTokens => {
                return this.handleRequest(
                    'semantic tokens',
                    params.textDocument.uri,
                    (document) => this.semanticTokensProvider.provideSemanticTokens(document)
                );
            }
        );
        
        // Semantic tokens - range
        this.connection.languages.semanticTokens.onRange(
            (params: SemanticTokensRangeParams): SemanticTokens => {
                return this.handleRequest(
                    'semantic tokens range',
                    params.textDocument.uri,
                    (document) => this.semanticTokensProvider.provideSemanticTokensRange(document, params.range)
                );
            }
        );
        
        // Semantic tokens - delta
        this.connection.languages.semanticTokens.onDelta(
            (params: SemanticTokensDeltaParams): SemanticTokens | SemanticTokensDelta => {
                return this.handleRequest(
                    'semantic tokens delta',
                    params.textDocument.uri,
                    (document) => this.semanticTokensProvider.provideSemanticTokensDelta(document, params.previousResultId)
                );
            }
        );
    }
    
    /**
     * Generic request handler that provides error handling and logging
     */
    private handleRequest<T>(
        requestName: string,
        uri: string,
        handler: (document: HQLDocument) => T | Promise<T>
    ): T | Promise<T> | null {
        try {
            const document = this.documents.get(uri);
            if (!document) {
                this.logger.warn(`${requestName}: Document not found: ${uri}`);
                return null;
            }
            
            const hqlDocument = this.documentManager.getDocument(document);
            return handler(hqlDocument);
        } catch (error) {
            this.logger.error(`Error handling ${requestName} request: ${error}`);
            return null;
        }
    }
    
    /**
     * Validate a text document and send diagnostics
     */
    private async validateTextDocument(textDocument: TextDocument): Promise<void> {
        try {
            // Get document settings
            const settings = await this.getDocumentSettings(textDocument.uri);
            
            // Get HQL document
            const hqlDocument = this.documentManager.getDocument(textDocument);
            
            // Provide diagnostics
            const diagnostics: Diagnostic[] = await this.diagnosticsProvider.provideDiagnostics(
                hqlDocument, 
                settings.maxNumberOfProblems
            );
            
            // Send diagnostics to the client
            this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
        } catch (error) {
            this.logger.error(`Error validating document: ${error}`);
        }
    }
    
    /**
     * Get document settings
     */
    private getDocumentSettings(resource: string): Thenable<any> {
        if (!this.hasConfigurationCapability) {
            return Promise.resolve(this.defaultSettings);
        }
        
        let result = this.documentSettings.get(resource);
        if (!result) {
            result = this.connection.workspace.getConfiguration({
                scopeUri: resource,
                section: 'hql'
            });
            this.documentSettings.set(resource, result);
        }
        
        return result;
    }
    
    /**
     * Start the server
     */
    public start(): void {
        // Make the text document manager listen on the connection
        this.documents.listen(this.connection);
        
        // Start the server
        this.connection.listen();
    }
}

// Create and start the server
const server = new HQLServer();
server.start();