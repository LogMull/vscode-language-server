
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CleanMethodResults, getCleanMethod } from '../utils'
const esLintStyleConfig = require('../../resources/os-eslint-style-config.json');
const { ESLint } = require("eslint");
const convert = require('xml-js');
// set up ESLint to automatically fix issues, using the style-only guide.
const eslint = new ESLint({
	fix: true,
	useEslintrc: false,
	overrideConfig: esLintStyleConfig
});


var elapsed_time = function (note: string, start: any) {
	var precision = 3; // 3 decimal places
	var elapsed = process.hrtime(start)[1] / 1000000; // divide by a million to get nano to milli
	console.log(process.hrtime(start)[0] + " s, " + elapsed.toFixed(precision) + " ms - " + note); // print message + time

}

import { DocumentSymbol, Position, Range, TextEdit } from 'vscode-languageserver/node';
//import * as writeXML from './xmlFormatter/xmlFormatter';
const writeXML = require('../../xmlFormatter/xmlFormatter.js')

/// Handler for formatting an entire document
export async function onDocumentFormatting(clientMethodSymbols: DocumentSymbol[], XMLSymbols: DocumentSymbol[], document: TextDocument): Promise<TextEdit[]> {
	/// Build a list of all things that need formatted, so that they may run async.
	let formatterPromises: Promise<TextEdit[]>[] = [];
	let overallStart = process.hrtime();

	formatterPromises.push(formatAllClientMethods(clientMethodSymbols, document));
	formatterPromises.push(formatAllXData(XMLSymbols, document));

	let edits = await Promise.all<TextEdit[]>(formatterPromises);

	elapsed_time('overall', overallStart)
	return edits.flat()
}

/// Overlaps with the whole document formatting, but only for a specific range
export async function onDocumentRangeFormatting(range:Range,clientMethodSymbols: DocumentSymbol[], XMLSymbols: DocumentSymbol[], document: TextDocument): Promise<TextEdit[]> {
	const edits: TextEdit[]=[];
	// Find all nodes that overlap with the provided range
	let overlappingXdata = XMLSymbols.filter(symbol => {
		let symbolRange = symbolLocationToRange(symbol);
		//if (symbolRange)
	})

	return edits

}
// Format all javascript nodes, passes the work to formatSingleSymbol
async function formatAllClientMethods(symbols: any[], document: TextDocument): Promise<TextEdit[]> {
	let symbolPromises: Promise<TextEdit | null>[] = [];
	// Iterate over every symbol and throw it into an array of promises
	for (let symbol of symbols) {
		const range = symbolLocationToRange(symbol)
		symbolPromises.push(formatSingleSymbol(range, document))
	}
	// wait for all promises to resolve, or reject the first one.
	let edits = await Promise.all(symbolPromises);
	const filteredEdits: TextEdit[] = [];
	// Since some method may not need updated, filter out every null value
	for (const edit of edits) {
		if (edit != null) {
			filteredEdits.push(edit);
		}
	}
	return Promise.resolve(filteredEdits);

}
async function formatAllClientMethodsOld(symbols: any[], document: TextDocument, edits: TextEdit[]): Promise<TextEdit[]> {
	let myEdits: TextEdit[] = [];
	//let overallStart = process.hrtime();
	let symbolPromises: Promise<TextEdit>[] = [];
	// Iterate over every symbol, grab its method text and format it.
	for (let symbol of symbols) {
		let symbolStartTime = process.hrtime();
		let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
		let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
		let symbolRange = Range.create(symbolStart, symbolEnd);
		let cleanResults: CleanMethodResults = getCleanMethod(symbolRange, document)
		if (!cleanResults.isOk) continue;

		let results;
		try {
			results = await eslint.lintText(cleanResults.methodText);
			if (results[0].output) {
				// Our output was changes from
				// ClientMethod XYZ(args) [ language = javascript ...]
				// to
				// function XYZ(args)
				// This was done so that esLint would recognize return statements as valid syntax
				// We need to change it back
				let newText = results[0].output.replace(/^function .*(?:{\n)?/m, `ClientMethod ${cleanResults.methodName}(${cleanResults.parameters}) ${cleanResults.squareBrackets}\n{`)
				const edit = TextEdit.replace(cleanResults.range, newText)
				edits.push(edit);
				myEdits.push(edit)
			}
		} catch (ex) {
			debugger
		}
		//elapsed_time(symbol.name,symbolStartTime);
	}
	//elapsed_time('overall', overallStart)
	return Promise.resolve(myEdits);
	return myEdits;

}

/// Format a given symbol using the style-only ruleset.
async function formatSingleSymbol(symbolRange:Range, document: TextDocument): Promise<TextEdit | null> {

	// Parse the document range to get the actual clineMethod text for us
	let cleanResults: CleanMethodResults = getCleanMethod(symbolRange, document)
	if (!cleanResults.isOk) return null;
	try {
		// Lint the text, fixed are automatically applied
		let results = await eslint.lintText(cleanResults.methodText);
		if (results[0].output) {
			// Our output was changes from
			// ClientMethod XYZ(args) [ language = javascript ...]
			// to
			// function XYZ(args)
			// This was done so that esLint would recognize return statements as valid syntax
			// We need to change it back
			let newText = results[0].output.replace(/^function .*(?:{\n)?/m, `ClientMethod ${cleanResults.methodName}(${cleanResults.parameters}) ${cleanResults.squareBrackets}\n{`)
			const edit = TextEdit.replace(cleanResults.range, newText)
			return edit;
		}
	} catch (ex) {
		debugger
		console.log('(formatSingleSymbol) Failed to lint/replace ');
	}
	return null
}
function symbolLocationToRange(symbol:any):Range{
	let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
	let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
	let symbolRange = Range.create(symbolStart, symbolEnd);
	return symbolRange
}
// Formatting XData is primarily done with formatting XML.
// Will other types be needed later? Maybe CSS formatting?
// Formatting the XML is done largely either with the xml-js library or with our own modified version of it.
// The XML is parsed into a JSON object using xml-js and then our own rework of JSON -> XML will handle the conversion back.
// Options from ./formatConfig/xmlConfig.json will be used to handle how the XML is parsed.  See the readme in ./formatConfig for more info
/// Symbols is a documentSymbol array, but the types do not seem to match up for some reason
async function formatAllXData(symbols: any[], document: TextDocument): Promise<TextEdit[]> {
	let myEdits: TextEdit[] = [];
	for (let symbol of symbols) {
		let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
		let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
		let symbolRange = Range.create(symbolStart, symbolEnd);
		// Grab the entire node
		let wholeNode = document.getText(symbolRange)
		const xmlStart = wholeNode.indexOf('{');
		const xmlEnd = wholeNode.lastIndexOf('}');
		// Get the XML node
		let xmlStr = wholeNode.substring(xmlStart + 1, xmlEnd)
		// TODO - Ensure this chunk is valid somehow, maybe making sure it doesn't overlap? If the XML isn't valid, the symbol stuff does not recognize it very well at all
		// Conver the XML string to a JSON object
		let xmlJSON = convert.xml2js(xmlStr, {
			alwaysArray: true,
		});
		// Conver the object back with our own rules
		let formattedXML = writeXML(xmlJSON, {
			// spaces: 2,
			spaces: '\t',
			indentAttributes: true

		});
		//let formattedXML = ""
		// Push the edited changes back into the document
		let result = wholeNode.substring(0, xmlStart + 1) + '\n' + formattedXML + '\n' + wholeNode.substring(xmlEnd);
		let edit = TextEdit.replace(symbolRange, result)
		myEdits.push(edit);

	}
	return Promise.resolve(myEdits);
}

