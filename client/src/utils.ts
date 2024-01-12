import * as vscode from 'vscode';

// Use the language server to get the symboles in the document
export async function getSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
	return await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri) || [];
}
export function verifyFileURI(fileURI: vscode.Uri): { "validForTask": boolean, "validForSymbol": boolean, "elName": string, "elType": string, "validationMessage": string } {
	let retVal = {
		validForTask: false,
		validForSymbol: false,
		elName: "",
		elType: "",
		validationMessage: ""
	}
	// The current file can only be added if it actually one of our files.
	// If the uri's scheme is not isfs, it is not one of ours
	if (fileURI.scheme !== 'isfs') {
		// LCM need a better message here, but this works for now
		retVal.validForTask = false;
		retVal.validationMessage = "Current file scheme is not isfs, unable to add to VM task."

	} else {
		retVal.validForTask = true;
		retVal.validForSymbol = true;
		// If the file belongs to ISFS, it came from our server, so figure out what it is
		retVal.elName = fileURI.path.slice(1, -4); // All file names start with / which is not what we need, also strip off the extension
		retVal.elName = retVal.elName.replace(/\//g, "."); // replace os/web/com/ to os.web.com
		if (fileURI.path.endsWith('.cls')) {
			retVal.elType = "SYCLASS";
		} else if (fileURI.path.endsWith('.mac')) {
			retVal.elType = "SYR"
		} else if (fileURI.path.endsWith('.inc')) {
			retVal.elType = "SYI"
		} else if (fileURI.path.endsWith('.int')) {
			// .int cannot be added to a task, but may be parsed
			retVal.validForTask = false;
		} else {
			retVal.validForTask = false;
			retVal.validForSymbol = false;
			retVal.validationMessage = 'Only .cls, .mac, or .inc files may be added to a VM task.'
			return retVal;
		}
	}
	return retVal
}
// Given a URI, retrieve the symbols from the related document.
// If no URI is given, try to use the current document.
// This method can filter the symbol type returned, mathcing the 'detail' of the symbol
// This method can also limit the results by range.  If no range is given, the entire set of symbols is returned.
export async function getFileSymbols(uri?: string, symbolType?: String, range?: vscode.Range): Promise<vscode.DocumentSymbol[]> {
	let docUri: vscode.Uri;
	// If the uri is provided, parse it into a vsCode.Uri
	if (uri) {
		docUri = vscode.Uri.parse(uri);
	} else {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			docUri = activeEditor.document.uri;
		}
	}

	if (!docUri) return [] // should not allow symbol lookup if there's nothing selected

	const valInfo = verifyFileURI(docUri);
	// If the current file is valid to add to a VM task, the symbol lookup should work fine here.  If not, skip it.
	if (!valInfo.validForSymbol) {
		return [];
	}
	// Get a list of all of the symbols for the current document
	const symbols = await getSymbols(docUri);
	let array = symbols;
	if (symbols[0].kind == 4) { // kind==4 means class, so the entries will be nested inside it's children
		array = symbols[0].children
	}
	// If a symbol type is provided, ensure every symbol matches it.
	if (symbolType) {
		array = array.filter((el) => el.detail == symbolType);
	}
	// If a range is provided, ensure every symbol overlaps with it
	if (range) {
		array = array.filter(el => el.range.intersection(range))
	}

	return Promise.resolve(array);
}