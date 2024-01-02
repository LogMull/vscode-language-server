// Library includes
import {
	Diagnostic,
	_Connection,
	Range,
	Position,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';
import {
	TextDocument
} from 'vscode-languageserver-textdocument';
const { ESLint } = require("eslint");
// Home brew includes
import { CleanMethodResults, getCleanMethod } from '../utils'
const esLintCombinedConfig = require('../../resources/os-eslint-combined-config.json');
// Setup for static variables
const jsMethodRegex = new RegExp("^ClientMethod.*language\\s*=\\s*javascript", "im");
const jsMethodBreakdown = new RegExp("ClientMethod\\s*(\\w+)\\(([\\w,\\W]*)\\)\\s*(\\[.*\\])\n", "i")
// Overrides for specific rules to bring them lower than warnings
const hintOverrides: string[] = ["prefer-const"];
const infoOverrides: string[] = [];

const eslint = new ESLint({
	useEslintrc: false,
	overrideConfig: esLintCombinedConfig
});
var elapsed_time = function (note: string, start: any) {
	var precision = 3; // 3 decimal places
	var elapsed = process.hrtime(start)[1] / 1000000; // divide by a million to get nano to milli
	console.log(process.hrtime(start)[0] + " s, " + elapsed.toFixed(precision) + " ms - " + note); // print message + time

}
/// Validate an objectscript-class file.  Currently only supports clientMethods
export async function validateObjClass(connection: _Connection, document: TextDocument): Promise<Diagnostic[]> {
	const symbols: any[] = await connection.sendRequest('osc/getSymbols', { uri: document.uri, type: 'ClientMethod' });
	// Find all of the XData nodes to start with very likely XML
	// const xDataSymbols = symbols.filter((el) => el.detail == 'XData');
	// let diagnostics = validateJSSymbols(document, symbols)
	let start = process.hrtime()
	let ruleMap = new Map();
	let diagnostics = await validateJSSymbols(document, symbols)

	elapsed_time("Lint - ",start)
	for (const diag of diagnostics){
		let currentValue = ruleMap.get(diag.code);
		if (!currentValue) currentValue = 0
		ruleMap.set(diag.code, currentValue + 1);
	}
	console.log(ruleMap);
	return Promise.resolve(
		diagnostics
	);
}

async function validateJSSymbols(document: TextDocument, symbols: any[]): Promise<Diagnostic[]> {
	let promiseArray:Promise<Diagnostic[]>[]=[];
	for (let symbol of symbols) {
		promiseArray.push(validateSingleJSSymbol(symbol,document))
	}
	let results = await Promise.all(promiseArray);


	return Promise.resolve(results.flat());

}
/// Validate Javascript Symbols.  Clientmethods which are not Javascript will be skipped.
async function validateJSSymbolsOld(document: TextDocument, symbols: any[]): Promise<Diagnostic[]> {
	let diagnostics: Diagnostic[] = [];

	let ruleMap = new Map();
	// Iterate over all ClientMethod symbols
	for (let symbol of symbols) {
		try {
			let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
			let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
			let symbolRange = Range.create(symbolStart, symbolEnd);
			let cleanResults: CleanMethodResults = getCleanMethod(symbolRange, document)
			if (!cleanResults.isOk) continue;
			let results;
			try {
				results = await eslint.lintText(cleanResults.methodText);
			} catch (ex) {
				debugger;
				continue;
			}
			for (let message of results[0].messages) {
				if (message.ruleId == 'no-unused-vars' && message.line == 1) continue; // The method name will appear as unused, unless it recursively calls itself, so ignore that error when on line 1
				if (message.line == 1) continue; // The method name will appear as unused, unless it recursively calls itself, so ignore that error when on line 1
				if (message.ruleId == 'brace-style' && message.line == 2) continue; // Language server forces curly brackets to be under the method, so ignore that violation	

				// This line may be uncommented when needed.  These are some of the most common problems in the codebase which do not have auto-fixes
				//if (['no-mixed-spaces-and-tabs', 'eqeqeq', 'no-var', 'no-redeclare', 'no-undef', "no-unused-vars"].indexOf(message.ruleId) != -1) continue;
				let diagStart = Position.create(cleanResults.range.start.line + message.line, cleanResults.range.start.character + message.column - 1);
				let diagEnd = diagStart;
				if (message.endLine != undefined) {
					diagEnd = Position.create(cleanResults.range.start.line + message.endLine, message.endColumn - 1);
				}
				let ruleException = checkRuleExceptions(message.ruleId, document, diagStart)
				// There are a few exceptions to the normal rules, so check those now.
				if (!ruleException.showDiagnostic) {
					continue;
				}

				let diagData: { uri: string, fixText?: string, fixRange?: Range, fixMessage?: string, origFix?: any } = {
					uri: document.uri
				}
				// We now have the start + end of the diagnostic information, which will be used for styling + alerting the user
				// Next, if there is an available fix, we will try to translate that from substring positions to a Range that vscode can use to apply changes.
				// Our custom rule exception can skip providing a fix.
				if (message.fix && ruleException.showFix) {
					const fixStartPos = message.fix.range[0];
					const fixEndPos = message.fix.range[1];

					let start = getPosition(cleanResults.methodText, fixStartPos);
					let end = getPosition(cleanResults.methodText, fixEndPos);
					// start/end should contain 0-based line/column offsets
					let fixStart = Position.create(cleanResults.range.start.line + start.line + 1, cleanResults.range.start.character + start.column);
					let fixEnd = Position.create(cleanResults.range.start.line + end.line + 1, end.column);
					let fixRange = Range.create(fixStart, fixEnd);

					diagData.fixText = message.fix.text;
					diagData.fixRange = fixRange;
					diagData.fixMessage = `Apply fix for '${message.ruleId}'`


				}
				let severity: DiagnosticSeverity = message.severity == '2' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

				if (infoOverrides.indexOf(message.ruleId) != -1) {
					severity = DiagnosticSeverity.Information;
				}
				if (hintOverrides.indexOf(message.ruleId) != -1) {
					severity = DiagnosticSeverity.Hint;
				}

				let diag: Diagnostic = {
					code: message.ruleId,
					message: message.message,
					range: Range.create(diagStart, diagEnd),
					severity: severity,
					source: cleanResults.methodName,
					data: diagData
				}
				diagnostics.push(diag)
				let currentValue = ruleMap.get(diag.code);
				if (!currentValue) currentValue = 0
				ruleMap.set(diag.code, currentValue + 1);
			}

		}
		catch (ex) {
			debugger;
		}


	}
	console.log(ruleMap)
	return Promise.resolve(
		diagnostics
	);
}

async function validateSingleJSSymbol(symbol:any,document:TextDocument):Promise<Diagnostic[]>{
	let diagnostics: Diagnostic[] = [];

	let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
	let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
	let symbolRange = Range.create(symbolStart, symbolEnd);
	let cleanResults: CleanMethodResults = getCleanMethod(symbolRange, document)
	if (!cleanResults.isOk){
		console.log('Failed to get method text for '+symbol.name)
		return diagnostics;
	} 
	// In addition to what esLint returns, we also require that a client method has a comment.
	if (cleanResults.comment.trim().length==0){
		diagnostics.push({
			code: 'osc-missing-comment',
			message: 'Missing method comment',
			range: Range.create(symbolStart, Position.create(symbolStart.line,12)),
			severity: DiagnosticSeverity.Warning,
			source: cleanResults.methodName,
			//data: diagData
		})
	}
	let results;
	try {
		results = await eslint.lintText(cleanResults.methodText);
	} catch (ex) {
		console.log('Exception when linting '+symbol.name)
		return diagnostics;
	}
	for (let message of results[0].messages) {
		if (message.ruleId == 'no-unused-vars' && message.line == 1) continue; // The method name will appear as unused, unless it recursively calls itself, so ignore that error when on line 1
		if (message.line == 1) continue; // The method name will appear as unused, unless it recursively calls itself, so ignore that error when on line 1
		if (message.ruleId == 'brace-style' && message.line == 2) continue; // Language server forces curly brackets to be under the method, so ignore that violation	

		// This line may be uncommented when needed.  These are some of the most common problems in the codebase which do not have auto-fixes
		//if (['no-mixed-spaces-and-tabs', 'eqeqeq', 'no-var', 'no-redeclare', 'no-undef', "no-unused-vars"].indexOf(message.ruleId) != -1) continue;
		let diagStart = Position.create(cleanResults.range.start.line + message.line, cleanResults.range.start.character + message.column - 1);
		let diagEnd = diagStart;
		if (message.endLine != undefined) {
			diagEnd = Position.create(cleanResults.range.start.line + message.endLine, message.endColumn - 1);
		}
		let ruleException = checkRuleExceptions(message.ruleId, document, diagStart)
		// There are a few exceptions to the normal rules, so check those now.
		if (!ruleException.showDiagnostic) {
			continue;
		}

		let diagData: { uri: string, fixText?: string, fixRange?: Range, fixMessage?: string, origFix?: any } = {
			uri: document.uri
		}
		// We now have the start + end of the diagnostic information, which will be used for styling + alerting the user
		// Next, if there is an available fix, we will try to translate that from substring positions to a Range that vscode can use to apply changes.
		// Our custom rule exception can skip providing a fix.
		if (message.fix && ruleException.showFix) {
			const fixStartPos = message.fix.range[0];
			const fixEndPos = message.fix.range[1];

			let start = getPosition(cleanResults.methodText, fixStartPos);
			let end = getPosition(cleanResults.methodText, fixEndPos);
			// start/end should contain 0-based line/column offsets
			let fixStart = Position.create(cleanResults.range.start.line + start.line + 1, cleanResults.range.start.character + start.column);
			let fixEnd = Position.create(cleanResults.range.start.line + end.line + 1, end.column);
			let fixRange = Range.create(fixStart, fixEnd);

			diagData.fixText = message.fix.text;
			diagData.fixRange = fixRange;
			diagData.fixMessage = `Apply fix for '${message.ruleId}'`


		}
		let severity: DiagnosticSeverity = message.severity == '2' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

		if (infoOverrides.indexOf(message.ruleId) != -1) {
			severity = DiagnosticSeverity.Information;
		}
		if (hintOverrides.indexOf(message.ruleId) != -1) {
			severity = DiagnosticSeverity.Hint;
		}

		let diag: Diagnostic = {
			code: message.ruleId,
			message: message.message,
			range: Range.create(diagStart, diagEnd),
			severity: severity,
			source: cleanResults.methodName,
			data: diagData
		}
		diagnostics.push(diag)
	}
	

	return Promise.resolve(
		diagnostics
	)
}
/// Within the given text string, return a 0-based line and column that matches the original substring length.
/// Normally, using positionAt would achieve this, but because this text is a subset of the document, that does not work.
function getPosition(text: string, substrPos: number): { line: number, column: number } {
	let sub = text.substring(0, substrPos);
	// split by new lines, this gets us the line offset.
	let lines = sub.split('\n');
	let line = lines.length - 1;
	// lines[lines.length-1] will be our last line, ending at the position indicated by the fix, so the character position is simply the length of that last entry
	let col = lines[line].length;

	return { line: line, column: col };
}
/// This function will check for exceptions to the rules eslint defines.
/// Returns true if the rule should still be processed, false if it should be skipped.
// TODO in the future - move this to a separate json that contains the ruleId:function mapping to make it easier to maintain down the road.
function checkRuleExceptions(ruleId: string = "", document: TextDocument, start: Position, end?: Position): { showFix: boolean, showDiagnostic: boolean } {
	let returnResult = {
		showDiagnostic: true,
		showFix: true
	}
	if (ruleId == 'brace-style') {
		const newRange = Range.create(Position.create(start.line + 1, 0), Position.create(start.line + 2, 0));
		const newText = document.getText(newRange);
		// Match any number of space/tabs followed by either // or /*
		if (newText.match(/^[\s\t]*\/{2}|(?:\/\*)/)) {
			returnResult.showDiagnostic = false;
			returnResult.showFix = false;
		}
	} else if (ruleId == 'no-useless-return') {
		// This rule wants to re-write the entire method, which causes issues because that includes the artificial header.
		// For now this rule is shown as a violation, but an auto-fix is not provided.
		returnResult.showFix = false;
	}
	return returnResult;

}