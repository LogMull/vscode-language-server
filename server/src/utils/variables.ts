import { createConnection } from 'vscode-languageserver/node';
/**
 * Node IPC connection between the server and client.
 */
export let connection = createConnection();