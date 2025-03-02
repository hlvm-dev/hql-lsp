// client/src/extension.ts
import * as path from 'path';
import { workspace, ExtensionContext, window, commands, languages } from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    console.log('HQL Language Server is now active');

    // Path to the server module
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    // Server debug options
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // Server options
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Client options
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'hql' }],
        synchronize: {
            // Notify the server about file changes in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/*.hql')
        }
    };

    // Create and start the client
    client = new LanguageClient(
        'hqlLanguageServer',
        'HQL Language Server',
        serverOptions,
        clientOptions
    );

    // Register commands
    context.subscriptions.push(
        commands.registerCommand('hql.restartLanguageServer', () => {
            window.showInformationMessage('Restarting HQL Language Server...');
            client.stop().then(() => client.start());
        })
    );

    // Start the client. This will also launch the server
    client.start();
}

export function deactivate(): Promise<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}