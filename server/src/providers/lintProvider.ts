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
	//console.log(process.hrtime(start)[0] + " s, " + elapsed.toFixed(precision) + " ms - " + note); // print message + time

}
export interface DiagData { uri: string, fixText?: string, fixRange?: Range, fixMessage?: string, autoFix?: boolean }

type validatorFunction =(document: TextDocument, symbols: any[]) => Promise<Diagnostic[]>
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
	promiseArray.push(validateJSSymbols(document, symbols)); // LCM
	const classMethodSymbols:any[] =  await connection.sendRequest('osc/getSymbols', { uri: document.uri, type: 'ClassMethod' });
	promiseArray.push(validateSingleSymbol(document, classMethodSymbols,'classMethod')); // LCM
	let diagnostics = (await Promise.all(promiseArray)).flat()
	elapsed_time("Linting Time - ", start)
	for (const diag of diagnostics) {
		let currentValue = ruleMap.get(diag.code);
		if (!currentValue) currentValue = 0
		ruleMap.set(diag.code, currentValue + 1);
	}
	//console.log(ruleMap);
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

			/*
			let start = getPosition(cleanResults.methodText, fixStartPos);
			let end = getPosition(cleanResults.methodText, fixEndPos);
			// start/end should contain 0-based line/column offsets
			let fixStart = Position.create(cleanResults.range.start.line + start.line + 1, cleanResults.range.start.character + start.column);
			let fixEnd = Position.create(cleanResults.range.start.line + end.line + 1, end.column);
			let fixRange = Range.create(fixStart, fixEnd);
			*/
			let fixRange = textPosToRange(cleanResults,fixStartPos,fixEndPos)
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

/// This method creates promises to validate individual javascript symbols.
async function validateSingleSymbol(document: TextDocument, symbols: any[],type:string): Promise<Diagnostic[]> {
	let promiseArray: Promise<Diagnostic[]>[] = [];
	for (let symbol of symbols) {
		if (type=='classMethod'){
			promiseArray.push(validateSingleServerSymbol(symbol, document))
		}
		
	}
	// Wait for all promises to reslove
	let results = await Promise.all(promiseArray);

	return Promise.resolve(results.flat());

}

/// Validate an individual symbol. This will crea teh appropriate diagnostics for any issues
async function validateSingleServerSymbol(symbol: any, document: TextDocument): Promise<Diagnostic[]> {
	let diagnostics: Diagnostic[] = [];
	let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
	let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
	let symbolRange = Range.create(symbolStart, symbolEnd);
	let cleanResults: CleanMethodResults = getCleanMethod(symbolRange, document,'ClassMethod'); // LCM server is probably a bad name
	if (!cleanResults.isOk) {
		console.log('Failed to get method text for ' + symbol.name)
		return diagnostics;
	}
	const comments = cleanResults.comment.split('\n');
	// First thing to verify - server side methods should begin with a captial letter
	if (cleanResults.methodName[0] != cleanResults.methodName[0].toUpperCase()){
		let fixStart = Position.create(cleanResults.range.start.line + comments.length-1, 12);
		let fixEnd = Position.create(cleanResults.range.start.line + comments.length-1, 13);
		let fixRange = Range.create(fixStart, fixEnd);
		let diagRange = Range.create(fixStart, fixStart);

		let diagData: DiagData = {
			uri: document.uri,
			fixText: cleanResults.methodName[0].toUpperCase(),
			fixRange: fixRange,
			fixMessage: `Capitalize first letter`
		}
		let diag: Diagnostic = {
			code: 'osc-method-case',
			message: 'Server methods should be pascal case',
			range: diagRange,
			severity: DiagnosticSeverity.Warning,
			source: cleanResults.methodName,
			data: diagData
		}
		diagnostics.push(diag);
	}
	
	validateComments(cleanResults,document,diagnostics);
	validateConditionals(cleanResults,document,diagnostics);

	

	
	const lines = cleanResults.methodText.split('\n');

	// ESLint is not well suited to parse objectscript code, so instead we will do it ourselves (yay)
	// We can likely do it more easily if we were to tokenize the document, similar to how the ISC LS does it, but for this first, basic pass use regex line by line :)

	return Promise.resolve(
		diagnostics
	)
}

