// Library includes
import {
	Diagnostic,
	_Connection,
	Range,
	Position,
	DiagnosticSeverity,
	Location,
} from 'vscode-languageserver/node';
import {
	TextDocument
} from 'vscode-languageserver-textdocument';
const { ESLint } = require("eslint");
// Home brew includes
import { CleanMethodResults, getCleanMethod } from './utils'
const esLintCombinedConfig = require('./os-eslint-combined-config.json');  // Dev note - stored in resources/*
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
export interface DiagData { uri: string, fixText?: string, fixRange?: Range, fixMessage?: string, origFix?: any }

/// Validate an objectscript-class file.  Currently only supports clientMethods
export async function validateObjClass(connection: _Connection, document: TextDocument): Promise<Diagnostic[]> {
	const symbols: any[] = await connection.sendRequest('osc/getSymbols', { uri: document.uri, type: 'ClientMethod' });

	let start = process.hrtime()
	let ruleMap = new Map();
	let promiseArray: Promise<Diagnostic[]>[] = [];
	// Validate teh comment section first.  It is less important, but can sometimes get pushed out of scope if there are a LOT of problems
	let classSymbols: any[] = await connection.sendRequest('osc/getSymbols', { uri: document.uri, type: 'Class' });
	// Class symbol is currently used only to validate header comments
	let rangeInfo = classSymbols[0].location.range;
	let classStartPosition:Position = rangeInfo[0] as Position;
	promiseArray.push(validateClassHeaderComment(classStartPosition, document));
	// Validate JS symbols
	promiseArray.push(validateJSSymbols(document, symbols));

	let allDiag = await Promise.all(promiseArray);
	let diagnostics = allDiag.flat()
	elapsed_time("Linting Time - ", start)
	for (const diag of diagnostics) {
		let currentValue = ruleMap.get(diag.code);
		if (!currentValue) currentValue = 0
		ruleMap.set(diag.code, currentValue + 1);
	}
	console.log(ruleMap);
	return Promise.resolve(
		diagnostics
	);
}
/// This method creates promises to validate individual javascript symbols.
async function validateJSSymbols(document: TextDocument, symbols: any[]): Promise<Diagnostic[]> {
	let promiseArray: Promise<Diagnostic[]>[] = [];
	for (let symbol of symbols) {
		promiseArray.push(validateSingleJSSymbol(symbol, document))
	}
	// Wait for all promises to reslove
	let results = await Promise.all(promiseArray);

	return Promise.resolve(results.flat());

}

