import {Range, workspace, window, languages, WorkspaceEdit, Uri, Selection } from 'vscode';

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