function isAlphanumeric(char: string): boolean {
    const code = char.charCodeAt(0);
    return (code > 47 && code < 58) || // numeric (0-9)
        (code > 64 && code < 91) || // upper alpha (A-Z)
        (code > 96 && code < 123); // lower alpha (a-z)
}
function textPosToRange(cleanResults:CleanMethodResults,startPos:number,endPos:number):Range{
	let start = getPosition(cleanResults.methodText, startPos);
	let end = getPosition(cleanResults.methodText, endPos);
	// start/end should contain 0-based line/column offsets
	let fixStart = Position.create(cleanResults.range.start.line + start.line + 1, cleanResults.range.start.character + start.column);
	let fixEnd = Position.create(cleanResults.range.start.line + end.line + 1, end.column);
	return Range.create(fixStart, fixEnd);
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
			const commentRange = Range.create(Position.create(start + commentStartLine, 0), Position.create(end + commentStartLine + 1, 0));
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


function validateComments(cleanResults:CleanMethodResults,document:TextDocument,diagnostics:Diagnostic[]){
	let inComment=false;
	let commentStyle='';
	let commentMismatch=false;
	//const commentStyleRegex = /^\s*(\/\/|;|#;)/gm
	const commentStyleRegex = /^(?:\s*)(\/\/|;|#;)/gmd
	const methodText = cleanResults.methodText;
	// Match the comment style against the entire method. We only need to check each line if there is a difference
	let commentMatches = methodText.matchAll(commentStyleRegex)
	if (commentMatches){
		//commentStyle = commentMatches[0].trim();
		// Due to how .match works, the white space will be included for every match, so strip it off here to get the actual style
		for (let match of commentMatches){
			if (!match.indices) continue; // TS gets mad if we don't do this.  Passing 'd' to the regex forces the indices to be present
			// If the comment style hasn't been set yet, get it now
			if (commentStyle==''){
				commentStyle=match[1];
			}
			// If this comment does not match the style, create a diagnostic for it
			if (match[1]!=commentStyle){
				let commentRange = textPosToRange(cleanResults,match.indices[1][0],match.indices[1][1]);
				let diag: Diagnostic = {
					code: 'osc-comment-style',
					message: 'Inconsistent Comment Style',
					range: commentRange,
					severity: DiagnosticSeverity.Warning,
					source: cleanResults.methodName,
					data:  {
						uri: document.uri,
						fixText: commentStyle,
						fixRange: commentRange,
						fixMessage: `Use consistent comment style`
					} as DiagData
				}
				diagnostics.push(diag);
				}
			
			// Since we are already matching comments here, check if the next character is not a space.
			if (![' ','\t'].includes(cleanResults.methodText[match.indices[1][1]]) ){
				let commentRange = textPosToRange(cleanResults,match.indices[1][1],match.indices[1][1]);
				let diag: Diagnostic = {
					code: 'osc-spaced-comment',
					message: `Expected space or tab after start of comment`,
					range: commentRange,
					severity: DiagnosticSeverity.Warning,
					source: cleanResults.methodName,
					data:  {
						uri: document.uri,
						fixText: ' ',
						fixRange: commentRange,
						fixMessage: `Add Space`
					} as DiagData
				}
				diagnostics.push(diag);
				}
		}
		
	}
}

function validateConditionals(cleanResults:CleanMethodResults,document:TextDocument,diagnostics:Diagnostic[]){
	// Now check for 'if' statements that we want to validate
	// Matches start of line, not starting with a comment, optionally containing E or ELSE, spaces then I or IF, capturing everything before the last {
	//const ifRegex = /^\s*(?!(\/\/|;|#;))[ \t]*(?:E|ELSE)?I(?:F)?(.*)s*{/dgmi
	const ifRegex = /^\s*(?!(\/\/|;|#;))(?:})?[ \t]*(?:E|ELSE)?I(?:F)?(.*)s*{/dgmi

	const methodText = cleanResults.methodText;
	const ifMatches = methodText.matchAll(ifRegex);

	for (const match of ifMatches){
		if (!match.indices) continue; // TS gets mad if we don't do this.  Passing 'd' to the regex forces the indices to be present
		
		const matchText = match[2];
		let legacyConditionalFound=false;
		// First, check for any ! character that is not in quotes.
		// if (text.includes('!') || text.includes(',')){
		let inQuotes=false;
		let parenCount=0;
		let funcCount=0;
		let parenTypeStack = []; // 1 - function, 2 - logical group
		// Replace all escaped quotes, we don't care about those. Use 11 so that the original length is retained.
		let text = matchText.replaceAll('""','11');
		for (let pos=0;pos<text.length;pos++){
			const char = text[pos];
			// Check for quotes
			if (char=='"') {
				inQuotes = !inQuotes;
			}
			if (inQuotes) continue; // If this is a quoted string, we really don't care about anything inside of it.
			// Check for a bang, any instance of this not in a quote is invalid.
			if (char=='!'){
				const bangIndex = pos;
				const bangPos = match.indices[2][0]+bangIndex;
				// Include spacing around the operator as a part of the fix.
				let fixText =(text[bangIndex-1]!=' '?' ':'') +'||'+(text[bangIndex+1]!=' '?' ':'');
				let range = textPosToRange(cleanResults,bangPos,bangPos+1);
				let diag: Diagnostic = {
					code: 'osc-logical-operators',
					message: 'Use || Operator over !',
					range: range,
					severity: DiagnosticSeverity.Warning,
					source: cleanResults.methodName,
					data:  {
						uri: document.uri,
						fixText: fixText,
						fixRange: range,
						fixMessage:'Use || Operator'
					} as DiagData
				}
				diagnostics.push(diag);
				legacyConditionalFound = true;
			}
			// If opening paren is found, differentiate between logical groupings and function calls.
			// Function parens will always be preceeded by an alphanumeric character.
			else if (char=='(' ){
				if (isAlphanumeric(text.charAt(pos-1))){
					funcCount++;
					parenTypeStack.push('1');
				}else{
					parenCount++;
					parenTypeStack.push('2');
				}
			}
			// Closing paren could either be a logical or function paren.
			else if (char==')'){
				const lastType = parenTypeStack.pop();
				if (lastType=='1'){
					funcCount--;
				}else{
					parenCount--;
				}
			}
			else if (char==','){
				// We have encountered a comma.

				// If the function count is 0, then this comma is not in a function and is invalid.
				if (funcCount==0 || parenTypeStack.at(-1)=='2'){
					// Include spacing around the operator as a part of the fix.
					const commaPos = match.indices[2][0]+pos;
					let fixText =(text[commaPos-1]!=' '?' ':'') +'&&'+(text[commaPos+1]!=' '?' ':'');
					let range = textPosToRange(cleanResults,commaPos,commaPos+1);
					let diag: Diagnostic = {
						code: 'osc-logical-operators',
						message: 'Use && Operator over ,',
						range: range,
						severity: DiagnosticSeverity.Warning,
						source: cleanResults.methodName,
						data:  {
							uri: document.uri,
							fixText: fixText,
							fixRange: range,
							fixMessage:'Use && Operator'
						} as DiagData
					}
					diagnostics.push(diag);
					legacyConditionalFound = true;
				}
			}

			// At this point, we can check for correct parenthesizing 
			if ((char=='|' && text.charAt(pos+1)=='|') || (char=='&' && text.charAt(pos+1)=='&')){
				// Check the character to the right, it should be either a space or (
				let nextChar = text.charAt(pos+2);
				let hasRightSpace=false;
				if (nextChar==' ' ){
					hasRightSpace=true;
					nextChar = text.charAt(pos+3);
				}
				// If the next character is not a paren, this is invalid
				if (nextChar!='('){

				}
				
				// Possible approach - If the NEXT character is not '(' or ' (', the entire next 'statement' is invalid.  Statement would be everything until the next ||/&& at the same paren level
				// If the PREV char is not ) or ') ', then the previous statement is invalid, statement would be everything before until the next non-funciton ( or ||/&& at the same paren level
					// Would also need to ensure somehow that the paren is not part of the end of a function call.

					// Start simple.  Ignore possibility of functions and just check for variables/literals
					// Then get the right side working with functions / nesting
					// then get the left side

				pos++; // Skip the next character, we know what it is.
			}
			
		} // End Character iteration
		//}
		// Ensure that the outer level is wrapped in parenthesis
		checkConditionalParens(cleanResults,document,diagnostics,text.replaceAll(/(".*?")/g,(match:string) => '1'.repeat(match.length)),match.indices[2][0],true)
			// Include spacing around the operator as a part of the fix.
			
			

		// If we found a legacy conditional in this expression, do not bother with 
		
	}
}

function checkConditionalParens(cleanResults:CleanMethodResults,document:TextDocument,diagnostics:Diagnostic[],conditionalText:String,startPos:number,allowFix:boolean=false){
	//const text = conditionalText.trim();
	// Trim the text for easier matching, but also keep tracking of the padding for use when recursing.
	const originalLength = conditionalText.length;
	let text = conditionalText.trimStart();
	const frontPadLength = originalLength - text.length;
	text  = text.trimEnd();
	const endPadLength = originalLength - frontPadLength - text.length;
	
	//const text = conditionalText
	let parenResults = text.match(/^\((.*)\)$/);
	// If there is a not a match for this simple regex, the conditions are absolutely not wrapped.
	// simiarly, if thre are unwrapped operators, it is not wrapped.  Technically only the later check needs done, but the match is helpful for below
	if (!parenResults || findFirstLogicalOperatorOutsideParentheses(text)!=-1){
		let fixText =` (${text}) `;
		// The below two lines do not work, but the idea is to only include the space 
		if (cleanResults.methodText.charAt(startPos-1)=='(') fixText = fixText.trimStart();
		if (cleanResults.methodText.charAt(startPos+conditionalText.length)==')') fixText = fixText.trimEnd();
		let range = textPosToRange(cleanResults,startPos,startPos+conditionalText.length);
		let fixRange = textPosToRange(cleanResults,startPos,startPos+fixText.length);
		let diag: Diagnostic = {
			code: 'osc-conditional-parenthesis',
			message: 'Wrap conditions in ()',
			range: range,
			severity: DiagnosticSeverity.Warning,
			source: cleanResults.methodName,
			data:  {
				uri: document.uri,
				fixText: fixText,
				fixRange: range,
				fixMessage:'Wrap condition in ()'
			} as DiagData
		}
		// We may not always want to allow a fix automatically, sometimes it may be ambiguous.
		if (!allowFix){
			diag.data.autoFix=false;
		}
		diagnostics.push(diag);
	}
		// If we have already found one level that needs parenthesis, don't
	else{
		
		// this level was good, continue deeper
		const conditionOriginal = parenResults[1];
		let workingConditional = conditionOriginal;
		// At this point, the outermost parenthesis have been taken off, ((1) || (2)) => (1) || (2)
		let idx = findFirstLogicalOperatorOutsideParentheses(workingConditional);
		if (idx != -1){
			let offset=0;
			// idx indicates the index of the FIRST character in || or &&
			const left = workingConditional.substring(0,idx);
			// Provide the starting position + any previously stripped padding. Add 1 to account for the ( preceeding this level.
			checkConditionalParens(cleanResults,document,diagnostics,left,startPos+frontPadLength+1);
			const right = workingConditional.substring(idx+2);
			// check the right side of the conditional. offset of 3 to account for the operator + the preceeding (
			checkConditionalParens(cleanResults,document,diagnostics,right,startPos+idx+3+frontPadLength);
			

			workingConditional = workingConditional.substring(idx+2).trimEnd();
			
			idx = findFirstLogicalOperatorOutsideParentheses(workingConditional);
			//const right 
		}
		console.log(); // May need to check what is left in working at this point.

	}
		
}

	// Now we need to check both the left and the right sides of the primary operator, if there is one
function findFirstLogicalOperatorOutsideParentheses(input: string): number {
    let openParentheses = 0;
	for (let i = 0; i < input.length - 1; i++) {
        if (input[i] === '(') {
            openParentheses++;
        } else if (input[i] === ')') {
            openParentheses--;
        } else if (openParentheses === 0) {
            if (input[i] === '|' && input.charAt(i+1) === '|') {
                return i;
            }
            if (input[i] === '&' && input.charAt(i+1) === '&') {
                return i;
            }
        }
    }
    return -1; // If no unwrapped || or && found
}

	
