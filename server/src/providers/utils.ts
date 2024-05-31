import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, Range } from 'vscode-languageserver/node'
// import { connection } from './utils/variables';
const jsMethodRegex = new RegExp("^ClientMethod.*language\\s*=\\s*javascript", "im");
const jsMethodBreakdown = /ClientMethod\s*(\w+)\(([\w,\W]*)\)\s*(\[.*\])\n/i

const classMethodRegex = /^ClassMethod/im;
const classMethodBreakdown= /ClassMethod\s*(\w+)\((.*)\)\s*(\[.*\])?\n/i
export interface CleanMethodResults {
	isOk: boolean,
	range: Range,
	methodText: string,
	squareBrackets: string,
	parameters: string,
	methodName: string,
	comment: string
}
// export async function makeRESTRequest(method: "GET" | "POST", api: number, path: string, server: ServerSpec, data?: any, checksum?: string, params?: any): Promise<any | undefined> {
// 	// As of version 2.0.0, REST requests are made on the client side
// 	return connection.sendRequest("osc/makeRESTRequest", {
// 		method,
// 		api,
// 		path,
// 		server,
// 		data,
// 		checksum,
// 		params
// 	}).then((respdata) => respdata ?? undefined);
// }


export function getCleanMethod(originalRange: Range, document: TextDocument,type:string='function'): CleanMethodResults {

	let returnObj = { isOk: false, comment: '' } as CleanMethodResults;
	let wholeNode = document.getText(originalRange);
	let lines = wholeNode.split('\n');
	let methodOffset = 0;
	const methodRegex = (type=='function'?jsMethodRegex:classMethodRegex)
	// Find where the line starts with ClientMethod and is javascript
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (methodRegex.test(line)) {
			methodOffset = i;
			break;
		}
	}
	// Get the comment information, if applicable.
	if (methodOffset != 0) {
		let commentRange = Range.create(Position.create(originalRange.start.line, 0), Position.create(originalRange.start.line + methodOffset - 1, lines[methodOffset - 1].length))
		returnObj.comment = document.getText(commentRange);
	}
	// Exclues ClientMethod XXX () [language = javascript]
	let newRange = Range.create(Position.create(originalRange.start.line + methodOffset, 0), originalRange.end);

	let methodText = document.getText(newRange);

	// method text here will contain CLientMethod XXXX() [language=javascript]
	const breadkownRegex = (type=='function'?jsMethodBreakdown:classMethodBreakdown)
	let methodParts = methodText.match(breadkownRegex);
	if (!methodParts) {
		return returnObj;
	}
	const methodName = methodParts[1]
	const params = methodParts[2]
	const squarebrackets = methodParts[3]

	methodText = methodText.replace(breadkownRegex, type+" $1($2)"); // LCM this may be different when doing serv-erside validation. TBD

	returnObj.methodText = methodText;
	returnObj.isOk = true;
	returnObj.range = newRange;
	returnObj.squareBrackets = squarebrackets
	returnObj.parameters = params
	returnObj.methodName = methodName

	return returnObj;
}

/// Helper to get a Range from a 'symbol' with a location based range
export function symbolLocationToRange(symbol: any): Range {
	let symbolStart = Position.create(symbol.location.range[0].line, symbol.location.range[0].character)
	let symbolEnd = Position.create(symbol.location.range[1].line, symbol.location.range[1].character)
	let symbolRange = Range.create(symbolStart, symbolEnd);
	return symbolRange
}