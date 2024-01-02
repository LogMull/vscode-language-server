import { commands, Diagnostic, CodeAction, Range,workspace, window, languages,WorkspaceEdit } from 'vscode';

/// Find all of the diagnostics for the current file and using the ranges provided, fix them.
/// This may need to be run several times to property fix everything, but this is unavoidable with the current implementation.
/// If we really need a true 'fix all with one command', this command could directly request the linting results of the current document
/// It would then be able to call itself repetitively as needed.
export async function fixAllFixable() {
	const activeEditor = window.activeTextEditor;
	if (!activeEditor) return;
	const document = activeEditor.document
	if (!document) return
	// Get all of the diagnostics for the current document
	const uri = window.activeTextEditor.document.uri;
	const diagnostics: any[] = languages.getDiagnostics(uri);
	// Should be a Diagnostic array, but server-side also includes a data node which is important for us here.
	let wsEdit = new WorkspaceEdit();
	let processedRanges: Range[] = [];
	let skippedTypes = new Map();
	let filtered = diagnostics.filter(diagnostic => {
		if (!diagnostic.data || !diagnostic.data.fixRange) return false;
		return true
	})
	let overlapSkip=0;
	for (let diagnostic of filtered) {
		// If it is not one of our diagnostics or we don't have a fix for it, continue
		if (!diagnostic.data || !diagnostic.data.fixRange) continue;

		
		// fixRange comes from the server's definition of Range, which use similar, but different data types.
		// Conver it to a vscode.Range so that comparisons can work correctly.
		const diagRange = new Range(diagnostic.data.fixRange.start, diagnostic.data.fixRange.end);
		const overlapping = processedRanges.filter((range: Range) => (range.contains(diagRange)) || diagRange.contains(range));
		if (overlapping.length){
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
	if (processedRanges.length == 0){
		let message = 'No automatically fixable items found.';
		if (overlapSkip){
			message+=` ${overlapSkip} skipped due to possible conflicts.`
		}
		window.setStatusBarMessage(message,10000);
		return
	} 
	workspace.applyEdit(wsEdit, { isRefactoring: true })
	.then((result) => {
		let message:string;
		if (result){
			message = `Fixed ${ processedRanges.length } items.`
			if (overlapSkip) {
				message += ` ${overlapSkip} skipped due to possible conflicts.`
			}
			window.setStatusBarMessage(message, 10000);
			return;
		} 
		window.showWarningMessage('Unable to fix any of the issues');
		const oRange = processedRanges
		for (let range of processedRanges){
			if (range.start.line == range.end.line && range.end.character == range.start.character){
				console.log(`${range.start.line}:${range.start.character}`)
			}else{
				console.log(`${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}`)
			}
			
		}
	 });

}