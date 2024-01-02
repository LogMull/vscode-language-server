import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, Range } from 'vscode-languageserver/node'
import { connection } from './utils/variables';
const jsMethodRegex = new RegExp("^ClientMethod.*language\\s*=\\s*javascript", "im");
const jsMethodBreakdown = /ClientMethod\s*(\w+)\(([\w,\W]*)\)\s*(\[.*\])\n/i

export interface CleanMethodResults { 
	isOk: boolean, 
	range: Range, 
	methodText: string,
	squareBrackets:string,
	parameters:string,
	methodName:string,
	comment:string
}
export async function makeRESTRequest(method: "GET" | "POST", api: number, path: string, server: ServerSpec, data?: any, checksum?: string, params?: any): Promise<any | undefined> {
	// As of version 2.0.0, REST requests are made on the client side
	return connection.sendRequest("osc/makeRESTRequest", {
		method,
		api,
		path,
		server,
		data,
		checksum,
		params
	}).then((respdata) => respdata ?? undefined);
}


export function getCleanMethod(originalRange: Range, document: TextDocument): CleanMethodResults {

	let returnObj = {isOk:false,comment:''} as CleanMethodResults;
	let wholeNode = document.getText(originalRange);
	let lines = wholeNode.split('\n');
	let methodOffset = 0;
	// Find where the line starts with ClientMethod and is javascript
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (jsMethodRegex.test(line)) {
			methodOffset = i;
			break;
		}
	}
	// Get the comment information, if applicable.
	if (methodOffset!=0){
		let commentRange = Range.create(Position.create(originalRange.start.line,0),Position.create(originalRange.start.line+methodOffset-1,lines[methodOffset-1].length))
		returnObj.comment = document.getText(commentRange);
	}
	// let newRange = new vscode.Range(new vscode.Position(symbol.range.start.line+methodOffset+1,0),new vscode.Position(symbol.range.end.line,1));
	// Exclues ClientMethod XXX () [language = javascript]
	//let newRange = new vscode.Range(new vscode.Position(symbol.range.start.line + methodOffset + 1, 0), symbol.range.end);
	let newRange = Range.create(Position.create(originalRange.start.line + methodOffset, 0), originalRange.end);

	let methodText = document.getText(newRange);

	// method text here will contain CLientMethod XXXX() [language=javascript]
	let methodParts = methodText.match(jsMethodBreakdown);
	if (!methodParts) {
		return returnObj;
	}
	const methodName = methodParts[1]
	const params = methodParts[2]
	const squarebrackets = methodParts[3]

	methodText = methodText.replace(jsMethodBreakdown, "function $1($2)")


	returnObj.methodText = methodText;
	returnObj.isOk=true;
	returnObj.range=newRange;
	returnObj.squareBrackets=squarebrackets
	returnObj.parameters=params
	returnObj.methodName=methodName

	return returnObj;
}