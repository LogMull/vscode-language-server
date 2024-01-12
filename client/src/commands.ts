import {Range, workspace, window, languages, WorkspaceEdit, Uri, Selection, QuickPickItem, TextDocument, Position, TextEditorRevealType } from 'vscode';
import { getFileSymbols } from './utils'
/// Set up a mapping of symbol 'kinds' to the appropriate image to use in the label
/// Markdown syntax for this is $(symbol-method)
const symbolKindIconMap = {
	5: 'symbol-method', //method
	6: 'symbol-property',// property
	13: 'symbol-constant' // parameter
}

// the Diagnostic type available to the client is slightly different than the server version.
type diagnosticData = {
	code: string,
	data:
	{ uri: string, fixText: string, fixRange: any, fixMessage: string },
	hasDiagnosticCode: boolean,
	message: string
	range: any,
	severity: number,
	source: string
}
// Main entry point for handling fixes in the current document
export async function handleFixes(isSelection?: boolean, promptTypes?: boolean) {
	const activeEditor = window.activeTextEditor;
	if (!activeEditor) return;
	const document = activeEditor.document
	if (!document) return
	// Get all of the diagnostics for the current document
	const uri = window.activeTextEditor.document.uri;
	const diagnostics: diagnosticData[] = languages.getDiagnostics(uri) as diagnosticData[];

	let filterFunc = (selection: Selection, codes: string[]) => (diagnostic: diagnosticData, index, array) => {
		// Filter anything without fix data
		if (!diagnostic.data || !diagnostic.data.fixRange) return false;
		// If selection is provided, ensure that they intersect
		if (selection && !selection.intersection(diagnostic.range)) return false;
		// Filter by provided codes
		if (codes && !codes.includes(diagnostic.code)) return false;

		return true;
	}
	let selection: Selection;
	let codes: string[];
	// If we care about the selection from here, get it
	if (isSelection) {
		selection = activeEditor.selection;
	}
	// If prompting for types, get a list of unique codes
	if (promptTypes) {
		const uniqueCodes = [...new Set(diagnostics.filter((diagnostic: diagnosticData) => diagnostic.data && diagnostic.data.fixRange).map((diagnostic: diagnosticData) => diagnostic.code))];
		codes = await window.showQuickPick(uniqueCodes, { title: 'Diagnostic codes to fix', canPickMany: true });
	}

	// Execute the filter function
	let filtered = diagnostics.filter(filterFunc(selection, codes));
	fixDiagnostics(filtered, uri);
}

// Workhorse function that handles actually fixing the provided diagnostics
function fixDiagnostics(diagnostics: diagnosticData[], uri: Uri) {
	let processedRanges: Range[] = [];
	let overlapSkip = 0;
	let skippedTypes = new Map();
	let wsEdit = new WorkspaceEdit();
	for (let diagnostic of diagnostics) {
		// If it is not one of our diagnostics or we don't have a fix for it, continue
		if (!diagnostic.data || !diagnostic.data.fixRange) continue;

		// fixRange comes from the server's definition of Range, which use similar, but different data types.
		// Conver it to a vscode.Range so that comparisons can work correctly.
		const diagRange = new Range(diagnostic.data.fixRange.start, diagnostic.data.fixRange.end);
		const overlapping = processedRanges.filter((range: Range) => (range.contains(diagRange)) || diagRange.contains(range));
		if (overlapping.length) {
			overlapSkip++;
			continue;
		}
		// Queue the change
		wsEdit.replace(uri, diagRange, diagnostic.data.fixText);
		// Keep track of the range so we don't introduce overlaps.
		processedRanges.push(diagRange);

	}
	console.log('Skipped fixing types:')
	console.log(skippedTypes)
	// Exit out if there are no changes to be processed, helps prevent us from doing extra work.
	if (processedRanges.length == 0) {
		let message = 'No automatically fixable items found.';
		if (overlapSkip) {
			message += ` ${overlapSkip} skipped due to possible conflicts.`
		}
		window.setStatusBarMessage(message, 10000);
		return
	}
	workspace.applyEdit(wsEdit, { isRefactoring: true })
		.then((result) => {
			let message: string;
			if (result) {
				message = `Fixed ${processedRanges.length} items.`
				if (overlapSkip) {
					message += ` ${overlapSkip} skipped due to possible conflicts.`
				}
				window.setStatusBarMessage(message, 10000);
				return;
			}
			window.showWarningMessage('Unable to fix any of the issues');
			const oRange = processedRanges
			for (let range of processedRanges) {
				if (range.start.line == range.end.line && range.end.character == range.start.character) {
					console.log(`${range.start.line}:${range.start.character}`)
				} else {
					console.log(`${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}`)
				}

			}
		});
}


