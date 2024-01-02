/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	CodeActionParams,
	CodeAction,
	CodeActionKind,
	WorkspaceEdit,
	TextEdit,
	DocumentFormattingParams,
	DocumentRangeFormattingParams
} from 'vscode-languageserver/node';
import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { validateObjClass } from './providers/lintProvider';
import { onDocumentFormatting, onDocumentRangeFormatting } from './providers/formatProvider';
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			codeActionProvider: true,
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true
			// Tell the client that this server supports code completion.
			// completionProvider: {
			// 	resolveProvider: false
			// }

		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});
/// Handle code action resoluation.  In future, we should split this apart based on the type of action
connection.onCodeAction((params: CodeActionParams) => {
	const textDocument = documents.get(params.textDocument.uri);
	if (textDocument === undefined) {
		return undefined;
	}


	// If there are no diagnostics, do nothing
	if (!params.context.diagnostics.length) {
		return [];
	}
	const codeActions: CodeAction[] = [];
	// iterate over every diagnostic we have
	params.context.diagnostics.forEach((diagnostic: Diagnostic, index) => {
		// Skip if there is no fix or it is for a different uri
		if (diagnostic.data == undefined || diagnostic.data.fixRange == undefined || params.textDocument.uri != diagnostic.data.uri) {
			return; // Note for the future - if loop changes to a for...in or similar, change return to continue.  forEach operates differently
		}
		// For each of the entries, create an action object which contains an edit
		let uri: string = diagnostic.data.uri;
		let textedit: TextEdit = {
			newText: diagnostic.data.fixText,
			range: diagnostic.data.fixRange
		}
		let wsEdit: WorkspaceEdit = {
			changes: {
				uri: [textedit]
			}
		};
		// Create the action object
		let actionObj = {
			title: diagnostic.data.fixMessage,
			kind: CodeActionKind.QuickFix,
			isPreferred: true, // is preferred because as of now, it is the only action
			edit: {
				changes: {
					[diagnostic.data.uri]: [{
						range: diagnostic.data.fixRange,
						newText: diagnostic.data.fixText
					}]
				}
			},
			diagnostics: [diagnostic]
		}
		codeActions.push(actionObj);
	})


	return codeActions;
});
connection.onDocumentFormatting(formatDocument);
connection.onDocumentRangeFormatting(formatDocumentRange)
/// Helper to format the document. This method handles formatting the entire document
async function formatDocument(params: DocumentFormattingParams): Promise<TextEdit[] | null> {

	const clientMethods: any[] = await connection.sendRequest('osc/getSymbols', { uri: params.textDocument.uri, type: "ClientMethod" });
	const xmlSymbols: any[] = await connection.sendRequest('osc/getSymbols', { uri: params.textDocument.uri, type: "XData" });
	const document = documents.get(params.textDocument.uri)
	let result: TextEdit[] = [];
	if (document) {
		result = await onDocumentFormatting(clientMethods, xmlSymbols, document);
	}
	return Promise.resolve(
		result
	);
}

/// Helper to format the document. This method handles formatting the any symbols contained in the selected range
async function formatDocumentRange(params: DocumentRangeFormattingParams): Promise<TextEdit[] | null> {

	const clientMethods: any[] = await connection.sendRequest('osc/getSymbols', { uri: params.textDocument.uri, type: "ClientMethod", range: params.range });
	const xmlSymbols: any[] = await connection.sendRequest('osc/getSymbols', { uri: params.textDocument.uri, type: "XData", range: params.range });
	const document = documents.get(params.textDocument.uri)
	let result: TextEdit[] = [];
	if (document) {
		result = await onDocumentFormatting(clientMethods, xmlSymbols, document);
	}
	return Promise.resolve(
		result
	);
}

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
	connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async (change) => {

	// We only care about validating Objectscript Classes, anything will not be validated by us
	if (change.document.languageId == 'objectscript-class' && documents.keys().indexOf(change.document.uri) != -1) {
		let diagnostics = await validateObjClass(connection, change.document);
		// Ensure the document is still open...
		if (documents.keys().indexOf(change.document.uri) != -1) {
			connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
		}
	}
});



connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received a file change event');
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
