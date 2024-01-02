/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { workspace, ExtensionContext,commands, Range, Position } from 'vscode';
import * as vscode from 'vscode';
// import * as Cache from 'vscode-cache' - TODO when we add rest api
import { getFileSymbols } from './utils';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { makeRESTRequest, ServerSpec } from './makeRestRequest';
import { fixAllFixable } from './commands';
export let client: LanguageClient;

type MakeRESTRequestParams = {
	method: "GET" | "POST";
	api: number;
	path: string;
	server: ServerSpec;
	data?: any;
	checksum?: string;
	params?: any;
}
/**
 * Cache for cookies from REST requests to InterSystems servers.
 */
// export let cookiesCache: Cache;
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
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'oscLanguageServer',
		'OSC Language Server',
		serverOptions,
		clientOptions
	);
	commands.registerCommand("osc.language-server.fixAll", (fixAllFixable));

	// client.onRequest("osc/makeRESTRequest", async (args: MakeRESTRequestParams): Promise<any | undefined> => {
	// 	// As of version 2.0.0, REST requests are made on the client side
	// 	return makeRESTRequest(args.method, args.api, args.path, args.server, args.data, args.checksum, args.params).then(respdata => {
	// 		if (respdata) {
	// 			// Can't return the entire AxiosResponse object because it's not JSON.stringify-able due to circularity
	// 			return { data: respdata.data };
	// 		} else {
	// 			return undefined;
	// 		}
	// 	});
	// }),
	// Start the client. This will also launch the server
	client.start();
	
	// Subscribe to any requests that may float up from the server
	context.subscriptions.push(
		client.onRequest('osc/getSymbols', symbolHandler)
	)
}

/// Helper to handle getting the symbols from a uri in an optional range.
function symbolHandler(args:{type?:string,uri?:string,range?:any}):Promise<vscode.DocumentSymbol[]>{
	let range = args.range;
	if (args.range){
		range = new Range(new Position(range.start.line,range.start.character),new Position(range.end.line,range.end.character) );
	}
	return getFileSymbols(args.uri, args.type,range);
}
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