export async function handleGotoSymbol() {
	// Always assume the current document
	const activeEditor = window.activeTextEditor;
	const array = await getFileSymbols();
	const list = [];
	// Add each symbol to the quick pick
	for (let symbol of array) {
		const symbolObj = {
			"label": `$(${symbolKindIconMap[symbol.kind]}) ${symbol.name}`,
			"description": '',
			"symbolDetail": symbol
		};
		// If the type of symbol is explicity listed, show it here
		if (symbol.detail) {
			symbolObj.description = `(${symbol.detail}) ${symbol.name}`;
		}
		list.push(symbolObj);
	}
	// Keep track of the original poisitions, in case we want to jump back if this command is cancelled.
	const oRange = activeEditor.visibleRanges;
	const oSel = activeEditor.selection;
	// As the symbol name is being set, jump to the currently selected one.
	const symbolSelect = (item: QuickPickItem) => {
		goToSymbolInternal(activeEditor.document, item, 0);
	}
	const symbol = await window.showQuickPick(list, { placeHolder: 'Select a symbol.', title: `Available Symbols.`, matchOnDescription: true, 'onDidSelectItem': symbolSelect })
	// If a symbol was not selected, do nothing further
	if (!symbol) return;
	const offsetValidation = (value: string) => {
		if (value.match(/^[\+|-]?\d+$/)) return ''; // +123, -123, 123        
		if (value == '$') return '';
		if (value.match(/^\$[\+|-]\d+$/)) return ''; // $+123, $-123

		return 'Offset must be in the form of [$]+/-123';
		// assume valid
		return '';
	};
	// Get the current offset.
	let offset = await window.showInputBox({ 'prompt': 'Enter line offset', 'placeHolder': 'eg 5, -10, $ for last line, blank for start', 'validateInput': offsetValidation })
	let referenceFromEnd = false;
	if (typeof offset == 'undefined') {
		offset = '0';
	}

	// If the end of the symbol is requested, offset is 0, but the ending point is used instead.
	if (offset == '$') {
		offset = '0';
		referenceFromEnd = true;
	} else if (offset.includes('$')) { //Otherwise, if $ is included, set the offset appropraitely.
		referenceFromEnd = true;
		offset = offset.split('$')[1];
	}

	goToSymbolInternal(activeEditor.document, symbol, offset, referenceFromEnd);
}

// Given the document, desired symbol and line offset number, go to a symbol.
function goToSymbolInternal(document: TextDocument, symbol, offset, referenceFromEnd?: boolean) {
	const rangeOffset = parseInt(offset);

	const range = symbol.symbolDetail.selectionRange;
	let start = 0;
	if (referenceFromEnd) {
		start = symbol.symbolDetail.range.end.line;
	} else {
		start = range.start.line;
	}
	start = Math.max(start + rangeOffset, 0);

	const startPos = new Position(start, 0);

	const endPos = new Position(startPos.line, startPos.character); // Only really care about the starting point, never going to be pre-selecting an actual range.

	const newRange = new Range(startPos, endPos)

	// Now that the offset is known, try to go to it.
	window.activeTextEditor.revealRange(newRange, TextEditorRevealType.InCenter);
	window.activeTextEditor.selection = new Selection(newRange.start, newRange.start);
}