
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CleanMethodResults, getCleanMethod, symbolLocationToRange } from './utils'
const esLintStyleConfig = require('./os-eslint-style-config.json'); // Dev note - stored in resources/*
const { ESLint } = require("eslint");
const convert = require('xml-js');
// set up ESLint to automatically fix issues, using the style-only guide.
const eslint = new ESLint({
	fix: true,
	useEslintrc: false,
	overrideConfig: esLintStyleConfig
});

import { DocumentSymbol, Position, Range, TextEdit } from 'vscode-languageserver/node';
const writeXML = require('../../xmlFormatter/xmlFormatter.js')

/// Handler for formatting an entire document
export async function onDocumentFormatting(clientMethodSymbols: DocumentSymbol[], XMLSymbols: DocumentSymbol[], document: TextDocument): Promise<TextEdit[]> {
	/// Build a list of all things that need formatted, so that they may run async.
	let formatterPromises: Promise<TextEdit[]>[] = [];

	formatterPromises.push(formatAllClientMethods(clientMethodSymbols, document));
	formatterPromises.push(formatAllXData(XMLSymbols, document));

	let edits = await Promise.all<TextEdit[]>(formatterPromises);
	// Each of these methods return an array of edits, so flatten the results into one large array
	return edits.flat()
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
	// This way allows the typing to play nicely
	for (const edit of edits) {
		if (edit != null) {
			filteredEdits.push(edit);
		}
	}
	return Promise.resolve(filteredEdits);

}

/// Format a given symbol using the style-only ruleset.
async function formatSingleSymbol(symbolRange: Range, document: TextDocument): Promise<TextEdit | null> {

	// Parse the document range to get the actual clientMethod text for us
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
		// Convert the XML string to a JSON object
		let xmlJSON = convert.xml2js(xmlStr, {
			alwaysArray: true,
		});
		// Convert the object back with our own rules
		let formattedXML = writeXML(xmlJSON, {
			spaces: '\t',
			indentAttributes: true

		});
		// Push the edited changes back into the document
		let result = wholeNode.substring(0, xmlStart + 1) + '\n' + formattedXML + '\n' + wholeNode.substring(xmlEnd);
		let edit = TextEdit.replace(symbolRange, result)
		myEdits.push(edit);

	}
	return Promise.resolve(myEdits);
}

