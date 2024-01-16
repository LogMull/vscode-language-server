/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { ExtensionContext, commands, Range, Position } from 'vscode';
import * as vscode from 'vscode';
import { getFileSymbols } from './utils';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { handleFixes, handleGotoSymbol } from './commands';
export let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6019'] };
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ language: 'objectscript-class' }],
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'oscLanguageServer',
		'OSC Language Server',
		serverOptions,
		clientOptions
	);

	// Add handlers for the commands we expose
	commands.registerCommand("osc.language-server.fixAll", () => {
		handleFixes(false);
	});
	commands.registerCommand("osc.language-server.fixSelection", () => {
		handleFixes(true);
	});
	commands.registerCommand("osc.language-server.fixTypes", () => {
		handleFixes(false, true);
	});
	// Handle going to a symbol with an offset
	commands.registerCommand('osc.language-server.gotosymbol', async () => {
		handleGotoSymbol();
	});

	// Start the client. This will also launch the server
	client.start();

	// Subscribe to any requests that may float up from the server
	context.subscriptions.push(
		client.onRequest('osc/getSymbols', symbolHandler)
	)
}

/// Helper to handle getting the symbols from a uri in an optional range.
function symbolHandler(args: { type?: string, uri?: string, range?: any }): Promise<vscode.DocumentSymbol[]> {
	let range = args.range;
	if (args.range) {
		range = new Range(new Position(range.start.line, range.start.character), new Position(range.end.line, range.end.character));
	}
	return getFileSymbols(args.uri, args.type, range);
}
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