/// Validate an individual symbol. This will crea teh appropriate diagnostics for any issues
async function validateSingleJSSymbol(symbol: any, document: TextDocument): Promise<Diagnostic[]> {
	let diagnostics: Diagnostic[] = [];

	let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
	let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
	let symbolRange = Range.create(symbolStart, symbolEnd);
	let cleanResults: CleanMethodResults = getCleanMethod(symbolRange, document)
	if (!cleanResults.isOk) {
		console.log('Failed to get method text for ' + symbol.name)
		return diagnostics;
	}
	// In addition to what esLint returns, we also require that a client method has a comment.
	if (cleanResults.comment.trim().length == 0) {
		let fixStart = Position.create(cleanResults.range.start.line, cleanResults.range.start.character);
		let fixEnd = fixStart
		let fixRange = Range.create(fixStart, fixEnd);

		let diagData: DiagData = {
			uri: document.uri
		}
		let fixLines: string[] = [];
		fixLines.push(`/// ${cleanResults.methodName}`)
		fixLines.push('///\tSummary of method functionality');
		// Add in placeholder for parameter info as well
		if (cleanResults.parameters.trim().length) {
			fixLines.push('///\t\tInput Parameters')
			for (let param of cleanResults.parameters.split(',')) {
				fixLines.push(`///\t\t\t${param.trim()} - datatype - description/default/etc`)
			}
		}
		fixLines.push('///\t\tReturns')
		fixLines.push('///\t\t\tDescribe return value, if any')


		diagData.fixText = fixLines.join('\n') + '\n';
		diagData.fixRange = fixRange;
		diagData.fixMessage = 'Add default method comment'
		diagnostics.push({
			code: 'osc-missing-comment',
			message: 'Missing method comment',
			range: Range.create(symbolStart, Position.create(symbolStart.line, 12)),
			severity: DiagnosticSeverity.Warning,
			source: cleanResults.methodName,
			data: diagData
		})
	}
	let results;
	try {
		results = await eslint.lintText(cleanResults.methodText);
	} catch (ex) {
		console.log('Exception when linting ' + symbol.name)
		console.log(ex)
		return diagnostics;
	}
	for (let message of results[0].messages) {
		if (message.ruleId == 'no-unused-vars' && message.line == 1) continue; // The method name will appear as unused, unless it recursively calls itself, so ignore that error when on line 1
		if (message.line == 1) continue; // The method name will appear as unused, unless it recursively calls itself, so ignore that error when on line 1
		if (message.ruleId == 'brace-style' && message.line == 2) continue; // Language server forces curly brackets to be under the method, so ignore that violation	

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

		let diagData: DiagData = {
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
		// Check for overrides of specific rules
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

/// Perform validation against the header comment of a class.
/// This will validate the following:
/// Author, Date, and Copyright are present
/// All <TR> have matching, closing </TR>
/// No more than 10 change comments exist
function validateClassHeaderComment(classStartPosition: Position, document: TextDocument): Promise<Diagnostic[]> {
	let diagnostics: Diagnostic[] = [];
	let symbolStart = Position.create(0, 0);
	let commentRange = Range.create(symbolStart, classStartPosition);

	let commentStr = document.getText(commentRange);
	let commentStartLine = 0;
	// If the class starts with 'Include' then we need to offset expectations
	if (commentStr.startsWith('Include')) {
		commentStartLine = 2
		symbolStart = Position.create(commentStartLine, 0);
		commentRange = Range.create(symbolStart, classStartPosition);
		commentStr = document.getText(commentRange);
	}


	// If the comment is entirely missing, add a default header.
	if (commentStr.trim().length == 0) {
		const commentRange = Range.create(symbolStart, symbolStart);
		const fixRange = commentRange;
		let diagData: DiagData = {
			uri: document.uri
		}
		diagData.fixMessage = 'Add header comment';
		diagData.fixRange = fixRange;
		diagData.fixText = getDefaultHeaderComment();
		diagnostics.push({
			code: 'osc-header-missing',
			message: 'Missing class header comment',
			range: commentRange,
			severity: DiagnosticSeverity.Error,
			source: 'Class Header Comment',
			data: diagData
		});

		return Promise.resolve(diagnostics);
	}
	const commentArr = commentStr.split('\n');


	// Check if this header has an include line at the start, if so, the starting line for the diagnostics info will be handled differently. 
	// Do some simple regex checks for the author, date and copyright
	const authResult = commentStr.match(/\/\/\/\s*Author:\s*(\w+)(?:<br>)?/m);
	if (!authResult) {
		let diagData: DiagData = {
			uri: document.uri
		}
		diagnostics.push({
			code: 'osc-header-missing-author',
			message: 'Missing class author',
			range: Range.create(symbolStart, symbolStart),
			severity: DiagnosticSeverity.Warning,
			source: 'Class Header Comment',
			data: diagData
		});
	}

	// Check for date
	const dateResult = commentStr.match(/\/\/\/\s*Date:\s*(\w+)(?:<br>)?/m);
	if (!dateResult) {
		let diagData: DiagData = {
			uri: document.uri
		}
		diagnostics.push({
			code: 'osc-header-missing-date',
			message: 'Missing class creation date',
			range: Range.create(symbolStart, symbolStart),
			severity: DiagnosticSeverity.Warning,
			source: 'Class Header Comment',
			data: diagData
		});
	}
	// Check for copyright
	const copyResult = commentStr.match(/\/\/\/\s*Copyright/m);
	if (!copyResult) {
		let diagData: DiagData = {
			uri: document.uri
		}
		diagnostics.push({
			code: 'osc-header-missing-copyright',
			message: 'Missing class copyright',
			range: Range.create(symbolStart, symbolStart),
			severity: DiagnosticSeverity.Error,
			source: 'Class Header Comment',
			data: diagData
		});
	}
	// Validate the change comments
	const commentResult = commentStr.match(/\/\/\/ <TR bgcolor='#ffffff'>/g);
	if (commentResult) {
		// Since we know we have too many comments, in order to make removing them easier, iterate line by line.
		let count = 0;
		let trOpen = true;
		let start = 0;
		let end = 0;
		for (const line in commentArr) {
			const str = commentArr[line];
			const lineInt = parseInt(line);
			if (str.includes("/// <TR bgcolor='#ffffff'>")) {
				if (trOpen) {
					let diagData: DiagData = {
						uri: document.uri
					}
					// Add a diagnostic for missing the ending
					const commentRange = Range.create(Position.create(lineInt + commentStartLine - 1, 0), Position.create(lineInt + commentStartLine - 1, commentArr[lineInt + commentStartLine - 1].length));
					const fixRange = Range.create(Position.create(lineInt + commentStartLine, 0), Position.create(lineInt + commentStartLine, 0));
					diagData.fixMessage = 'Add missing end tr tag';
					diagData.fixRange = fixRange;
					diagData.fixText = '/// </TR>\n';
					diagnostics.push({
						code: 'osc-header-comment-missing-tr',
						message: 'Opening TR before ending previous',
						range: commentRange,
						severity: DiagnosticSeverity.Warning,
						source: 'Class Header Comment',
						data: diagData
					});
				}
				count++;
				trOpen = true;
				if (count > 10 && !start) {
					start = lineInt;
				}
			} else if (str.includes('/// </TR>')) {
				trOpen = false;
				end = lineInt;// Keep track of the last line
			}
		}
		// Validate the number of comments
		if (commentResult.length > 10) {
			let diagData: DiagData = {
				uri: document.uri
			}
			const commentRange = Range.create(Position.create(start + commentStartLine + 1, 0), Position.create(end + commentStartLine + 2, 0));
			diagData.fixMessage = 'Remove extra change comments';
			diagData.fixRange = commentRange;
			diagData.fixText = '';
			diagnostics.push({
				code: 'osc-header-comment-count',
				message: 'Too many change comments, max of 10',
				range: commentRange,
				severity: DiagnosticSeverity.Warning,
				source: 'Class Header Comment',
				data: diagData
			});
		}

	}
	return Promise.resolve(diagnostics);

}
/// Simple helper to get the default header comment.  Put here soley to avoid bloat above.
function getDefaultHeaderComment(): string {
	return "/// <p>\n" +
		"/// Brief overview of class and its purpose.\n" +
		"/// </p>\n" +
		"/// Author: yourname<br>\n" +
		"/// Date: today<br>\n" +
		"/// Copyright &copy; Ontario Systems, LLC.  All rights reserved.<br>\n" +
		"/// <H3>CLASS REVISIONS</H3>\n" +
		"/// <TABLE border='1' cellpadding='5' cellspacing='0' style='border-collapse: collapse' bordercolor='#111111' width='100%' bgcolor='#DDC5A4'>\n" +
		"/// <TR>\n" +
		"/// 	<TD width='20%'><B>DATE</B></TD>\n" +
		"/// 	<TD width='15%'><B>USER</B></TD>\n" +
		"/// 	<TD width='15%'><B>TASK</B></TD>\n" +
		"/// 	<TD width='50%'><B>MODIFICATION</B></TD>\n" +
		"/// </TR>\n" +
		"/// <TR bgcolor='#ffffff'>\n" +
		"/// 	<TD>today</TD>\n" +
		"/// 	<TD>yourname</TD>\n" +
		"/// 	<TD>jira-number</TD>\n" +
		"/// 	<TD>Created.</TD>\n" +
		"/// </TR>\n" +
		"/// </TABLE>\n"

}